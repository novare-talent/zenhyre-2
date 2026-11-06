// How a role ends in Slice 1 (spec §3.3, §5, §9.1, §14): withdraw at each open state and its refusal elsewhere, the
// terms timeout, the waived path through hire and guarantee expiry to `closed`, and the dark check.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { schema } from "@zenhyre/db";
import { fixtureGateModel, type GateRole } from "@zenhyre/gate";
import { fixedScorer } from "@zenhyre/matching";
import { IllegalTransition } from "@zenhyre/shared";
import { buildDeps } from "../src/context";
import { closeRole } from "../src/workflows/closeRole";
import { guaranteeExpiry } from "../src/workflows/guaranteeExpiry";
import { testApp } from "./helpers";

const DAY = 24 * 60 * 60 * 1000, MINUTE = 60 * 1000;
const L = (lakhs: number) => lakhs * 100_000 * 100;
const post = (body?: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body ?? {}) });
const body = async (res: Response) => (await res.json()) as any;
const good = { type: "fresher", jd: "You will build and run the services behind our booking product. ".repeat(4),
  ctcMin: L(12), ctcMax: L(16), yearsExpMin: 0, yearsExpMax: 1, locations: ["Bengaluru"], campusReach: ["IITB"] };

type Req = ReturnType<Awaited<ReturnType<typeof testApp>>["as"]>;
interface Seat { email: string; userId: string; req: Req }
type Before = "draft" | "gated" | "rejected" | "terms_pending" | "terms_released" | "deposit_pending" | "broadcast";

