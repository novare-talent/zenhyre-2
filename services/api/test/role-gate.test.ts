// The gate's three stages, fee terms, and the guards on the company and candidate seats (spec §5, §7, §8).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@zenhyre/db";
import { fixtureGateModel, type GateRole } from "@zenhyre/gate";
import { testApp } from "./helpers";

const DAY = 24 * 60 * 60 * 1000, HOUR = 60 * 60 * 1000;
const L = (lakhs: number) => lakhs * 100_000 * 100;
const post = (body?: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body ?? {}) });
const put = (body: unknown): RequestInit => ({ method: "PUT", body: JSON.stringify(body) });
const body = async (res: Response) => (await res.json()) as any;

/** What the model "returns" for the next role; `null` means no model is configured for that test. */
const accepting = (r: GateRole) => ({ score: 85, suggested_reach: r.campusReach, concerns: [], reason: "A good fit for IIT talent." });
let respond: (r: GateRole) => unknown = accepting;

let t: Awaited<ReturnType<typeof testApp>>;
type Req = ReturnType<Awaited<ReturnType<typeof testApp>>["as"]>;
let staff: Req, staffId: string, ceo: Req, ceoEmail = "ceo@lab0.ai", companyId: string, iitb: string, iitd: string;
const subjects = (to: string) => t.transport.sent.filter((m) => m.to === to).map((m) => m.subject);

const good = { title: "Backend engineer", type: "fresher", jd: "You will build and run the services behind our booking product. ".repeat(4),
  ctcMin: L(12), ctcMax: L(16), yearsExpMin: 0, yearsExpMax: 1, locations: ["Bengaluru"], campusReach: ["IITB"] };
/** Creates and submits a role as the company; returns it as the company sees it once the gate job has run. */
async function submit(over: Record<string, unknown> = {}, as: Req = ceo, company = companyId) {
  const created = await as(`/companies/${company}/roles`, post({ ...good, ...over }));
  expect(created.status).toBe(201);
  const { role } = await body(created);
  const res = await as(`/roles/${role.id}/submit`, post());
  expect(res.status).toBe(200);
  return (await body(res)).role;
}
const gateItems = async (roleId: string) => (await body(await staff("/admin/reviews?kind=gate"))).items.filter((i: any) => i.refId === roleId);
const row = async (roleId: string) => (await t.db.select().from(schema.role).where(eq(schema.role.id, roleId)))[0]!;

beforeAll(async () => {
  t = await testApp("2026-11-05T10:00:00Z", { gateModel: fixtureGateModel((r: GateRole) => respond(r)) });
  const campuses = await t.db.insert(schema.campus).values([
    { name: "IIT Bombay", shortCode: "IITB", emailDomains: ["iitb.ac.in"] }, { name: "IIT Delhi", shortCode: "IITD", emailDomains: ["iitd.ac.in"] }]).returning();
  iitb = campuses[0]!.id; iitd = campuses[1]!.id;
  const s = await t.signIn("ops@novaretalent.com");
  staffId = s.json.userId;
  await t.db.update(schema.user).set({ isStaff: true }).where(eq(schema.user.id, staffId));
  staff = t.as(s.cookie);
  ceo = t.as((await t.signIn(ceoEmail)).cookie);
  companyId = (await body(await ceo("/companies", post({ name: "Lab0" })))).company.id;
});
afterAll(() => t.close());
beforeEach(() => { respond = accepting; });

describe("stage 1: rules", () => {
  it("rejects instantly and names the rule", async () => {
    const role = await submit({ title: "Field sales associate" });
    expect(role).toMatchObject({ status: "rejected", appealed: false, gate: { stage: "rules", outcome: "reject", rule: "Role category", reason: '"field sales" roles are not a fit for IIT talent.' } });
    expect(subjects(ceoEmail)).toContain("Role not accepted: Field sales associate");
    expect(await gateItems(role.id)).toEqual([]);
  });
  it("rejects a role below the CTC floor and one with fields missing", async () => {
    expect((await submit({ ctcMin: L(4), ctcMax: L(5) })).gate).toMatchObject({ rule: "Minimum CTC", reason: "The floor for fresher roles is ₹6 LPA. This band starts at ₹4 LPA." });
    expect((await submit({ jd: "Too short." })).gate).toMatchObject({ rule: "Required fields" });
    expect((await submit({ campusReach: [] })).gate).toMatchObject({ rule: "Required fields", reason: "Switch on at least one campus." });
  });
  it("reads the blocklist and CTC floors from config", async () => {
    await staff("/admin/config/gate.blocklist", put({ value: ["field sales", "bpo", "data entry", "unpaid", "telecaller"] }));
    expect((await submit({ title: "Telecaller" })).gate).toMatchObject({ rule: "Role category" });
    await staff("/admin/config/gate.blocklist", put({ value: ["field sales", "bpo", "data entry", "unpaid"] }));
    expect((await submit({ title: "Telecaller" })).status).toBe("terms_pending");
  });
});

