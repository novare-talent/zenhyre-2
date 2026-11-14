import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "@zenhyre/db/orm";
import { schema } from "@zenhyre/db";
import { fixtureGateModel } from "@zenhyre/gate";
import { testApp } from "./helpers";
import { startPgBoss } from "../src/pgboss";
import type { JobQueue } from "../src/jobs";

// pg-boss keeps real time, so this test runs on the system clock.
let t: Awaited<ReturnType<typeof testApp>>;
let started: ReturnType<typeof startPgBoss> | undefined;
const L = (lakhs: number) => lakhs * 100_000 * 100;

beforeAll(async () => {
  t = await testApp(new Date().toISOString(), {
    gateModel: fixtureGateModel((r) => ({ score: 85, suggested_reach: r.campusReach, concerns: [], reason: "A good fit." })),
    // Workflows enqueue onto pg-boss instead of running the job inside the request.
    // Started on the first enqueue, once `t` (and its database URL) exists.
    jobs: (deps): JobQueue => ({
      enqueue: async (name, payload) => { started ??= startPgBoss(deps, t.url, { schedules: false }); return (await started).queue.enqueue(name, payload); },
    }),
  });
  await t.db.insert(schema.campus).values({ name: "IIT Bombay", shortCode: "IITB", emailDomains: ["iitb.ac.in"] });
}, 30_000);
afterAll(async () => { await (await started)?.stop(); await t.close(); });

describe("jobs on pg-boss (§3.2, §13)", () => {
  it("runs the gate job a submit enqueues, outside the request, in the pgboss schema", async () => {
    const ceo = await t.signIn("ceo@lab0.ai");
    const req = t.as(ceo.cookie);
    const { company } = await (await req("/companies", { method: "POST", body: JSON.stringify({ name: "Lab0" }) })).json() as any;
    const { role } = await (await req(`/companies/${company.id}/roles`, { method: "POST", body: JSON.stringify({
      title: "Backend engineer", type: "fresher", jd: "You will build and run the services behind our booking product. ".repeat(4),
      ctcMin: L(12), ctcMax: L(16), yearsExpMin: 0, yearsExpMax: 1, locations: ["Bengaluru"], campusReach: ["IITB"] }) })).json() as any;
    expect((await req(`/roles/${role.id}/submit`, { method: "POST", body: "{}" })).status).toBe(200);

    let status = "";
    for (let i = 0; i < 60 && status !== "terms_pending"; i++) {
      status = (await t.db.select().from(schema.role).where(eq(schema.role.id, role.id)))[0]!.status;
      if (status !== "terms_pending") await new Promise((r) => setTimeout(r, 250));
    }
    expect(status).toBe("terms_pending");
    const [{ n }] = await t.db.execute(sql`select count(*)::int as n from pgboss.job where name = 'role_gate' and state = 'completed'`) as any;
    expect(n).toBe(1);
  }, 30_000);
});