/** A fresh database with one campus, a staff seat, a company and its rival. Each describe gets its own, so one block's clock cannot age another's roles. */
async function world() {
  const scores: Record<string, number> = {};
  let borderline = false;
  const t = await testApp("2026-11-05T10:00:00Z", {
    scorer: fixedScorer(scores),
    gateModel: fixtureGateModel((r: GateRole) => ({ score: borderline ? 55 : 85, suggested_reach: r.campusReach, concerns: [], reason: borderline ? "Borderline." : "A good fit." })),
  });
  await t.db.insert(schema.campus).values({ name: "IIT Bombay", shortCode: "IITB", emailDomains: ["iitb.ac.in"] });

  const seat = async (email: string): Promise<Seat> => {
    const s = await t.signIn(email);
    return { email, userId: s.json.userId, req: t.as(s.cookie) };
  };
  /** Sessions last 30 days: sign in again after moving the clock a long way. */
  const relogin = async (...seats: Seat[]) => { for (const s of seats) s.req = (await seat(s.email)).req; };

  const staff = await seat("ops@novaretalent.com");
  await t.db.update(schema.user).set({ isStaff: true }).where(eq(schema.user.id, staff.userId));
  const ceo = await seat("ceo@lab0.ai");
  const companyId = (await body(await ceo.req("/companies", post({ name: "Lab0" })))).company.id as string;
  const rival = await seat("founder@rival.io");
  await rival.req("/companies", post({ name: "Rival" }));

  /** A final-year IIT Bombay candidate with a fixed fit score, so shortlist order is known. */
  async function candidate(name: string, score: number): Promise<Seat> {
    const s = await seat(`${name}@iitb.ac.in`);
    expect((await s.req("/candidates", post({ gradDate: "2027-06-30", course: "B.Tech CSE", rollNumber: null }))).status).toBe(201);
    scores[s.userId] = score;
    return s;
  }

  /** Creates a role as the company and walks it to `status` through the real routes. */
  async function roleAt(status: Before, title: string): Promise<string> {
    const created = await ceo.req(`/companies/${companyId}/roles`, post({ ...good, title, ...(status === "rejected" ? { jd: "Too short." } : {}) }));
    expect(created.status).toBe(201);
    const id = (await body(created)).role.id as string;
    if (status === "draft") return id;
    borderline = status === "gated"; // a borderline score waits for a person, so the role stays `gated`
    const submitted = await ceo.req(`/roles/${id}/submit`, post());
    borderline = false;
    expect(submitted.status).toBe(200);
    if (status === "gated" || status === "rejected" || status === "terms_pending") return id;
    expect((await staff.req(`/admin/roles/${id}/release-terms`, post())).status).toBe(200);
    if (status === "terms_released") return id;
    expect((await ceo.req(`/roles/${id}/terms/accept`, post())).status).toBe(200);
    if (status === "deposit_pending") return id;
    expect((await staff.req(`/admin/roles/${id}/waive-deposit`, post({ note: "Pilot customer." }))).status).toBe(200);
    return id;
  }
  /** A role in `shortlist_ready` with `applicants` on its shortlist; returns each one's match id, by email. */
  async function shortlisted(title: string, applicants: Seat[]) {
    const id = await roleAt("broadcast", title);
    const match: Record<string, string> = {};
    for (const s of applicants) {
      const res = await s.req(`/me/roles/${id}/apply`, post());
      expect(res.status).toBe(201);
      match[s.email] = (await body(res)).application.id;
    }
    expect((await staff.req(`/admin/roles/${id}/close-broadcast`, post({ note: "Company asked to move early." }))).status).toBe(200);
    return { id, match };
  }
  const act = (matchId: string, payload: Record<string, unknown>) => ceo.req(`/matches/${matchId}/actions`, post(payload));
  /** Takes a shortlisted match all the way to `hired`. */
  async function hire(matchId: string, joinedOn: string) {
    for (const step of [{ stage: "viewed" }, { stage: "interviewed" }, { stage: "offered", offeredCtc: L(14) }, { stage: "offer_accepted" },
      { stage: "hired", hiredCtc: L(14), joinedOn }]) {
      expect((await act(matchId, step)).status, step.stage).toBe(200);
    }
  }

  const row = async (roleId: string) => (await t.db.select().from(schema.role).where(eq(schema.role.id, roleId)))[0]!;
  const events = (roleId: string) => t.db.select().from(schema.roleEvent).where(eq(schema.roleEvent.roleId, roleId)).orderBy(asc(schema.roleEvent.seq));
  /** candidate user id → their match on the role. */
  const matches = async (roleId: string) => new Map((await t.db.select().from(schema.match).where(eq(schema.match.roleId, roleId))).map((m) => [m.candidateId, m]));
  const stages = async (roleId: string, ...seats: Seat[]) => { const all = await matches(roleId); return seats.map((s) => all.get(s.userId)?.stage); };
  const subjects = (s: Seat) => t.transport.sent.filter((m) => m.to === s.email).map((m) => m.subject);
  /** How many times a candidate was told the role closed. */
  const toldClosed = (s: Seat, title: string) => t.transport.sent.filter((m) => m.to === s.email && m.subject === `Update on ${title}` && m.text === "Status: role_closed").length;
  const runJob = async (name: string) => { const res = await staff.req(`/admin/jobs/${name}/run`, post()); expect(res.status).toBe(200); return body(res); };
  const withdraw = (who: Seat, roleId: string, note?: string) => who.req(`/roles/${roleId}/withdraw`, post(note === undefined ? {} : { note }));

  return { t, staff, ceo, rival, companyId, seat, relogin, candidate, roleAt, shortlisted, act, hire, row, events, matches, stages, subjects, toldClosed, runJob, withdraw };
}
type World = Awaited<ReturnType<typeof world>>;