describe("stage 2: model, on fixture responses", () => {
  it("accepts at or above the accept threshold and prefills terms by role type", async () => {
    const fresher = await submit();
    expect(fresher).toMatchObject({ status: "terms_pending", gate: { stage: "model", outcome: "accept" } });
    expect((await row(fresher.id)).feeTerms).toEqual({ kind: "percent", amount: 0.1, replacement_guarantee_days: 90 });
    const intern = await submit({ type: "intern", ctcMin: 12 * 6_000_000, ctcMax: 12 * 8_000_000, yearsExpMax: 0 });
    expect((await row(intern.id)).feeTerms).toEqual({ kind: "flat", amount: 1_250_000, replacement_guarantee_days: 90 });
    const senior = await submit({ type: "experienced", ctcMin: L(60), ctcMax: L(80), yearsExpMin: 10, yearsExpMax: 15 });
    expect((await row(senior.id)).feeTerms).toMatchObject({ kind: "percent", amount: 0.2 });
  });
  it("rejects below the reject threshold with the model's reason", async () => {
    respond = (r) => ({ score: 25, suggested_reach: r.campusReach, concerns: ["vague"], reason: "The role reads as generic support work." });
    const role = await submit();
    expect(role).toMatchObject({ status: "rejected", gate: { stage: "model", outcome: "reject", reason: "The role reads as generic support work." } });
    expect((await t.db.select().from(schema.roleGateDecision).where(eq(schema.roleGateDecision.roleId, role.id))).map((d) => d.stage).sort()).toEqual(["model", "rules"]);
  });
  it("sends the band between the thresholds to a person", async () => {
    respond = (r) => ({ score: 55, suggested_reach: r.campusReach, concerns: ["thin JD"], reason: "Borderline." });
    const role = await submit();
    expect(role).toMatchObject({ status: "gated", gate: { stage: "model", outcome: "needs_review" } });
    expect(role.gate).not.toHaveProperty("modelScore"); // internal
    const [item] = await gateItems(role.id);
    expect(item.payload).toMatchObject({ reason: "Borderline.", modelScore: 55, concerns: ["thin JD"], roleTitle: "Backend engineer" });
    expect(subjects(ceoEmail)).toContain("Role under review: Backend engineer");
  });
  it("sends a reach beyond the model's suggestion to a person, even at a high score", async () => {
    respond = () => ({ score: 92, suggested_reach: [iitb], concerns: [], reason: "Strong role." });
    const role = await submit({ campusReach: ["IITB", "IITD"] });
    expect(role.status).toBe("gated");
    expect((await gateItems(role.id))[0].payload).toMatchObject({ modelScore: 92, suggestedReach: [iitb] });
  });
  it("treats an invalid response as a job failure, never a decision: job_error and an alert, then a clean re-run", async () => {
    respond = () => ({ score: "very high" });
    const role = await submit();
    expect(role).toMatchObject({ status: "gated", gate: null });
    expect((await row(role.id)).jobError).toMatch(/^role\.gate: model response: score/);
    const alerts = (await body(await staff("/admin/reviews?kind=alert"))).items.filter((i: any) => i.refId === role.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].payload).toMatchObject({ job: "role.gate" });
    expect(await t.db.select().from(schema.roleGateDecision).where(eq(schema.roleGateDecision.roleId, role.id))).toHaveLength(0); // rolled back with the job

    respond = accepting;
    const rerun = await staff("/admin/jobs/role.gate/run", post({ roleId: role.id }));
    expect(await body(rerun)).toMatchObject({ ok: true });
    expect(await row(role.id)).toMatchObject({ status: "terms_pending", jobError: null });
    expect((await staff("/admin/jobs/role.nope/run", post())).status).toBe(404);
  });
});

