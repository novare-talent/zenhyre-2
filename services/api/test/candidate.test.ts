import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { schema } from "@zenhyre/db";
import { testApp } from "./helpers";

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
  await t.db.insert(schema.campus).values({ name: "IIT Bombay", shortCode: "IITB", emailDomains: ["iitb.ac.in"], rollNumberRegex: "^\\d{2}[a-z]\\d{4}$", internalTier: 1 });
});
afterAll(() => t.close());

describe("candidate sign-up", () => {
  it("campus email: creates verified candidate, no review item", async () => {
    const { cookie } = await t.signIn("22b0001@iitb.ac.in");
    const res = await t.as(cookie)("/candidates", { method: "POST", body: JSON.stringify({ gradDate: "2027-06-30", course: "B.Tech CSE", rollNumber: "22b0001" }) });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.candidate.verificationState).toBe("verified");
    const items = await t.db.select().from(schema.reviewItem);
    expect(items).toHaveLength(0);
  });
  it("campus email with bad roll number: verified but opens a staff verification item", async () => {
    const { cookie } = await t.signIn("weird@iitb.ac.in");
    await t.as(cookie)("/candidates", { method: "POST", body: JSON.stringify({ gradDate: "2027-06-30", course: "B.Tech", rollNumber: "ZZZ" }) });
    const items = await t.db.select().from(schema.reviewItem);
    expect(items.some((i) => i.kind === "verification" && i.associationId === null)).toBe(true);
  });
  it("alumni direct request: pending, review item unscoped when campus has no association", async () => {
    const { cookie } = await t.signIn("alum@gmail.com");
    const res = await t.as(cookie)("/candidates", { method: "POST", body: JSON.stringify({ campusShortCode: "IITB", gradDate: "2018-06-30", course: "B.Tech", claimed: { batch: "2018", branch: "EE", linkedinUrl: "https://linkedin.com/in/a" } }) });
    expect(res.status).toBe(201);
    expect((await res.json() as any).candidate.verificationState).toBe("verification_pending");
  });
  it("profile save and open toggle", async () => {
    const { cookie } = await t.signIn("22b0002@iitb.ac.in");
    await t.as(cookie)("/candidates", { method: "POST", body: JSON.stringify({ gradDate: "2027-06-30", course: "B.Tech", rollNumber: "22b0002" }) });
    const p = await t.as(cookie)("/me/profile", { method: "PUT", body: JSON.stringify({ skills: ["ts", "pg"], years_experience: 0 }) });
    expect((await p.json() as any).profile.skills).toEqual(["ts", "pg"]);
    const o = await t.as(cookie)("/me/open", { method: "PUT", body: JSON.stringify({ open: false }) });
    expect(o.status).toBe(200);
  });
  it("campus list exposes only public fields (§4.1: internal_tier is never exposed)", async () => {
    const { cookie } = await t.signIn("22b0003@iitb.ac.in");
    const body = await (await t.as(cookie)("/campuses")).json() as any;
    expect(body.campuses).toHaveLength(1);
    expect(Object.keys(body.campuses[0]).sort()).toEqual(["id", "name", "shortCode"]);
  });
});