describe("withdraw (§5: any open state, by the company or staff)", () => {
  let w: World, a: Seat, b: Seat, c: Seat, d: Seat;
  beforeAll(async () => {
    w = await world();
    [a, b, c, d] = [await w.candidate("a", 80), await w.candidate("b", 70), await w.candidate("c", 60), await w.candidate("d", 50)];
  });
  afterAll(() => w.t.close());

  for (const status of ["draft", "gated", "terms_pending", "deposit_pending"] as const) {
    it(`from ${status}: the role is withdrawn, the move is on record and the company is told`, async () => {
      const title = `Engineer, ${status}`;
      const id = await w.roleAt(status, title);
      expect((await w.row(id)).status).toBe(status);
      const res = await w.withdraw(w.ceo, id, "  Hiring freeze.  ");
      expect(res.status).toBe(200);
      expect((await body(res)).role).toMatchObject({ id, status: "withdrawn" });
      expect((await w.events(id)).at(-1)).toMatchObject({ fromStatus: status, toStatus: "withdrawn", actor: w.ceo.userId, note: "Hiring freeze." });
      expect(w.subjects(w.ceo).filter((s) => s === `Role closed: ${title}`)).toHaveLength(1);
      // Slice 1 holds no deposit: resolving it wrote nothing and left the role where the withdrawal put it.
      expect(await w.row(id)).toMatchObject({ status: "withdrawn", refundOwed: null });
    });
  }

  it("a gate decision that arrives after the withdrawal changes nothing", async () => {
    const id = await w.roleAt("gated", "Engineer, gated then decided");
    expect((await w.withdraw(w.ceo, id)).status).toBe(200);
    expect(await body(await w.staff.req("/admin/jobs/role.gate/run", post({ roleId: id })))).toMatchObject({ ok: true });
    const [item] = (await body(await w.staff.req("/admin/reviews?kind=gate"))).items.filter((i: any) => i.refId === id);
    expect(await body(await w.staff.req(`/admin/reviews/${item.id}/resolve`, post({ resolution: "accept" })))).toEqual({ ok: true, outcome: "noop" });
    expect((await w.row(id)).status).toBe("withdrawn");
    expect((await w.events(id)).at(-1)!.toStatus).toBe("withdrawn");
  });

  it("from broadcast: open matches close, applicants are told, candidates who were only scored are not", async () => {
    const title = "Engineer, broadcast";
    const id = await w.roleAt("broadcast", title);
    const applied = (await body(await a.req(`/me/roles/${id}/apply`, post()))).application.id as string;
    const gone = (await body(await c.req(`/me/roles/${id}/apply`, post()))).application.id as string;
    expect((await c.req(`/me/applications/${gone}/withdraw`, post())).status).toBe(200);
    expect(await w.stages(id, a, b, c, d)).toEqual(["shortlisted", "scored", "withdrawn", "scored"]);

    expect((await w.withdraw(w.ceo, id)).status).toBe(200);
    expect((await w.events(id)).at(-1)).toMatchObject({ fromStatus: "broadcast", toStatus: "withdrawn", actor: w.ceo.userId, note: null });
    // Every open match is closed by the system; the candidate's own withdrawal is settled and stays as it was.
    expect(await w.stages(id, a, b, c, d)).toEqual(["role_closed", "role_closed", "withdrawn", "role_closed"]);
    const trail = await w.t.db.select().from(schema.matchEvent).where(eq(schema.matchEvent.matchId, applied)).orderBy(asc(schema.matchEvent.seq));
    expect(trail.at(-1)).toMatchObject({ fromStage: "shortlisted", toStage: "role_closed", actor: "system" });
    expect([a, b, c, d].map((s) => w.toldClosed(s, title))).toEqual([1, 0, 0, 0]);
    expect(w.subjects(w.ceo)).toContain(`Role closed: ${title}`);

    // Nothing about the role is live any more.
    expect((await body(await a.req("/me/applications"))).applications.find((x: any) => x.id === applied)).toMatchObject({ stage: "role_closed", canWithdraw: false });
    expect((await body(await b.req("/me/roles"))).roles.map((r: any) => r.id)).not.toContain(id);
    expect((await b.req(`/me/roles/${id}/apply`, post())).status).toBe(403);
    expect(await body(await w.staff.req("/admin/jobs/role.broadcast/run", post({ roleId: id })))).toMatchObject({ ok: true });
    expect(await w.stages(id, b)).toEqual(["role_closed"]);
  });

  it("from shortlist_ready, by staff: settled matches are untouched and the withdrawal is audited", async () => {
    const title = "Engineer, shortlist";
    const { id, match } = await w.shortlisted(title, [a, b, c, d]);
    for (const step of [{ stage: "viewed" }, { stage: "interviewed" }]) expect((await w.act(match[a.email]!, step)).status).toBe(200);
    expect((await w.act(match[b.email]!, { stage: "rejected", rejectionCategory: "experience" })).status).toBe(200);
    expect((await d.req(`/me/applications/${match[d.email]}/withdraw`, post())).status).toBe(200);
    expect(await w.stages(id, a, b, c, d)).toEqual(["interviewed", "rejected", "shortlisted", "withdrawn"]);

    const res = await w.withdraw(w.staff, id, "Company asked us to pull the role.");
    expect(res.status).toBe(200);
    expect((await w.events(id)).at(-1)).toMatchObject({ fromStatus: "shortlist_ready", toStatus: "withdrawn", actor: w.staff.userId, note: "Company asked us to pull the role." });
    expect(await w.stages(id, a, b, c, d)).toEqual(["role_closed", "rejected", "role_closed", "withdrawn"]);
    expect([a, b, c, d].map((s) => w.toldClosed(s, title))).toEqual([1, 0, 1, 0]);
    expect(w.subjects(w.ceo)).toContain(`Role closed: ${title}`);
    const audit = await w.t.db.select().from(schema.staffAction).where(and(eq(schema.staffAction.refId, id), eq(schema.staffAction.action, "role.withdraw")));
    expect(audit).toMatchObject([{ actorUserId: w.staff.userId, note: "Company asked us to pull the role." }]);

    // The shortlist can no longer be worked.
    const late = await w.act(match[c.email]!, { stage: "viewed" });
    expect(late.status).toBe(409);
    expect((await w.row(id)).depositMode).toBe("waived");
  });

  it("is refused from closing and from every terminal state", async () => {
    const { id: closing, match } = await w.shortlisted("Engineer, closing", [a, b]);
    await w.hire(match[a.email]!, "2026-12-01");
    expect((await w.row(closing)).status).toBe("closing");
    const rejected = await w.roleAt("rejected", "Engineer, rejected");
    expect((await w.row(rejected)).status).toBe("rejected");
    const withdrawn = await w.roleAt("draft", "Engineer, withdrawn twice");
    expect((await w.withdraw(w.ceo, withdrawn)).status).toBe(200);

    const mailsBefore = w.t.transport.sent.length;
    for (const [id, status] of [[closing, "closing"], [rejected, "rejected"], [withdrawn, "withdrawn"]] as const) {
      for (const who of [w.ceo, w.staff]) {
        const res = await w.withdraw(who, id, "Changed our minds.");
        expect(res.status, `${status} by ${who.email}`).toBe(409);
        expect(await body(res)).toMatchObject({ error: "illegal_transition", message: `${status} -> withdrawn` });
      }
      expect((await w.row(id)).status).toBe(status);
    }
    // A refusal changes nothing: the hire stands, the other applicant is still open, and nobody was told anything.
    expect(await w.stages(closing, a, b)).toEqual(["hired", "shortlisted"]);
    expect(w.t.transport.sent.length).toBe(mailsBefore);
    expect(await w.t.db.select().from(schema.staffAction).where(and(eq(schema.staffAction.refId, closing), eq(schema.staffAction.action, "role.withdraw")))).toEqual([]);
  });

  it("is open only to the role's company and staff", async () => {
    const id = await w.roleAt("terms_pending", "Engineer, guarded");
    expect((await w.t.app.request(`/roles/${id}/withdraw`, { method: "POST" })).status).toBe(401);
    expect((await w.withdraw(w.rival, id)).status).toBe(403);
    expect((await w.withdraw(a, id)).status).toBe(403);
    expect((await w.ceo.req("/roles/not-a-uuid/withdraw", post())).status).toBe(404);
    expect((await w.ceo.req("/roles/00000000-0000-4000-8000-000000000000/withdraw", post())).status).toBe(404);
    expect((await w.withdraw(w.ceo, id, "x".repeat(2001))).status).toBe(400);
    expect((await w.row(id)).status).toBe("terms_pending");
    await w.t.db.update(schema.companyUser).set({ lockedAt: new Date() }).where(eq(schema.companyUser.userId, w.ceo.userId));
    expect((await w.withdraw(w.ceo, id)).status).toBe(403);
    await w.t.db.update(schema.companyUser).set({ lockedAt: null }).where(eq(schema.companyUser.userId, w.ceo.userId));
    expect((await w.withdraw(w.ceo, id)).status).toBe(200);
  });
});