describe("stage 3: human", () => {
  it("without a model, every role that passes the rules waits for a person", async () => {
    const bare = await testApp(); // no gateModel configured
    try {
      const s = await bare.signIn("ops@novaretalent.com");
      await bare.db.update(schema.user).set({ isStaff: true }).where(eq(schema.user.id, s.json.userId));
      await bare.db.insert(schema.campus).values({ name: "IIT Bombay", shortCode: "IITB", emailDomains: ["iitb.ac.in"] });
      const owner = bare.as((await bare.signIn("ceo@lab0.ai")).cookie);
      const company = (await body(await owner("/companies", post({ name: "Lab0" })))).company.id;
      const created = (await body(await owner(`/companies/${company}/roles`, post(good)))).role;
      const role = (await body(await owner(`/roles/${created.id}/submit`, post()))).role;
      expect(role).toMatchObject({ status: "gated", gate: { stage: "rules", outcome: "accept" } });
      const items = (await body(await bare.as(s.cookie)("/admin/reviews?kind=gate"))).items;
      expect(items).toHaveLength(1);
      expect(items[0].payload.reason).toMatch(/No model pass is configured/);
    } finally { await bare.close(); }
  });
  it("staff accept, optionally narrowing the reach; the item closes and the decision is audited", async () => {
    respond = () => ({ score: 92, suggested_reach: [iitb], concerns: [], reason: "Strong role." });
    const role = await submit({ campusReach: ["IITB", "IITD"] });
    const [item] = await gateItems(role.id);
    const res = await staff(`/admin/reviews/${item.id}/resolve`, post({ resolution: "accept", note: "Reach narrowed to the suggested campuses.", campusReach: ["IITB"] }));
    expect(await body(res)).toEqual({ ok: true, outcome: "accept" });
    expect(await row(role.id)).toMatchObject({ status: "terms_pending", campusReach: [iitb] });
    expect((await body(await ceo(`/roles/${role.id}`))).role.gate).toMatchObject({ stage: "human", outcome: "accept", reason: "Reach narrowed to the suggested campuses." });
    expect(await gateItems(role.id)).toEqual([]);
    const audit = await t.db.select().from(schema.staffAction).where(and(eq(schema.staffAction.refId, role.id), eq(schema.staffAction.action, "gate.accept")));
    expect(audit).toMatchObject([{ actorUserId: staffId, refType: "role" }]);
    expect(subjects(ceoEmail)).toContain("Role accepted: Backend engineer");
  });
  it("staff reject needs a reason, which the company is shown", async () => {
    respond = (r) => ({ score: 55, suggested_reach: r.campusReach, concerns: [], reason: "Borderline." });
    const role = await submit({ title: "Growth associate" });
    const [item] = await gateItems(role.id);
    expect((await staff(`/admin/reviews/${item.id}/resolve`, post({ resolution: "reject" }))).status).toBe(400);
    expect((await staff(`/admin/reviews/${item.id}/resolve`, post({ resolution: "maybe" }))).status).toBe(400);
    expect((await row(role.id)).status).toBe("gated");
    await staff(`/admin/reviews/${item.id}/resolve`, post({ resolution: "reject", note: "This is a sales role in practice." }));
    expect((await body(await ceo(`/roles/${role.id}`))).role).toMatchObject({ status: "rejected", gate: { stage: "human", outcome: "reject", reason: "This is a sales role in practice." } });
    expect(await gateItems(role.id)).toEqual([]);
  });
  it("a company on probation always goes to a person after the rules", async () => {
    const owner = t.as((await t.signIn("ceo@probation.dev")).cookie);
    const company = (await body(await owner("/companies", post({ name: "Probation Co" })))).company.id;
    await t.db.update(schema.company).set({ status: "probation" }).where(eq(schema.company.id, company));
    const role = await submit({}, owner, company);
    expect(role).toMatchObject({ status: "gated", gate: { stage: "rules", outcome: "accept" } });
    const [item] = await gateItems(role.id);
    expect(item.payload.reason).toMatch(/probation/);
    // …and pays the probation multiplier on its deposit (§9.1): 1 campus → ₹15k × 2.
    await staff(`/admin/reviews/${item.id}/resolve`, post({ resolution: "accept" }));
    await staff(`/admin/roles/${role.id}/release-terms`, post());
    expect((await body(await owner(`/roles/${role.id}/terms/accept`, post()))).role.depositAmount).toBe(3_000_000);
  });
});

