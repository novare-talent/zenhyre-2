import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "@zenhyre/db/test";
import { fixedClock } from "@zenhyre/shared";
import { createIdentity } from "../src/index";

let db: any, close: () => Promise<void>, id: ReturnType<typeof createIdentity>;
beforeAll(async () => {
  ({ db, close } = await testDb());
  id = createIdentity(db, { clock: fixedClock("2026-11-05T10:00:00Z") });
  await id.seedCampuses([
    { name: "IIT Bombay", shortCode: "IITB", emailDomains: ["iitb.ac.in"], rollNumberRegex: "^\\d{2}[A-Za-z]\\d{4}$", internalTier: 1 },
    { name: "IIT Dharwad", shortCode: "IITDH", emailDomains: ["iitdh.ac.in"], rollNumberRegex: null, internalTier: 3 },
  ]);
});
afterAll(() => close());

/** Stands in for a Supabase sign-in: the same address always maps to the same auth user id. */
async function signedIn(email: string) {
  const r = await id.ensureUser({ id: (await id.userIdForEmail(email)) ?? randomUUID(), email });
  return { userId: r.user.id, created: r.created };
}

describe("candidate via campus email", () => {
  it("creates a verified candidate with campus from the email domain and status from grad_date", async () => {
    const { userId } = await signedIn("22b1234@iitb.ac.in");
    const c = await id.createCandidate({ userId, email: "22b1234@iitb.ac.in", gradDate: "2027-06-30", course: "B.Tech CSE", rollNumber: "22b1234" });
    expect(c.verificationState).toBe("verified");
    expect(c.verificationSource).toBe("campus_email");
    expect(c.status).toBe("final_year"); // within 12 months of grad
    expect(c.rollNumberFlag).toBe(false);
  });
  it("flags a roll number that fails the campus regex but still verifies", async () => {
    const { userId } = await signedIn("x@iitb.ac.in");
    const c = await id.createCandidate({ userId, email: "x@iitb.ac.in", gradDate: "2029-06-30", course: "B.Tech", rollNumber: "nope" });
    expect(c.rollNumberFlag).toBe(true);
    expect(c.status).toBe("student");
  });
  it("refuses a non-campus email for the campus path", async () => {
    const { userId } = await signedIn("p@gmail.com");
    await expect(id.createCandidate({ userId, email: "p@gmail.com", gradDate: "2027-06-30", course: "B.Tech", rollNumber: null }))
      .rejects.toThrow(/campus/i);
  });
  it("derives status nightly from grad_date", async () => {
    const { userId } = await signedIn("g@iitdh.ac.in");
    await id.createCandidate({ userId, email: "g@iitdh.ac.in", gradDate: "2026-12-01", course: "B.Tech", rollNumber: null });
    const later = createIdentity(db, { clock: fixedClock("2026-12-02T00:00:00Z") });
    const n = await later.refreshCandidateStatuses();
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await later.getCandidate(userId))!.status).toBe("alumnus");
  });
});

describe("alumni direct request", () => {
  it("creates a verification_pending candidate scoped to the campus and verifies via staff", async () => {
    const { userId } = await signedIn("alum@gmail.com");
    const c = await id.createCandidate({ userId, email: "alum@gmail.com", campusShortCode: "IITB", gradDate: "2018-06-30", course: "B.Tech", rollNumber: null, claimed: { batch: "2018", branch: "EE", linkedinUrl: "https://linkedin.com/in/x" } });
    expect(c.verificationState).toBe("verification_pending");
    expect(c.verificationSource).toBe("association");
    expect(c.status).toBe("alumnus");
    const v = await id.verifyCandidate(userId, { by: "staff:u1", source: "staff" });
    expect(v.verificationState).toBe("verified");
    expect(v.verificationSource).toBe("staff");
  });
  it("rejects with a reason and allows exactly one re-request", async () => {
    const { userId } = await signedIn("alum2@gmail.com");
    await id.createCandidate({ userId, email: "alum2@gmail.com", campusShortCode: "IITB", gradDate: "2018-06-30", course: "B.Tech", rollNumber: null, claimed: { batch: "2018", branch: "EE", linkedinUrl: "" } });
    await id.rejectVerification(userId, { by: "staff:u1", reason: "no record" });
    expect((await id.getCandidate(userId))!.verificationState).toBe("rejected");
    await id.requestVerificationAgain(userId);
    expect((await id.getCandidate(userId))!.verificationState).toBe("verification_pending");
    await id.rejectVerification(userId, { by: "staff:u1", reason: "still no" });
    await expect(id.requestVerificationAgain(userId)).rejects.toThrow(/attempts/i);
  });
});

describe("profile and matchable list", () => {
  it("saves profile fields and filters matchable candidates by campus, status, openness", async () => {
    const a = await signedIn("m1@iitb.ac.in");
    await id.createCandidate({ userId: a.userId, email: "m1@iitb.ac.in", gradDate: "2027-06-30", course: "B.Tech", rollNumber: null });
    await id.saveProfile(a.userId, { skills: ["ts"], years_experience: 0 });
    const b = await signedIn("m2@iitb.ac.in");
    await id.createCandidate({ userId: b.userId, email: "m2@iitb.ac.in", gradDate: "2027-06-30", course: "B.Tech", rollNumber: null });
    await id.setCandidateOpen(b.userId, false);
    const campusId = (await id.campusByShortCode("IITB"))!.id;
    const list = await id.listMatchableCandidates({ campusIds: [campusId], statuses: ["final_year"] });
    expect(list.map((c) => c.userId)).toContain(a.userId);
    expect(list.map((c) => c.userId)).not.toContain(b.userId);
  });
});