describe("role.terms_timeout (§5: 14 days after release, unaccepted)", () => {
  let w: World;
  beforeAll(async () => { w = await world(); });
  afterAll(() => w.t.close());

  it("withdraws the role as the system and sends terms_expired; accepted and unreleased terms are left alone", async () => {
    const waiting = await w.roleAt("terms_released", "Engineer, terms ignored");
    const unreleased = await w.roleAt("terms_pending", "Engineer, terms not yet shown");
    const accepted = await w.roleAt("deposit_pending", "Engineer, terms accepted");

    w.t.clock.advance(14 * DAY - MINUTE);
    expect(await w.runJob("role.terms_timeout")).toMatchObject({ job: "role.terms_timeout", roles: 0 });
    expect((await w.row(waiting)).status).toBe("terms_pending");

    w.t.clock.advance(MINUTE);
    expect(await w.runJob("role.terms_timeout")).toMatchObject({ roles: 1 });
    expect((await w.row(waiting)).status).toBe("withdrawn");
    expect((await w.events(waiting)).at(-1)).toMatchObject({ fromStatus: "terms_pending", toStatus: "withdrawn", actor: "system", note: "terms not accepted within 14 days of release" });
    // One message, and it is the one that says why.
    expect(w.subjects(w.ceo).filter((s) => s.endsWith("Engineer, terms ignored")).slice(-1)).toEqual(["Role withdrawn: Engineer, terms ignored"]);
    expect(w.subjects(w.ceo)).not.toContain("Role closed: Engineer, terms ignored");
    expect((await w.ceo.req(`/roles/${waiting}/terms/accept`, post())).status).toBe(409); // too late

    // The clock starts at release, and stops at acceptance.
    expect((await w.row(unreleased)).status).toBe("terms_pending");
    expect((await w.row(accepted)).status).toBe("deposit_pending");
    const mails = w.t.transport.sent.length;
    expect(await w.runJob("role.terms_timeout")).toMatchObject({ roles: 0 }); // idempotent
    expect(w.t.transport.sent.length).toBe(mails);
    expect((await w.row(waiting)).jobError).toBeNull();
  });

  it("reads the window from config", async () => {
    const id = await w.roleAt("terms_released", "Engineer, short window");
    expect((await w.staff.req("/admin/config/gate.terms_timeout_days", { method: "PUT", body: JSON.stringify({ value: 3 }) })).status).toBe(200);
    w.t.clock.advance(3 * DAY);
    expect(await w.runJob("role.terms_timeout")).toMatchObject({ roles: 1 });
    expect((await w.events(id)).at(-1)).toMatchObject({ toStatus: "withdrawn", note: "terms not accepted within 3 days of release" });
  });
});

