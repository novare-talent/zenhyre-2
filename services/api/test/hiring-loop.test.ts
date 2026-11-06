// Slice 1 end to end over HTTP against a real Postgres (spec §14, §15): post role → rules pass → model accept (fixture)
// → terms released and accepted → deposit waived → broadcast → nudge → apply × N with displacement → freeze →
// company actions → hired → did not join → shortlist reopens → second hire.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { asc, eq } from "drizzle-orm";
import { schema } from "@zenhyre/db";
import { fixtureGateModel } from "@zenhyre/gate";
import { fixedScorer } from "@zenhyre/matching";
import { testApp } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
const L = (lakhs: number) => lakhs * 100_000 * 100;
const scores: Record<string, number> = {};
const post = (body?: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body ?? {}) });

let t: Awaited<ReturnType<typeof testApp>>;
type Seat = { cookie: string; userId: string; email: string; req: ReturnType<Awaited<ReturnType<typeof testApp>>["as"]> };
let staff: Seat, ceo: Seat, rival: Seat, outsider: Seat;
/** Five final-year candidates at IIT Bombay, named by their fixture fit score. */
const cand: Record<"c70" | "c60" | "c80" | "c65" | "c50", Seat> = {} as any;
let companyId: string, roleId: string, iitb: string;
const appId: Record<string, string> = {};

async function seat(email: string): Promise<Seat> {
  const s = await t.signIn(email);
  return { cookie: s.cookie, userId: s.json.userId, email, req: t.as(s.cookie) };
}
async function candidateSeat(email: string, score: number, campus = "IITB"): Promise<Seat> {
  const s = await seat(email);
  const res = await s.req("/candidates", post({ gradDate: "2027-06-30", course: "B.Tech CSE", rollNumber: null }));
  expect(res.status, `${campus} sign-up`).toBe(201);
  await s.req("/me/profile", { method: "PUT", body: JSON.stringify({ skills: ["Go", "PostgreSQL"], years_experience: 0, headline: `Final year, fit ${score}`, preferred_locations: ["Bengaluru"], current_ctc: 1 }) });
  scores[s.userId] = score;
  return s;
}
const body = async (res: Response) => (await res.json()) as any;
const emailsTo = (s: Seat) => t.transport.sent.filter((m) => m.to === s.email).map((m) => m.subject);
const role = async () => (await body(await ceo.req(`/roles/${roleId}`))).role;
const stageFor = async (s: Seat) => (await body(await s.req("/me/applications"))).applications.find((a: any) => a.role.id === roleId)?.stage;
const act = (who: Seat, matchId: string, payload: Record<string, unknown>) => who.req(`/matches/${matchId}/actions`, post(payload));

beforeAll(async () => {
  t = await testApp("2026-11-05T10:00:00Z", {
    gateModel: fixtureGateModel((r) => ({ score: 85, suggested_reach: r.campusReach, concerns: [], reason: "A strong engineering role for IIT talent." })),
    scorer: fixedScorer(scores),
  });
  const campuses = await t.db.insert(schema.campus).values([
    { name: "IIT Bombay", shortCode: "IITB", emailDomains: ["iitb.ac.in"], internalTier: 1 },
    { name: "IIT Delhi", shortCode: "IITD", emailDomains: ["iitd.ac.in"], internalTier: 1 }]).returning();
  iitb = campuses[0]!.id;

  staff = await seat("ops@novaretalent.com");
  await t.db.update(schema.user).set({ isStaff: true }).where(eq(schema.user.id, staff.userId));
  ceo = await seat("ceo@lab0.ai");
  companyId = (await body(await ceo.req("/companies", post({ name: "Lab0" })))).company.id;
  rival = await seat("founder@rival.io");
  await rival.req("/companies", post({ name: "Rival" }));

  cand.c70 = await candidateSeat("c70@iitb.ac.in", 70);
  cand.c60 = await candidateSeat("c60@iitb.ac.in", 60);
  cand.c80 = await candidateSeat("c80@iitb.ac.in", 80);
  cand.c65 = await candidateSeat("c65@iitb.ac.in", 65);
  cand.c50 = await candidateSeat("c50@iitb.ac.in", 50);
  outsider = await candidateSeat("d90@iitd.ac.in", 90, "IITD");

  // A shortlist of three makes displacement visible with five applicants.
  expect((await staff.req("/admin/config/match.shortlist_cap", { method: "PUT", body: JSON.stringify({ value: 3 }) })).status).toBe(200);
});
afterAll(() => t.close());