describe("appeal (§5: once, within 14 days, straight to a person)", () => {
  it("re-enters the gate with a review item; a human accept moves it on", async () => {
    const role = await submit({ title: "Field sales associate" });
    t.clock.advance(3 * DAY);
    const res = await ceo(`/roles/${role.id}/appeal`, post({ note: "This is a solutions engineering role; the title is misleading." }));
    expect(res.status).toBe(200);
    expect((await body(res)).role).toMatchObject({ status: "gated", appealed: true });
    const [item] = await gateItems(role.id);
    expect(item.payload).toMatchObject({ appeal: true, note: expect.stringMatching(/solutions engineering/), rejectedFor: expect.stringMatching(/field sales/) });
    // The gate job does not re-run stages 1 and 2 on an appeal.
    expect(await body(await staff("/admin/jobs/role.gate/run", post({ roleId: role.id })))).toMatchObject({ ok: true });
    expect((await row(role.id)).status).toBe("gated");
    await staff(`/admin/reviews/${item.id}/resolve`, post({ resolution: "accept", note: "Agreed on review." }));
    expect((await row(role.id)).status).toBe("terms_pending");
    expect((await ceo(`/roles/${role.id}/appeal`, post())).status).toBe(409); // not rejected any more
  });
  it("is refused a second time and after the window", async () => {
    const twice = await submit({ title: "Field sales associate" });
    await ceo(`/roles/${twice.id}/appeal`, post());
    const [item] = await gateItems(twice.id);
    await staff(`/admin/reviews/${item.id}/resolve`, post({ resolution: "reject", note: "Still field sales." }));
    const again = await ceo(`/roles/${twice.id}/appeal`, post());
    expect(again.status).toBe(400);
    expect((await body(again)).message).toMatch(/already been appealed/);

    const late = await submit({ title: "BPO team lead" });
    t.clock.advance(15 * DAY);
    const res = await ceo(`/roles/${late.id}/appeal`, post());
    expect(res.status).toBe(400);
    expect((await body(res)).message).toMatch(/appeal window has closed/);
  });
});

describe("fee terms (§7)", () => {
  it("stay hidden until released; staff can edit them first", async () => {
    const role = await submit();
    expect((await body(await ceo(`/roles/${role.id}`))).role.feeTerms).toBeNull();
    const edited = { kind: "percent", amount: 0.08, replacement_guarantee_days: 60, notes: "Negotiated: second role this quarter." };
    expect((await ceo(`/admin/roles/${role.id}/fee-terms`, put(edited))).status).toBe(403);
    expect((await staff(`/admin/roles/${role.id}/fee-terms`, put({ ...edited, amount: 8 }))).status).toBe(400);
    expect((await staff(`/admin/roles/${role.id}/fee-terms`, put(edited))).status).toBe(200);
    await staff(`/admin/roles/${role.id}/release-terms`, post());
    expect((await body(await ceo(`/roles/${role.id}`))).role.feeTerms).toEqual(edited);
    const before = subjects(ceoEmail).filter((s) => s.startsWith("Fee terms ready")).length;
    await staff(`/admin/roles/${role.id}/release-terms`, post()); // a second release tells nobody
    expect(subjects(ceoEmail).filter((s) => s.startsWith("Fee terms ready")).length).toBe(before);
  });
  it("auto-release 48 hours after acceptance if staff do nothing", async () => {
    const role = await submit({ title: "Platform engineer" });
    t.clock.advance(47 * HOUR);
    await staff("/admin/jobs/role.terms_auto_release/run", post());
    expect((await row(role.id)).feeTermsReleasedAt).toBeNull();
    t.clock.advance(2 * HOUR);
    await staff("/admin/jobs/role.terms_auto_release/run", post());
    expect((await row(role.id)).feeTermsReleasedAt).toEqual(t.clock.now());
    expect(subjects(ceoEmail)).toContain("Fee terms ready: Platform engineer");
    expect((await body(await ceo(`/roles/${role.id}`))).role.feeTerms).toMatchObject({ kind: "percent", amount: 0.1 });
  });
  it("prices the deposit by the number of campuses (§2)", async () => {
    await t.db.insert(schema.campus).values(Array.from({ length: 5 }, (_, i) => ({ name: `IIT Test ${i}`, shortCode: `IITT${i}`, emailDomains: [`t${i}.ac.in`] })));
    const role = await submit({ campusReach: ["IITB", "IITD", "IITT0", "IITT1", "IITT2", "IITT3"] });
    await staff(`/admin/roles/${role.id}/release-terms`, post());
    expect((await body(await ceo(`/roles/${role.id}/terms/accept`, post()))).role).toMatchObject({ status: "deposit_pending", depositAmount: 3_000_000 });
  });
});