describe("guarantee expiry (§14: the Slice-1 path, deposit waived, through hire to closed)", () => {
  let w: World, a: Seat, b: Seat, c: Seat, d: Seat;
  let roleId: string, laterId: string, match: Record<string, string>, laterMatch: Record<string, string>;
  const title = "Engineer, hired";
  beforeAll(async () => {
    w = await world();
    [a, b, c, d] = [await w.candidate("a", 80), await w.candidate("b", 70), await w.candidate("c", 60), await w.candidate("d", 50)];
  });
  afterAll(() => w.t.close());

  it("a hired role holds in closing for the whole guarantee: it cannot be withdrawn and the job leaves it alone", async () => {
    ({ id: roleId, match } = await w.shortlisted(title, [a, b, c])); // d is scored and nudged, but never applies
    expect((await w.act(match[b.email]!, { stage: "rejected", rejectionCategory: "skills" })).status).toBe(200);
    await w.hire(match[a.email]!, "2026-11-10");
    ({ id: laterId, match: laterMatch } = await w.shortlisted("Engineer, hired later", [b]));
    await w.hire(laterMatch[b.email]!, "2026-11-20");
    expect(await w.row(roleId)).toMatchObject({ status: "closing", depositMode: "waived", hiredMatchId: match[a.email], feeTerms: { replacement_guarantee_days: 90 } });

    // 90 days from 10 November: 8 February is the last day of the guarantee.
    w.t.clock.set("2027-02-08T23:59:00Z");
    await w.relogin(w.staff, w.ceo);
    expect(await w.runJob("role.guarantee_expiry")).toMatchObject({ job: "role.guarantee_expiry", roles: 0 });
    expect((await w.row(roleId)).status).toBe("closing");
    expect((await w.withdraw(w.ceo, roleId)).status).toBe(409);
    expect(await w.stages(roleId, a, b, c, d)).toEqual(["hired", "rejected", "shortlisted", "scored"]);
  });

  it("once the guarantee has ended the role closes: open matches end at role_closed, the hire and the rejection stand", async () => {
    w.t.clock.set("2027-02-09T00:00:01Z");
    expect(await w.runJob("role.guarantee_expiry")).toMatchObject({ roles: 1 });

    expect(await w.row(roleId)).toMatchObject({ status: "closed", hiredMatchId: match[a.email], depositMode: "waived", jobError: null });
    const trail = await w.events(roleId);
    expect(trail.map((e) => e.toStatus)).toEqual(["draft", "gated", "terms_pending", "deposit_pending", "broadcast", "shortlist_ready", "closing", "closed"]);
    expect(trail.at(-1)).toMatchObject({ fromStatus: "closing", toStatus: "closed", actor: "system", note: "90-day replacement guarantee ended" });

    expect(await w.stages(roleId, a, b, c, d)).toEqual(["hired", "rejected", "role_closed", "role_closed"]);
    // Slice 1 does not wait for a join confirmation, and does not invent one either.
    expect((await w.matches(roleId)).get(a.userId)).toMatchObject({ stage: "hired", joinedOn: "2026-11-10", joinConfirmedAt: null, joinConfirmedBy: null });
    // Told: the applicant whose match closed. Not told: the hire, the rejected applicant, the candidate who never applied.
    expect([a, b, c, d].map((s) => w.toldClosed(s, title))).toEqual([0, 0, 1, 0]);
    expect(w.subjects(w.ceo).filter((s) => s === `Role closed: ${title}`)).toHaveLength(1);

    // The other hire joined ten days later, so its guarantee is still running.
    expect((await w.row(laterId)).status).toBe("closing");
  });

  it("a closed role stays closed: the job, closeRole and a withdrawal all leave it as it is", async () => {
    const mails = w.t.transport.sent.length;
    expect(await w.runJob("role.guarantee_expiry")).toMatchObject({ roles: 0 });
    const deps = await buildDeps({ db: w.t.db, clock: w.t.clock, transport: w.t.transport, baseUrl: "http://test" });
    expect(await closeRole(deps, { roleId })).toMatchObject({ closed: false, closedMatches: [], role: { status: "closed" } });
    expect((await w.withdraw(w.ceo, roleId)).status).toBe(409);
    expect((await w.withdraw(w.staff, roleId)).status).toBe(409);
    expect((await w.act(match[a.email]!, { stage: "did_not_join" })).status).toBe(409);
    expect(await w.events(roleId)).toHaveLength(8);
    expect(w.t.transport.sent.length).toBe(mails);
    // The company keeps its view of the shortlist it worked.
    const { shortlist } = await body(await w.ceo.req(`/roles/${roleId}/shortlist`));
    expect(shortlist.map((m: any) => m.stage)).toEqual(["hired", "rejected", "role_closed"]);

    // closeRole is not a way to end a live role: only `closing` leads to `closed`.
    const draft = await w.roleAt("draft", "Engineer, never closed");
    await expect(closeRole(deps, { roleId: draft })).rejects.toBeInstanceOf(IllegalTransition);
    expect((await w.row(draft)).status).toBe("draft");
  });

  it("can be tightened to wait for a confirmed join, as the full spec requires", async () => {
    w.t.clock.set("2027-02-19T00:00:01Z"); // the later hire's guarantee has now ended too
    const deps = await buildDeps({ db: w.t.db, clock: w.t.clock, transport: w.t.transport, baseUrl: "http://test" });
    expect(await guaranteeExpiry(deps, { roleId: laterId, requireJoinConfirmation: true })).toEqual({ closed: false, reason: "joining not confirmed" });
    expect((await w.row(laterId)).status).toBe("closing");
    await w.t.db.update(schema.match).set({ joinConfirmedAt: w.t.clock.now(), joinConfirmedBy: "grace" }).where(eq(schema.match.id, laterMatch[b.email]!));
    expect(await guaranteeExpiry(deps, { roleId: laterId, requireJoinConfirmation: true })).toMatchObject({ closed: true, role: { status: "closed" } });
    expect(await guaranteeExpiry(deps, { roleId: laterId })).toEqual({ closed: false, reason: "not closing on a hire" });
  });
});