describe("Slice 1 hiring loop", () => {
  it("post role: a company drafts, edits and submits; the rules pass and the model fixture accepts", async () => {
    const draft = await ceo.req(`/companies/${companyId}/roles`, post({ title: "Backend engineer", type: "fresher" }));
    expect(draft.status).toBe(201);
    const created = (await body(draft)).role;
    roleId = created.id;
    expect(created).toMatchObject({ status: "draft", gate: null, feeTerms: null, applicants: 0, shortlistCap: 3 });

    const patch = await ceo.req(`/roles/${roleId}`, { method: "PATCH", body: JSON.stringify({
      title: "Backend engineer, payments", jd: "You will own the settlement service that moves money between merchant accounts and banks. ".repeat(3),
      ctcMin: L(12), ctcMax: L(16), yearsExpMin: 0, yearsExpMax: 1, locations: ["Bengaluru"], campusReach: ["IITB"] }) });
    expect(patch.status).toBe(200);
    expect((await body(patch)).role.campusReach).toEqual([iitb]); // short codes resolve to campus ids

    const submitted = await ceo.req(`/roles/${roleId}/submit`, post());
    expect(submitted.status).toBe(200);
    // The gate job ran after commit: rules pass, model accepts, terms are prefilled but not yet shown.
    expect((await body(submitted)).role).toMatchObject({
      status: "terms_pending", feeTerms: null, feeTermsReleasedAt: null,
      gate: { stage: "model", outcome: "accept", reason: "A strong engineering role for IIT talent." } });

    const decisions = await t.db.select().from(schema.roleGateDecision).where(eq(schema.roleGateDecision.roleId, roleId)).orderBy(asc(schema.roleGateDecision.decidedAt));
    expect(decisions.map((d) => [d.stage, d.outcome]).sort()).toEqual([["model", "accept"], ["rules", "accept"]]);
    expect(decisions.find((d) => d.stage === "model")).toMatchObject({ modelScore: 85, suggestedReach: [iitb], decidedBy: "system" });
    expect(emailsTo(ceo)).toContain("Role accepted: Backend engineer, payments");
    expect((await ceo.req(`/roles/${roleId}`, { method: "PATCH", body: JSON.stringify({ title: "Changed" }) })).status).toBe(409);
  });

  it("accept terms: only after staff release them; the role then owes the deposit for its reach", async () => {
    const early = await ceo.req(`/roles/${roleId}/terms/accept`, post());
    expect(early.status).toBe(400);
    expect((await body(early)).message).toMatch(/not been released/);

    expect((await ceo.req(`/admin/roles/${roleId}/release-terms`, post())).status).toBe(403);
    expect((await staff.req(`/admin/roles/${roleId}/release-terms`, post())).status).toBe(200);
    expect(emailsTo(ceo)).toContain("Fee terms ready: Backend engineer, payments");
    // Fresher role: 10% of annual CTC, 60-day replacement guarantee (§7, §17).
    expect((await role()).feeTerms).toEqual({ kind: "percent", amount: 0.1, replacement_guarantee_days: 60 });

    expect((await rival.req(`/roles/${roleId}/terms/accept`, post())).status).toBe(403);
    const accepted = await ceo.req(`/roles/${roleId}/terms/accept`, post());
    expect(accepted.status).toBe(200);
    expect((await body(accepted)).role).toMatchObject({ status: "deposit_pending", depositAmount: 1_500_000, depositMode: null });
    expect((await role()).feeTermsAcceptedAt).toBe(t.clock.now().toISOString());
    // Terms cannot change after acceptance.
    const edit = await staff.req(`/admin/roles/${roleId}/fee-terms`, { method: "PUT", body: JSON.stringify({ kind: "percent", amount: 0.05, replacement_guarantee_days: 30 }) });
    expect(edit.status).toBe(400);
  });

  it("waive deposit: staff only, with a note; the role enters broadcast for ten days and candidates are scored and nudged", async () => {
    expect((await ceo.req(`/admin/roles/${roleId}/waive-deposit`, post({ note: "let us in" }))).status).toBe(403);
    expect((await staff.req(`/admin/roles/${roleId}/waive-deposit`, post({ note: "  " }))).status).toBe(400);
    expect((await role()).status).toBe("deposit_pending");

    const waived = await staff.req(`/admin/roles/${roleId}/waive-deposit`, post({ note: "Pilot customer: deposit waived for Slice 1." }));
    expect(waived.status).toBe(200);
    const r = await role();
    expect(r).toMatchObject({ status: "broadcast", depositMode: "waived", broadcastOpensAt: t.clock.now().toISOString() });
    expect(new Date(r.broadcastClosesAt).getTime()).toBe(t.clock.now().getTime() + 10 * DAY);

    // broadcastRole ran after commit: the five IIT Bombay candidates are scored, the IIT Delhi one is outside the reach.
    const matches = await t.db.select().from(schema.match).where(eq(schema.match.roleId, roleId));
    expect(matches).toHaveLength(5);
    expect(matches.every((m) => m.stage === "scored" && m.nudgedAt !== null)).toBe(true);
    expect(matches.map((m) => m.candidateId)).not.toContain(outsider.userId);
    for (const c of Object.values(cand)) expect(emailsTo(c)).toContain("A role that fits you: Backend engineer, payments");
    expect(emailsTo(outsider)).not.toContain("A role that fits you: Backend engineer, payments");
    const audit = await t.db.select().from(schema.staffAction).where(eq(schema.staffAction.refId, roleId));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["role.fee_terms.release", "role.deposit.waive"]));
    expect(audit.find((a) => a.action === "role.deposit.waive")!.note).toMatch(/Pilot customer/);
  });

  it("the role board: candidates in reach see the role; the company cannot see a shortlist yet", async () => {
    const board = (await body(await cand.c70.req("/me/roles"))).roles;
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ id: roleId, title: "Backend engineer, payments", company: { name: "Lab0" }, open: true, nudged: true, application: null });
    expect(board[0]).not.toHaveProperty("fitScore");
    expect((await body(await outsider.req("/me/roles"))).roles).toEqual([]);
    expect((await outsider.req(`/me/roles/${roleId}`)).status).toBe(404);
    const refused = await outsider.req(`/me/roles/${roleId}/apply`, post());
    expect(refused.status).toBe(403);
    expect((await body(refused)).message).toMatch(/campus/);
    expect((await ceo.req("/me/roles")).status).toBe(403); // not a candidate

    const early = await ceo.req(`/roles/${roleId}/shortlist`);
    expect(early.status).toBe(409);
    expect((await body(early)).error).toBe("shortlist_not_ready");
  });

  it("apply × N with displacement: the top three by fit hold the shortlist and a higher score displaces the lowest", async () => {
    for (const k of ["c70", "c60", "c80"] as const) {
      t.clock.advance(60_000);
      const res = await cand[k].req(`/me/roles/${roleId}/apply`, post());
      expect(res.status).toBe(201);
      const app = (await body(res)).application;
      expect(app).toMatchObject({ stage: "shortlisted", canWithdraw: true, role: { id: roleId }, company: { name: "Lab0" } });
      appId[k] = app.id;
    }
    expect(emailsTo(cand.c60)).toContain("Update on Backend engineer, payments"); // told they were shortlisted

    // A fourth applicant scoring 65 takes the third seat from the one scoring 60.
    t.clock.advance(60_000);
    appId.c65 = (await body(await cand.c65.req(`/me/roles/${roleId}/apply`, post()))).application.id;
    expect(await stageFor(cand.c65)).toBe("shortlisted");
    expect(await stageFor(cand.c60)).toBe("applied");
    const displaced = await t.db.select().from(schema.matchEvent).where(eq(schema.matchEvent.matchId, appId.c60!)).orderBy(asc(schema.matchEvent.seq));
    expect(displaced.map((e) => [e.fromStage, e.toStage, e.actor])).toEqual([
      [null, "scored", "system"], ["scored", "applied", cand.c60.userId], ["applied", "shortlisted", "system"], ["shortlisted", "applied", "system"]]);

    // A fifth applicant scoring 50 stays in the longlist.
    t.clock.advance(60_000);
    const low = (await body(await cand.c50.req(`/me/roles/${roleId}/apply`, post()))).application;
    appId.c50 = low.id;
    expect(low.stage).toBe("applied");

    const again = await cand.c50.req(`/me/roles/${roleId}/apply`, post());
    expect(again.status).toBe(409);
    expect((await body(again)).error).toBe("already_applied");
    expect((await role()).applicants).toBe(5);

    const ranked = async () => (await t.db.select().from(schema.match).where(eq(schema.match.roleId, roleId)))
      .filter((m) => m.rank !== null).sort((a, b) => a.rank! - b.rank!).map((m) => [m.fitScore, m.rank, m.stage]);
    expect(await ranked()).toEqual([[80, 1, "shortlisted"], [70, 2, "shortlisted"], [65, 3, "shortlisted"]]);

    // A shortlisted candidate withdraws during broadcast: the seat goes back to the best remaining applicant.
    expect((await cand.c60.req(`/me/applications/${appId.c70}/withdraw`, post())).status).toBe(404); // not their application
    const withdrawn = await cand.c70.req(`/me/applications/${appId.c70}/withdraw`, post());
    expect((await body(withdrawn)).application).toMatchObject({ stage: "withdrawn", canWithdraw: false });
    expect(await ranked()).toEqual([[80, 1, "shortlisted"], [65, 2, "shortlisted"], [60, 3, "shortlisted"]]);
    expect(await stageFor(cand.c60)).toBe("shortlisted");
    expect(emailsTo(ceo).filter((s) => s.startsWith("Update on"))).toEqual([]); // the company sees nothing during broadcast
  });

  it("freeze: nothing happens before the window closes; at broadcast_closes_at the shortlist freezes and the company is told", async () => {
    expect(await body(await staff.req("/admin/jobs/role.close_broadcast/run", post()))).toMatchObject({ roles: 0 });
    expect((await role()).status).toBe("broadcast");

    t.clock.advance(10 * DAY);
    expect(await body(await staff.req("/admin/jobs/role.close_broadcast/run", post()))).toMatchObject({ roles: 1 });
    const r = await role();
    expect(r).toMatchObject({ status: "shortlist_ready", shortlistReadyAt: t.clock.now().toISOString() });
    expect(emailsTo(ceo)).toContain("Shortlist ready: Backend engineer, payments");

    // Applications are closed and the board no longer lists the role, but an applicant can still open it.
    expect((await body(await cand.c50.req("/me/roles"))).roles).toEqual([]);
    expect((await cand.c50.req(`/me/roles/${roleId}`)).status).toBe(200);
    const late = await seat("late@iitb.ac.in");
    await late.req("/candidates", post({ gradDate: "2027-06-30", course: "B.Tech", rollNumber: null }));
    expect((await late.req(`/me/roles/${roleId}/apply`, post())).status).toBe(403);
    expect((await late.req(`/me/roles/${roleId}`)).status).toBe(404);
    expect(await body(await staff.req("/admin/jobs/role.close_broadcast/run", post()))).toMatchObject({ roles: 0 }); // idempotent
  });

  it("the shortlist: ranked, with fit and profile, visible to the role's company only", async () => {
    expect((await rival.req(`/roles/${roleId}/shortlist`)).status).toBe(403);
    expect((await cand.c80.req(`/roles/${roleId}/shortlist`)).status).toBe(403);
    expect((await t.app.request(`/roles/${roleId}/shortlist`)).status).toBe(401);

    const res = await ceo.req(`/roles/${roleId}/shortlist`);
    expect(res.status).toBe(200);
    const { shortlist } = await body(res);
    expect(shortlist.map((m: any) => [m.rank, m.fitScore, m.stage])).toEqual([[1, 80, "shortlisted"], [2, 65, "shortlisted"], [3, 60, "shortlisted"]]);
    expect(shortlist[0]).toMatchObject({ id: appId.c80, fitReason: "Fixture score 80.",
      candidate: { id: cand.c80.userId, course: "B.Tech CSE", status: "final_year", campus: { name: "IIT Bombay", shortCode: "IITB" },
        profile: { skills: ["Go", "PostgreSQL"], headline: "Final year, fit 80", preferredLocations: ["Bengaluru"] } } });
    // Internal fields never reach the company: campus tier, trust and verification state, current CTC.
    const raw = JSON.stringify(shortlist);
    for (const leak of ["internalTier", "trustStatus", "verification", "current_ctc", "currentCtc", "rollNumber"]) expect(raw).not.toContain(leak);
  });

  it("company actions through hired: each stage in order, with the data it needs", async () => {
    const top = appId.c80!;
    expect((await rival.req(`/matches/${top}/actions`, post({ stage: "viewed" }))).status).toBe(403);
    expect((await staff.req(`/matches/${top}/actions`, post({ stage: "viewed" }))).status).toBe(403); // staff do not act on a company's shortlist

    const skip = await act(ceo, top, { stage: "offered", offeredCtc: L(14) });
    expect(skip.status).toBe(409);
    expect((await body(skip)).error).toBe("illegal_transition");

    expect((await act(ceo, top, { stage: "viewed" })).status).toBe(200);
    const mailBefore = emailsTo(cand.c80).length;
    expect(emailsTo(cand.c80).filter((s) => s.startsWith("Update on"))).toHaveLength(1); // only "shortlisted" so far: viewed is silent
    expect((await body(await act(ceo, top, { stage: "interviewed" }))).match.stage).toBe("interviewed");
    expect(emailsTo(cand.c80).length).toBe(mailBefore + 1);

    expect((await act(ceo, top, { stage: "offered" })).status).toBe(400); // needs offered_ctc
    expect((await body(await act(ceo, top, { stage: "offered", offeredCtc: L(14) }))).match).toMatchObject({ stage: "offered", offeredCtc: L(14) });
    expect((await act(ceo, top, { stage: "offer_accepted" })).status).toBe(200);

    // The company rejects another shortlisted candidate along the way; the candidate sees the category, never the note.
    const rejected = await act(ceo, appId.c60!, { stage: "rejected", rejectionCategory: "experience", rejectionNote: "Too little systems work." });
    expect((await body(rejected)).match).toMatchObject({ stage: "rejected", rejectionCategory: "experience", rejectionNote: "Too little systems work." });
    const theirs = (await body(await cand.c60.req("/me/applications"))).applications[0];
    expect(theirs).toMatchObject({ stage: "rejected", rejectionCategory: "experience", canWithdraw: false });
    expect(JSON.stringify(theirs)).not.toContain("systems work");

    expect((await act(ceo, top, { stage: "hired", hiredCtc: L(14) })).status).toBe(400); // needs joined_on
    const hired = await act(ceo, top, { stage: "hired", hiredCtc: L(14), joinedOn: "2026-12-01" });
    expect(hired.status).toBe(200);
    const out = await body(hired);
    expect(out.match).toMatchObject({ stage: "hired", hiredCtc: L(14), joinedOn: "2026-12-01", joinConfirmedAt: null });
    expect(out.role).toMatchObject({ status: "closing", hiredMatchId: top, hiredAt: t.clock.now().toISOString() });
    expect(emailsTo(ceo)).toContain("Hire recorded: Backend engineer, payments");
    expect(await stageFor(cand.c80)).toBe("hired");

    // One opening per role: with a hire recorded, the other candidate can only be rejected.
    const second = await act(ceo, appId.c65!, { stage: "viewed" });
    expect(second.status).toBe(409);
    expect((await body(second)).error).toBe("not_actionable");
    // Slice 1 writes no money: there is no ledger, and the deposit stays waived.
    expect((await role()).depositMode).toBe("waived");
  });

  it("did not join: the hire is reversed and the shortlist reopens for a second hire", async () => {
    t.clock.advance(3 * DAY);
    expect((await act(ceo, appId.c65!, { stage: "did_not_join" })).status).toBe(409); // only the hired candidate
    const res = await act(ceo, appId.c80!, { stage: "did_not_join" });
    expect(res.status).toBe(200);
    const out = await body(res);
    expect(out.match.stage).toBe("did_not_join");
    expect(out.role).toMatchObject({ status: "shortlist_ready", hiredMatchId: null, hiredAt: null, shortlistReadyAt: t.clock.now().toISOString() });
    expect(await stageFor(cand.c80)).toBe("did_not_join");
    expect((await act(ceo, appId.c80!, { stage: "did_not_join" })).status).toBe(409); // nothing left to reverse

    // The shortlist keeps its frozen order and the remaining candidate can now be taken all the way to hired.
    const { shortlist } = await body(await ceo.req(`/roles/${roleId}/shortlist`));
    expect(shortlist.map((m: any) => [m.rank, m.stage])).toEqual([[1, "did_not_join"], [2, "shortlisted"], [3, "rejected"]]);
    const next = appId.c65!;
    for (const step of [{ stage: "viewed" }, { stage: "interviewed" }, { stage: "offered", offeredCtc: L(13) }, { stage: "offer_accepted" }]) {
      expect((await act(ceo, next, step)).status, step.stage).toBe(200);
    }
    const rehire = await body(await act(ceo, next, { stage: "hired", hiredCtc: L(13), joinedOn: "2026-12-15" }));
    expect(rehire.role).toMatchObject({ status: "closing", hiredMatchId: next });
    expect(rehire.match).toMatchObject({ stage: "hired", hiredCtc: L(13) });
  });

  it("left the trail the spec asks for: one RoleEvent per transition, one MatchEvent per stage change", async () => {
    const roleEvents = await t.db.select().from(schema.roleEvent).where(eq(schema.roleEvent.roleId, roleId)).orderBy(asc(schema.roleEvent.seq));
    expect(roleEvents.map((e) => e.toStatus)).toEqual([
      "draft", "gated", "terms_pending", "deposit_pending", "broadcast", "shortlist_ready", "closing", "shortlist_ready", "closing"]);
    expect(roleEvents.map((e) => e.actor)).toEqual([
      ceo.userId, ceo.userId, "system", ceo.userId, staff.userId, "system", ceo.userId, ceo.userId, ceo.userId]);
    expect(roleEvents.find((e) => e.toStatus === "broadcast")!.note).toMatch(/Pilot customer/);

    const first = await t.db.select().from(schema.matchEvent).where(eq(schema.matchEvent.matchId, appId.c80!)).orderBy(asc(schema.matchEvent.seq));
    expect(first.map((e) => e.toStage)).toEqual(["scored", "applied", "shortlisted", "viewed", "interviewed", "offered", "offer_accepted", "hired", "did_not_join"]);
    expect(first.find((e) => e.toStage === "hired")!.data).toEqual({ hired_ctc: L(14), joined_on: "2026-12-01" });

    const admin = await body(await staff.req(`/admin/roles/${roleId}`));
    expect(admin.events).toHaveLength(9);
    expect(admin.applicants.map((m: any) => m.fitScore)).toEqual([80, 70, 65, 60, 50]); // the longlist is staff-only
    expect(admin.role.jobError).toBeNull();
    expect((await ceo.req(`/admin/roles/${roleId}`)).status).toBe(403);
  });
});
