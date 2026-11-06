// Staff housekeeping around the hiring loop: merging duplicate companies (§6.4), the nightly status flip (§6.1) and the
// interim scheduler that runs the §18 jobs.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@zenhyre/db";
import { buildDeps } from "../src/context";
import { SCHEDULED_JOBS, type ScheduledJobName } from "../src/jobs";
import { CADENCE, dueJobs, tick, type LastRun } from "../src/scheduler";
import { DAY, body, post, world, type World } from "./world";

const HOUR = 60 * 60 * 1000;
let w: World;
beforeAll(async () => { w = await world(); });
afterAll(() => w.t.close());

describe("mergeCompanies (§6.4)", () => {
  it("moves the duplicate's roles and users to the survivor, on the record", async () => {
    const created = await w.rival.req(`/companies/${w.rivalCompanyId}/roles`, post({ title: "Rival's engineer", type: "fresher" }));
    const roleId = (await body(created)).role.id as string;
    const mine = await w.roleAt("draft", "Lab0's engineer");

    expect((await w.ceo.req(`/admin/companies/${w.rivalCompanyId}/merge`, post({ into: w.companyId }))).status).toBe(403);
    expect((await w.staff.req(`/admin/companies/${w.companyId}/merge`, post({ into: w.companyId }))).status).toBe(400);
    expect((await w.staff.req(`/admin/companies/00000000-0000-4000-8000-000000000000/merge`, post({ into: w.companyId }))).status).toBe(404);
    expect((await w.rival.req(`/roles/${mine}`)).status).toBe(403); // two companies, for now

    // A merge unlocks the absorbed company's users, so a banned company is not mergeable from either side.
    for (const banned of [w.rivalCompanyId, w.companyId]) {
      await w.t.db.update(schema.company).set({ status: "banned" }).where(eq(schema.company.id, banned));
      const refused = await w.staff.req(`/admin/companies/${w.rivalCompanyId}/merge`, post({ into: w.companyId }));
      expect(refused.status).toBe(409);
      expect(await body(refused)).toMatchObject({ error: "not_mergeable" });
      await w.t.db.update(schema.company).set({ status: "active" }).where(eq(schema.company.id, banned));
    }

    const res = await w.staff.req(`/admin/companies/${w.rivalCompanyId}/merge`, post({ into: w.companyId, note: "Same startup, two sign-ups." }));
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({ company: { id: w.companyId, name: "Lab0" }, rolesMoved: 1 });

    expect((await w.row(roleId)).companyId).toBe(w.companyId);
    expect((await body(await w.ceo.req(`/companies/${w.companyId}/roles`))).roles.map((r: any) => r.id)).toEqual(expect.arrayContaining([roleId, mine]));
    // The absorbed company's owner is now a member of the survivor, and the duplicate is gone.
    expect((await w.rival.req(`/roles/${mine}`)).status).toBe(200);
    expect(await w.t.db.select().from(schema.companyUser).where(eq(schema.companyUser.userId, w.rival.userId))).toMatchObject([{ companyId: w.companyId, role: "member" }]);
    expect(await w.t.db.select().from(schema.company).where(eq(schema.company.id, w.rivalCompanyId))).toEqual([]);
    const audit = await w.t.db.select().from(schema.staffAction).where(and(eq(schema.staffAction.refId, w.companyId), eq(schema.staffAction.action, "company.merge")));
    expect(audit[0]!.note).toMatch(/absorbed Rival .*1 roles moved\. Same startup, two sign-ups\./);
    expect((await w.staff.req(`/admin/companies/${w.rivalCompanyId}/merge`, post({ into: w.companyId }))).status).toBe(404); // nothing left to merge
  });
});

describe("candidate.status_flip (§6.1)", () => {
  it("moves a final-year student to alumnus on their graduation date", async () => {
    const s = await w.candidate("grad", 50); // graduates 2027-06-30
    const status = async () => (await w.t.db.select().from(schema.candidate).where(eq(schema.candidate.userId, s.userId)))[0]!.status;
    expect(await status()).toBe("final_year");
    expect(await w.runJob("candidate.status_flip")).toMatchObject({ job: "candidate.status_flip", candidates: 0 });
    w.t.clock.set("2027-06-30T00:00:00Z");
    await w.relogin(w.staff);
    expect(await w.runJob("candidate.status_flip")).toMatchObject({ candidates: 1 });
    expect(await status()).toBe("alumnus");
  });
});

describe("the interim scheduler (§18 cadence)", () => {
  const names = Object.keys(SCHEDULED_JOBS) as ScheduledJobName[];
  it("knows a cadence for every scheduled job", () => {
    expect(Object.keys(CADENCE).sort()).toEqual([...names].sort());
  });
  it("runs everything once at start-up, hourly jobs each hour and nightly jobs once per day, joining before guarantees", () => {
    const start = new Date("2026-11-05T10:00:00Z");
    expect(dueJobs(start, {})).toEqual(names);
    expect(names.indexOf("role.join_prompt")).toBeLessThan(names.indexOf("role.join_grace"));
    expect(names.indexOf("role.join_grace")).toBeLessThan(names.indexOf("role.guarantee_expiry"));
    const ran: LastRun = Object.fromEntries(names.map((n) => [n, start.getTime()]));
    expect(dueJobs(new Date(start.getTime() + HOUR - 1), ran)).toEqual([]);
    expect(dueJobs(new Date(start.getTime() + HOUR), ran)).toEqual(["role.close_broadcast", "role.terms_auto_release"]);
    expect(dueJobs(new Date("2026-11-05T23:59:59Z"), ran).filter((n) => CADENCE[n] === "nightly")).toEqual([]);
    expect(dueJobs(new Date("2026-11-06T00:00:00Z"), ran)).toEqual(names);
  });
  it("a tick runs what is due against the real jobs, and a failing job does not stop the rest or count as run", async () => {
    const deps = await buildDeps({ db: w.t.db, clock: w.t.clock, transport: w.t.transport, baseUrl: "http://test" });
    const lastRun: LastRun = {};
    expect(await tick(deps, lastRun)).toEqual(names);
    expect(await tick(deps, lastRun)).toEqual([]);
    w.t.clock.advance(DAY);
    const tried: string[] = [];
    const ran = await tick(deps, lastRun, async (name) => { tried.push(name); if (name === "role.dark_check") throw new Error("boom"); });
    expect(tried).toEqual(names);
    expect(ran).toEqual(names.filter((n) => n !== "role.dark_check"));
    expect(await tick(deps, lastRun, async () => {})).toEqual(["role.dark_check"]); // retried on the next tick
  });
});