describe("role.dark_check (§5: no hire 30 days after the shortlist)", () => {
  let w: World, a: Seat, b: Seat, c: Seat, d: Seat;
  beforeAll(async () => {
    w = await world();
    [a, b, c, d] = [await w.candidate("a", 80), await w.candidate("b", 70), await w.candidate("c", 60), await w.candidate("d", 50)];
  });
  afterAll(() => w.t.close());

  it("closes an abandoned shortlist; a hired role and a reopened one are left alone", async () => {
    const title = "Engineer, abandoned";
    const dark = await w.shortlisted(title, [a, b, c]); // d is scored, never applies
    for (const step of [{ stage: "viewed" }, { stage: "interviewed" }]) expect((await w.act(dark.match[a.email]!, step)).status).toBe(200);
    expect((await w.act(dark.match[b.email]!, { stage: "rejected", rejectionCategory: "location" })).status).toBe(200);
    const hired = await w.shortlisted("Engineer, filled", [a]);
    await w.hire(hired.match[a.email]!, "2026-11-20");
    const reopened = await w.shortlisted("Engineer, second try", [b]);

    // Day 29: a hire on the third role falls through, which reopens it and restarts its 30-day clock.
    w.t.clock.advance(29 * DAY);
    await w.relogin(w.staff, w.ceo);
    await w.hire(reopened.match[b.email]!, "2026-12-10");
    expect((await w.act(reopened.match[b.email]!, { stage: "did_not_join" })).status).toBe(200);
    expect(await w.row(reopened.id)).toMatchObject({ status: "shortlist_ready", shortlistReadyAt: w.t.clock.now() });

    w.t.clock.advance(DAY - MINUTE);
    expect(await w.runJob("role.dark_check")).toMatchObject({ job: "role.dark_check", roles: 0 });
    expect((await w.row(dark.id)).status).toBe("shortlist_ready");

    w.t.clock.advance(MINUTE);
    expect(await w.runJob("role.dark_check")).toMatchObject({ roles: 1 });
    // No deposit is held in Slice 1, so the role passes through `closing` to `closed` in one step.
    expect(await w.row(dark.id)).toMatchObject({ status: "closed", hiredMatchId: null, depositMode: "waived", refundOwed: null, jobError: null });
    expect((await w.events(dark.id)).slice(-2).map((e) => [e.fromStatus, e.toStatus, e.actor, e.note])).toEqual([
      ["shortlist_ready", "closing", "system", "no hire 30 days after the shortlist"], ["closing", "closed", "system", "no deposit held"]]);
    expect(await w.stages(dark.id, a, b, c, d)).toEqual(["role_closed", "rejected", "role_closed", "role_closed"]);
    expect([a, b, c, d].map((s) => w.toldClosed(s, title))).toEqual([1, 0, 1, 0]);
    expect(w.subjects(w.ceo).filter((s) => s === `Role closed: ${title}`)).toHaveLength(1);

    expect((await w.row(hired.id)).status).toBe("closing");
    expect(await w.stages(hired.id, a)).toEqual(["hired"]);
    expect((await w.row(reopened.id)).status).toBe("shortlist_ready");
    expect(await w.runJob("role.dark_check")).toMatchObject({ roles: 0 }); // idempotent

    // Thirty days after the reopen, the third role goes the same way; the candidate who did not join is settled.
    w.t.clock.advance(29 * DAY);
    await w.relogin(w.staff, w.ceo);
    expect(await w.runJob("role.dark_check")).toMatchObject({ roles: 1 });
    expect((await w.row(reopened.id)).status).toBe("closed");
    expect(await w.stages(reopened.id, b)).toEqual(["did_not_join"]);
  });

  it("an abandoned role cannot be withdrawn or worked afterwards", async () => {
    const [closed] = (await body(await w.ceo.req(`/companies/${w.companyId}/roles`))).roles.filter((r: any) => r.title === "Engineer, abandoned");
    expect(closed.status).toBe("closed");
    expect((await w.withdraw(w.ceo, closed.id)).status).toBe(409);
    const m = (await w.matches(closed.id)).get(c.userId)!;
    expect((await w.act(m.id, { stage: "viewed" })).status).toBe(409);
  });
});
