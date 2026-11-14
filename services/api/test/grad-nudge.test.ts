import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "@zenhyre/db/orm";
import { schema } from "@zenhyre/db";
import { testApp } from "./helpers";

let t: Awaited<ReturnType<typeof testApp>>;
let staff: string;
const DAY = 24 * 3600 * 1000;
const run = async () => (await (await t.as(staff)("/admin/jobs/candidate.grad_nudge/run", { method: "POST", body: "{}" })).json() as any).candidates;
const nudges = async (userId: string) => (await t.db.select().from(schema.notification).where(eq(schema.notification.userId, userId)))
  .filter((n) => n.template === "add_personal_email" && n.channel === "in_app").map((n) => (n.data as any).offset);

beforeAll(async () => {
  t = await testApp("2027-05-01T10:00:00Z");
  await t.db.insert(schema.campus).values({ name: "IIT Bombay", shortCode: "IITB", emailDomains: ["iitb.ac.in"], rollNumberRegex: null, internalTier: 1 });
  const s = await t.signIn("ops@novaretalent.com");
  await t.db.update(schema.user).set({ isStaff: true }).where(eq(schema.user.id, s.json.userId));
  staff = s.cookie;
});
afterAll(() => t.close());

describe("candidate.grad_nudge (§6.1 graduation handoff)", () => {
  it("nudges 60 days before and 30 days after grad_date, once each, and stops once a personal email is verified", async () => {
    // grad_date 2027-06-30 is 60 days after 2027-05-01.
    const a = await t.signIn("22b0001@iitb.ac.in");
    expect((await t.as(a.cookie)("/candidates", { method: "POST", body: JSON.stringify({ gradDate: "2027-06-30", course: "B.Tech", rollNumber: "22b0001" }) })).status).toBe(201);
    const b = await t.signIn("22b0002@iitb.ac.in"); // graduates far later: not due
    await t.as(b.cookie)("/candidates", { method: "POST", body: JSON.stringify({ gradDate: "2028-06-30", course: "B.Tech", rollNumber: "22b0002" }) });

    expect(await run()).toBe(1);
    expect(await nudges(a.json.userId)).toEqual([-60]);
    expect(await run()).toBe(0); // same night, or the next: never twice for the same offset
    t.clock.advance(3 * DAY);
    expect(await run()).toBe(0);
    expect(await nudges(b.json.userId)).toEqual([]);

    // 30 days after graduation.
    t.clock.set("2027-07-30T10:00:00Z");
    expect(await run()).toBe(1);
    expect((await nudges(a.json.userId)).sort()).toEqual([-60, 30]);
  });
  it("skips a candidate who already has a verified personal address, and one whose window has passed", async () => {
    t.clock.set("2027-05-01T10:00:00Z");
    const c = await t.signIn("22b0003@iitb.ac.in");
    await t.as(c.cookie)("/candidates", { method: "POST", body: JSON.stringify({ gradDate: "2027-06-30", course: "B.Tech", rollNumber: "22b0003" }) });
    await t.db.insert(schema.userEmail).values({ userId: c.json.userId, email: "me@gmail.com", verifiedAt: new Date(), isPrimary: false });
    const d = await t.signIn("22b0004@iitb.ac.in");
    await t.as(d.cookie)("/candidates", { method: "POST", body: JSON.stringify({ gradDate: "2027-06-15", course: "B.Tech", rollNumber: "22b0004" }) });
    t.clock.set("2027-05-01T10:00:00Z"); // 22b0004's -60 day fell on 2027-04-16: outside the 7-day catch-up window
    expect(await run()).toBe(0);
  });
});
