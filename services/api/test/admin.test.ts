import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "@zenhyre/db/orm";
import { schema } from "@zenhyre/db";
import { testApp } from "./helpers";

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
  await t.db.insert(schema.campus).values({ name: "IIT Bombay", shortCode: "IITB", emailDomains: ["iitb.ac.in"], rollNumberRegex: null, internalTier: 1 });
});
afterAll(() => t.close());

async function staff() {
  const s = await t.signIn("ops@novaretalent.com");
  await t.db.update(schema.user).set({ isStaff: true }).where(eq(schema.user.id, s.json.userId));
  return s.cookie;
}

describe("admin", () => {
  it("non-staff is forbidden", async () => {
    const { cookie } = await t.signIn("nobody@gmail.com");
    expect((await t.as(cookie)("/admin/reviews")).status).toBe(403);
  });
  it("staff lists the verification queue and approves via escape hatch, candidate is notified", async () => {
    const alum = await t.signIn("alum@gmail.com");
    await t.as(alum.cookie)("/candidates", { method: "POST", body: JSON.stringify({ name: "Test Candidate", campusShortCode: "IITB", gradDate: "2018-06-30", course: "B.Tech", claimed: { batch: "2018", branch: "EE", linkedinUrl: "" } }) });
    const cookie = await staff();
    const list = await (await t.as(cookie)("/admin/reviews?kind=verification&escapeHatchDays=0")).json() as any;
    expect(list.items).toHaveLength(1);
    const res = await t.as(cookie)(`/admin/reviews/${list.items[0].id}/resolve`, { method: "POST", body: JSON.stringify({ resolution: "approve", note: "degree cert seen" }) });
    expect(res.status).toBe(200);
    const [c] = await t.db.select().from(schema.candidate).where(eq(schema.candidate.userId, alum.json.userId));
    expect(c!.verificationState).toBe("verified");
    expect(c!.verificationSource).toBe("staff");
    expect(t.transport.sent.at(-1)!.subject).toMatch(/verified/i);
    const audit = await t.db.select().from(schema.staffAction);
    expect(audit).toHaveLength(1);
  });
  it("staff reads and updates config", async () => {
    const cookie = await staff();
    const put = await t.as(cookie)("/admin/config/match.broadcast_days", { method: "PUT", body: JSON.stringify({ value: 12 }) });
    expect(put.status).toBe(200);
    const get = await (await t.as(cookie)("/admin/config")).json() as any;
    expect(get["match.broadcast_days"]).toBe(12);
  });
  it("staff sees association-scoped verification items at once while the association has no admins (§6.2)", async () => {
    await t.db.insert(schema.campus).values({ name: "IIT Delhi", shortCode: "IITD", emailDomains: ["iitd.ac.in"], rollNumberRegex: null, internalTier: 1 });
    const cookie = await staff();
    const created = await t.as(cookie)("/admin/associations", { method: "POST", body: JSON.stringify({ campusShortCode: "IITD", name: "IITDAA", payoutMode: "cash" }) });
    const { association } = await created.json() as any;
    const alum = await t.signIn("alum2@gmail.com");
    await t.as(alum.cookie)("/candidates", { method: "POST", body: JSON.stringify({ name: "Test Candidate", campusShortCode: "IITD", gradDate: "2018-06-30", course: "B.Tech", claimed: { batch: "2018", branch: "EE", linkedinUrl: "" } }) });
    const queue = async () => (await (await t.as(cookie)("/admin/reviews?kind=verification")).json() as any).items;
    expect((await queue()).map((i: any) => i.associationId)).toEqual([association.id]);
    // once the association has an admin, its items wait for the escape hatch
    await t.db.insert(schema.associationAdmin).values({ userId: alum.json.userId, associationId: association.id });
    expect(await queue()).toHaveLength(0);
  });
});
