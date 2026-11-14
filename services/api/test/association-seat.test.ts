import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "@zenhyre/db/orm";
import { schema } from "@zenhyre/db";
import { testApp } from "./helpers";

let t: Awaited<ReturnType<typeof testApp>>;
let staffCookie: string;
const post = (cookie: string, path: string, body: unknown) => t.as(cookie)(path, { method: "POST", body: JSON.stringify(body) });

beforeAll(async () => {
  t = await testApp();
  await t.db.insert(schema.campus).values([
    { name: "IIT Delhi", shortCode: "IITD", emailDomains: ["iitd.ac.in"], rollNumberRegex: null, internalTier: 1 },
    { name: "IIT Madras", shortCode: "IITM", emailDomains: ["iitm.ac.in"], rollNumberRegex: null, internalTier: 1 },
  ]);
  const s = await t.signIn("ops@novaretalent.com");
  await t.db.update(schema.user).set({ isStaff: true }).where(eq(schema.user.id, s.json.userId));
  staffCookie = s.cookie;
  expect((await post(staffCookie, "/admin/associations", { campusShortCode: "IITD", name: "IITD alumni", payoutMode: "cash", adminEmails: ["sec@iitd-alumni.org"] })).status).toBe(201);
  expect((await post(staffCookie, "/admin/associations", { campusShortCode: "IITM", name: "IITM alumni", payoutMode: "cash", adminEmails: ["sec@iitm-alumni.org"] })).status).toBe(201);
});
afterAll(() => t.close());

async function alumnus(email: string, campusShortCode: string, name: string) {
  const a = await t.signIn(email);
  const r = await post(a.cookie, "/candidates", { name, campusShortCode, gradDate: "2018-06-30", course: "B.Tech", claimed: { batch: "2018", branch: "EE", linkedinUrl: "https://linkedin.com/in/x" } });
  expect(r.status).toBe(201);
  return a;
}

describe("association seat: verification queue (§6.1)", () => {
  it("shows an admin only their own association's queue, with the fields §6.1 lists", async () => {
    await alumnus("delhi.alum@gmail.com", "IITD", "Asha Rao");
    await alumnus("madras.alum@gmail.com", "IITM", "Ravi Iyer");
    const sec = await t.signIn("sec@iitd-alumni.org");
    const res = await t.as(sec.cookie)("/association/reviews");
    expect(res.status).toBe(200);
    const { items } = await res.json() as any;
    expect(items).toHaveLength(1);
    expect(items[0].candidate).toMatchObject({ name: "Asha Rao", campus: "IIT Delhi", claimedBatch: "2018", claimedBranch: "EE", linkedinUrl: "https://linkedin.com/in/x" });
    expect(JSON.stringify(items)).not.toContain("internalTier");
  });
  it("lets the admin approve; the candidate is verified by the association and told so", async () => {
    const sec = await t.signIn("sec@iitd-alumni.org");
    const [item] = (await (await t.as(sec.cookie)("/association/reviews")).json() as any).items;
    expect((await post(sec.cookie, `/association/reviews/${item.id}/resolve`, { resolution: "approve" })).status).toBe(200);
    const alum = await t.signIn("delhi.alum@gmail.com");
    const me = await (await t.as(alum.cookie)("/me")).json() as any;
    expect(me.candidate).toMatchObject({ verificationState: "verified", verificationSource: "association" });
    const feed = await (await t.as(alum.cookie)("/me/notifications")).json() as any;
    expect(feed.items.map((n: any) => n.template)).toContain("verification_approved");
    expect((await (await t.as(sec.cookie)("/association/reviews")).json() as any).items).toEqual([]);
  });
  it("refuses another association's item, a reject without a reason, and anyone who is not an admin", async () => {
    const madras = (await (await t.as((await t.signIn("sec@iitm-alumni.org")).cookie)("/association/reviews")).json() as any).items[0];
    const sec = await t.signIn("sec@iitd-alumni.org");
    expect((await post(sec.cookie, `/association/reviews/${madras.id}/resolve`, { resolution: "approve" })).status).toBe(403);
    const m = await t.signIn("sec@iitm-alumni.org");
    expect((await post(m.cookie, `/association/reviews/${madras.id}/resolve`, { resolution: "reject" })).status).toBe(400);
    expect((await post(m.cookie, `/association/reviews/${madras.id}/resolve`, { resolution: "clear_flag" })).status).toBe(400);
    const nobody = await t.signIn("random@gmail.com");
    expect((await t.as(nobody.cookie)("/association/reviews")).status).toBe(403);
  });
});

describe("in-app notifications (§11)", () => {
  it("lists the caller's feed newest first with titles and an unread count, and marks read", async () => {
    const alum = await t.signIn("delhi.alum@gmail.com");
    const before = await (await t.as(alum.cookie)("/me/notifications?unread=1")).json() as any;
    expect(before.unread).toBeGreaterThan(0);
    expect(before.items[0]).toMatchObject({ template: "verification_approved", readAt: null });
    expect(typeof before.items[0].title).toBe("string");
    const other = await t.signIn("madras.alum@gmail.com");
    // Someone else's ids are ignored.
    expect((await (await post(other.cookie, "/me/notifications/read", { ids: [before.items[0].id] })).json() as any).marked).toBe(0);
    expect((await (await post(alum.cookie, "/me/notifications/read", { ids: [before.items[0].id] })).json() as any).marked).toBe(1);
    expect((await post(alum.cookie, "/me/notifications/read", {})).status).toBe(200);
    expect((await (await t.as(alum.cookie)("/me/notifications")).json() as any).unread).toBe(0);
    expect((await t.app.request("/me/notifications")).status).toBe(401);
  });
});