describe("guards", () => {
  it("everything needs a session", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    for (const [method, path] of [["GET", `/companies/${id}/roles`], ["POST", `/companies/${id}/roles`], ["GET", `/roles/${id}`], ["PATCH", `/roles/${id}`],
      ["POST", `/roles/${id}/submit`], ["POST", `/roles/${id}/terms/accept`], ["GET", `/roles/${id}/shortlist`], ["POST", `/matches/${id}/actions`],
      ["GET", "/me/roles"], ["POST", `/me/roles/${id}/apply`], ["GET", "/me/applications"], ["POST", `/me/applications/${id}/withdraw`],
      ["GET", "/admin/roles"], ["POST", `/admin/roles/${id}/waive-deposit`], ["POST", "/admin/jobs/role.close_broadcast/run"]] as const) {
      expect((await t.app.request(path, { method })).status, `${method} ${path}`).toBe(401);
    }
  });
  it("a company sees and changes only its own roles; staff-only routes refuse it", async () => {
    const role = await submit();
    const rival = t.as((await t.signIn("founder@rival.io")).cookie);
    const rivalCompany = (await body(await rival("/companies", post({ name: "Rival" })))).company.id;
    expect((await rival(`/roles/${role.id}`)).status).toBe(403);
    expect((await rival(`/companies/${companyId}/roles`)).status).toBe(403);
    expect((await rival(`/companies/${companyId}/roles`, post(good))).status).toBe(403);
    expect((await rival(`/roles/${role.id}/submit`, post())).status).toBe(403);
    expect((await rival(`/roles/${role.id}/appeal`, post())).status).toBe(403);
    expect((await body(await rival(`/companies/${rivalCompany}/roles`))).roles).toEqual([]);
    expect((await body(await ceo(`/companies/${companyId}/roles`))).roles.map((r: any) => r.id)).toContain(role.id);
    for (const path of ["/admin/roles", `/admin/roles/${role.id}`]) expect((await ceo(path)).status).toBe(403);
    expect((await ceo("/admin/jobs/role.close_broadcast/run", post())).status).toBe(403);
    expect((await body(await staff("/admin/roles?status=terms_pending"))).roles.map((r: any) => r.id)).toContain(role.id);
    expect((await staff("/admin/roles?status=nope")).status).toBe(400);
  });
  it("a locked company user is shut out", async () => {
    const owner = t.as((await t.signIn("ceo@locked.dev")).cookie);
    const company = (await body(await owner("/companies", post({ name: "Locked Co" })))).company.id;
    const role = await submit({}, owner, company);
    await t.db.update(schema.companyUser).set({ lockedAt: new Date() }).where(eq(schema.companyUser.companyId, company));
    expect((await owner(`/roles/${role.id}`)).status).toBe(403);
    expect((await owner(`/companies/${company}/roles`, post(good))).status).toBe(403);
  });
  it("answers malformed ids, unknown roles and bad bodies without a 500", async () => {
    expect((await ceo("/roles/not-a-uuid")).status).toBe(404);
    expect((await ceo("/roles/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await ceo("/matches/not-a-uuid/actions", post({ stage: "viewed" }))).status).toBe(404);
    expect((await ceo(`/companies/${companyId}/roles`, post({ title: "", type: "fresher" }))).status).toBe(400);
    expect((await ceo(`/companies/${companyId}/roles`, post({ title: "X", type: "contractor" }))).status).toBe(400);
    expect((await ceo(`/companies/${companyId}/roles`, post({ ...good, ctcMin: -1 }))).status).toBe(400);
    const unknown = await ceo(`/companies/${companyId}/roles`, post({ ...good, campusReach: ["IITX"] }));
    expect(unknown.status).toBe(400);
    expect((await body(unknown)).message).toBe("unknown campus: IITX");
    const role = await submit();
    expect((await ceo(`/matches/${role.id}/actions`, post({ stage: "scored" }))).status).toBe(400);
    expect((await ceo(`/roles/${role.id}/submit`, post())).status).toBe(409); // already past draft
  });
});

describe("freeze against late applications", () => {
  it("an application racing the freeze is either on the frozen list or refused, never added behind it", async () => {
    const role = await submit({ title: "Site reliability engineer" });
    await staff(`/admin/roles/${role.id}/release-terms`, post());
    await ceo(`/roles/${role.id}/terms/accept`, post());
    await staff(`/admin/roles/${role.id}/waive-deposit`, post({ note: "Pilot." }));
    const seats: Req[] = [];
    for (let i = 0; i < 6; i++) {
      const s = t.as((await t.signIn(`race${i}@iitb.ac.in`)).cookie);
      await s("/candidates", post({ gradDate: "2027-06-30", course: "B.Tech", rollNumber: null }));
      seats.push(s);
    }
    const [frozen, ...applies] = await Promise.all([
      staff(`/admin/roles/${role.id}/close-broadcast`, post({ note: "Closing now." })),
      ...seats.map((s) => s(`/me/roles/${role.id}/apply`, post())),
    ]);
    const { shortlisted } = await body(frozen!);
    const accepted = applies.filter((r) => r.status === 201).length;
    expect(applies.every((r) => r.status === 201 || r.status === 403)).toBe(true);
    const matches = await t.db.select().from(schema.match).where(eq(schema.match.roleId, role.id));
    expect(matches.filter((m) => m.appliedAt !== null)).toHaveLength(accepted);
    expect(matches.filter((m) => m.rank !== null)).toHaveLength(shortlisted);
    expect(matches.filter((m) => m.stage === "shortlisted")).toHaveLength(shortlisted);
    expect(shortlisted).toBe(accepted); // everyone who got in before the freeze is on the list (cap 25), nobody after it
  });
});

describe("after the freeze", () => {
  it("staff can close a broadcast early; a candidate who withdraws from a visible shortlist is reported to the company", async () => {
    const role = await submit({ title: "Data engineer" });
    await staff(`/admin/roles/${role.id}/release-terms`, post());
    await ceo(`/roles/${role.id}/terms/accept`, post());
    await staff(`/admin/roles/${role.id}/waive-deposit`, post({ note: "Pilot." }));
    const [a, b] = [await t.signIn("a1@iitb.ac.in"), await t.signIn("b1@iitb.ac.in")];
    const apps: string[] = [];
    for (const s of [a, b]) {
      await t.as(s.cookie)("/candidates", post({ gradDate: "2027-06-30", course: "B.Tech", rollNumber: null }));
      apps.push((await body(await t.as(s.cookie)(`/me/roles/${role.id}/apply`, post()))).application.id);
    }
    expect((await staff(`/admin/roles/${role.id}/close-broadcast`, post({}))).status).toBe(400); // needs a note
    const closed = await staff(`/admin/roles/${role.id}/close-broadcast`, post({ note: "Company asked to move early." }));
    expect(await body(closed)).toMatchObject({ frozen: true, shortlisted: 2, role: { status: "shortlist_ready" } });
    expect((await staff(`/admin/roles/${role.id}/close-broadcast`, post({ note: "again" }))).status).toBe(409);
    const events = (await body(await staff(`/admin/roles/${role.id}`))).events;
    expect(events.at(-1)).toMatchObject({ toStatus: "shortlist_ready", actor: staffId, note: "Company asked to move early." });

    // A plain withdrawal.
    const w = await t.as(a.cookie)(`/me/applications/${apps[0]}/withdraw`, post());
    expect((await body(w)).application.stage).toBe("withdrawn");
    expect(subjects(ceoEmail)).toContain("Update on Data engineer");
    expect((await t.as(a.cookie)(`/me/applications/${apps[0]}/withdraw`, post())).status).toBe(409); // already withdrawn

    // Backing out after accepting an offer is an offer_reneged, not a withdrawal (§4.3).
    for (const step of [{ stage: "viewed" }, { stage: "interviewed" }, { stage: "offered", offeredCtc: L(14) }, { stage: "offer_accepted" }]) {
      expect((await ceo(`/matches/${apps[1]}/actions`, post(step))).status).toBe(200);
    }
    const reneged = await t.as(b.cookie)(`/me/applications/${apps[1]}/withdraw`, post());
    expect((await body(reneged)).application).toMatchObject({ stage: "offer_reneged", canWithdraw: false });
    expect((await ceo(`/matches/${apps[1]}/actions`, post({ stage: "hired", hiredCtc: L(14), joinedOn: "2026-12-01" }))).status).toBe(409);
    // "Left early" needs the replacement-role workflow, which is not in this slice.
    expect((await body(await ceo(`/matches/${apps[1]}/actions`, post({ stage: "left_early" })))).error).toBe("not_supported");
  });
});


describe("broadcast extension (§5: staff, once, by 7 days, under 10 applicants)", () => {
  const toBroadcast = async (title: string) => {
    const role = await submit({ title });
    await staff(`/admin/roles/${role.id}/release-terms`, post());
    await ceo(`/roles/${role.id}/terms/accept`, post());
    return role.id as string;
  };
  it("moves the close date out once, on the record, and tells the company", async () => {
    const id = await toBroadcast("ML engineer");
    expect((await staff(`/admin/roles/${id}/extend-broadcast`, post())).status).toBe(400); // not in broadcast yet
    await staff(`/admin/roles/${id}/waive-deposit`, post({ note: "Pilot." }));
    const closes = (await row(id)).broadcastClosesAt!;
    expect((await ceo(`/admin/roles/${id}/extend-broadcast`, post())).status).toBe(403);

    const res = await staff(`/admin/roles/${id}/extend-broadcast`, post({ note: "Two applicants so far." }));
    expect(res.status).toBe(200);
    expect(await row(id)).toMatchObject({ status: "broadcast", broadcastClosesAt: new Date(closes.getTime() + 7 * DAY), broadcastExtendedAt: t.clock.now() });
    expect(subjects(ceoEmail)).toContain("Broadcast extended: ML engineer");
    const audit = await t.db.select().from(schema.staffAction).where(and(eq(schema.staffAction.refId, id), eq(schema.staffAction.action, "role.broadcast.extend")));
    expect(audit).toMatchObject([{ actorUserId: staffId, note: "Two applicants so far." }]);

    const again = await staff(`/admin/roles/${id}/extend-broadcast`, post());
    expect(again.status).toBe(400);
    expect((await body(again)).message).toMatch(/already been extended/);
    expect((await row(id)).broadcastClosesAt).toEqual(new Date(closes.getTime() + 7 * DAY));
  });
  it("is refused once the role has enough applicants", async () => {
    const id = await toBroadcast("Research engineer");
    await staff(`/admin/roles/${id}/waive-deposit`, post({ note: "Pilot." }));
    await staff("/admin/config/match.extension_min_applicants", put({ value: 1 }));
    const s = t.as((await t.signIn("ext1@iitb.ac.in")).cookie);
    await s("/candidates", post({ gradDate: "2027-06-30", course: "B.Tech", rollNumber: null }));
    expect((await s(`/me/roles/${id}/apply`, post())).status).toBe(201);
    const res = await staff(`/admin/roles/${id}/extend-broadcast`, post());
    expect(res.status).toBe(409);
    expect(await body(res)).toMatchObject({ error: "not_extendable" });
    expect((await row(id)).broadcastExtendedAt).toBeNull();
    await staff("/admin/config/match.extension_min_applicants", put({ value: 10 }));
  });
});
