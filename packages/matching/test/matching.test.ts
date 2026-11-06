import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { schema, type Db } from "@zenhyre/db";
import { testDb } from "@zenhyre/db/test";
import { createIdentity } from "@zenhyre/identity";
import { IllegalTransition, mutableClock } from "@zenhyre/shared";
import { MATCH_ACTOR_KINDS, MATCH_STAGES, canMove, createMatching, fixedScorer,
  type Match, type MatchActor, type MatchStage, type Matching, type MatchingCandidate, type MatchingRole, type RoleContext } from "../src/index";

const DAY = 24 * 60 * 60 * 1000;
const clock = mutableClock("2026-11-05T10:00:00Z");
const scores: Record<string, number> = {};
let db: Db, close: () => Promise<void>, matching: Matching, identity: ReturnType<typeof createIdentity>;
let campusA: string, campusB: string, companyId: string;

beforeAll(async () => {
  ({ db, close } = await testDb());
  identity = createIdentity(db, { clock });
  matching = createMatching(db, { clock, scorer: fixedScorer(scores), candidates: identity });
  const [a, b] = await db.insert(schema.campus).values([
    { name: "IIT Bombay", shortCode: "IITB", emailDomains: ["iitb.ac.in"] }, { name: "IIT Delhi", shortCode: "IITD", emailDomains: ["iitd.ac.in"] }]).returning();
  campusA = a!.id; campusB = b!.id;
  companyId = (await db.insert(schema.company).values({ name: "Lab0", verifiedDomain: "lab0.ai" }).returning())[0]!.id;
});
afterAll(() => close());

type CandOver = Partial<Omit<typeof schema.candidate.$inferInsert, "userId">>;
/** A verified final-year candidate on campus A with a fixture fit score. */
async function mkCandidate(score: number, over: CandOver = {}): Promise<MatchingCandidate> {
  const [u] = await db.insert(schema.user).values({}).returning();
  const [c] = await db.insert(schema.candidate).values({
    userId: u!.id, campusId: campusA, gradDate: "2027-06-30", course: "B.Tech", status: "final_year",
    verificationState: "verified", verificationSource: "campus_email", ...over }).returning();
  scores[u!.id] = score;
  return c!;
}
type RoleRow = typeof schema.role.$inferSelect;
/** A fresher role in broadcast reaching campus A. */
async function mkRole(over: Partial<typeof schema.role.$inferInsert> = {}): Promise<RoleRow> {
  const [r] = await db.insert(schema.role).values({
    companyId, title: "Backend engineer", jd: "x".repeat(220), type: "fresher", ctcMin: 120_000_000, ctcMax: 160_000_000,
    locations: ["Bengaluru"], campusReach: [campusA], status: "broadcast", ...over }).returning();
  return r!;
}
const candidateActor = (c: { userId: string }): MatchActor => ({ kind: "candidate", userId: c.userId });
const company: MatchActor = { kind: "company", userId: "11111111-1111-4111-8111-111111111111" };
const staff: MatchActor = { kind: "staff", userId: "22222222-2222-4222-8222-222222222222" };
const system: MatchActor = { kind: "system" };
const ready = (role: { id: string }, hiredMatchId: string | null = null): RoleContext => ({ id: role.id, status: "shortlist_ready", hiredMatchId });
const closing = (role: { id: string }, hiredMatchId: string | null): RoleContext => ({ id: role.id, status: "closing", hiredMatchId, replacementGuaranteeDays: 90 });
const stageOf = async (m: { id: string }) => (await matching.get(m.id))!.stage;
const shortlist = async (role: { id: string }) => (await matching.listShortlist(role.id)).map((m) => [m.candidateId, m.rank, m.stage]);
/** Puts a match straight into a stage, bypassing the table, to set up a starting point. */
async function matchAt(role: { id: string }, c: { userId: string }, stage: MatchStage, over: Partial<typeof schema.match.$inferInsert> = {}): Promise<Match> {
  const [m] = await db.insert(schema.match).values({ roleId: role.id, candidateId: c.userId, fitScore: 70, stage, appliedAt: stage === "scored" ? null : clock.now(), ...over }).returning();
  return m!;
}

describe("broadcast (§8 steps 3–4)", () => {
  it("scores matchable candidates, keeps the best pool, nudges the top nudge_cap with trust ok, and is safe to run twice", async () => {
    const role = await mkRole({ nudgeCap: 2 });
    const top = await mkCandidate(95, { trustStatus: "restricted" });
    const [c90, c80, c70, c60] = [await mkCandidate(90), await mkCandidate(80), await mkCandidate(70), await mkCandidate(60)];
    const unverified = await mkCandidate(99, { verificationState: "verification_pending", verificationSource: "association" });
    const otherCampus = await mkCandidate(99, { campusId: campusB });
    const closedOff = await mkCandidate(99, { openToOpportunities: false });
    const all = [top, c90, c80, c70, c60, unverified, otherCampus, closedOff];

    const out = await matching.broadcast(role, all, { pool: 4 });
    expect(out.scored).toBe(4);
    expect(out.nudged.sort()).toEqual([c90.userId, c80.userId].sort()); // the restricted top scorer is scored but not nudged
    const rows = await db.select().from(schema.match).where(eq(schema.match.roleId, role.id));
    expect(rows.map((m) => m.candidateId).sort()).toEqual([top, c90, c80, c70].map((c) => c.userId).sort());
    expect(rows.every((m) => m.stage === "scored" && m.appliedAt === null && m.rank === null)).toBe(true);
    expect(rows.find((m) => m.candidateId === c90.userId)).toMatchObject({ fitScore: 90, fitReason: "Fixture score 90." });
    expect(rows.find((m) => m.candidateId === c90.userId)!.nudgedAt).toEqual(clock.now());
    expect(rows.find((m) => m.candidateId === c70.userId)!.nudgedAt).toBeNull();
    expect(await matching.events(rows[0]!.id)).toMatchObject([{ fromStage: null, toStage: "scored", actor: "system" }]);

    expect(await matching.broadcast(role, all, { pool: 4 })).toEqual({ scored: 0, nudged: [] });
    expect(await db.select().from(schema.match).where(eq(schema.match.roleId, role.id))).toHaveLength(4);
  });
  it("refuses a role that is not in broadcast", async () => {
    const role = await mkRole({ status: "shortlist_ready" });
    await expect(matching.broadcast(role, [], { pool: 200 })).rejects.toThrow(/in broadcast/);
  });
});

describe("apply (§8 step 5)", () => {
  it("moves a scored match to applied, stamps applied_at and shortlists it", async () => {
    const role = await mkRole();
    const c = await mkCandidate(80);
    await matching.broadcast(role, [c], { pool: 200 });
    clock.advance(60_000);
    const out = await matching.apply(role, c);
    expect(out.match).toMatchObject({ stage: "shortlisted", rank: 1, fitScore: 80 });
    expect(out.match.appliedAt).toEqual(clock.now());
    expect(out).toMatchObject({ pendingApproval: false, shortlisted: 1 });
    expect(out.promoted.map((m) => m.id)).toEqual([out.match.id]);
    expect((await matching.events(out.match.id)).map((e) => [e.fromStage, e.toStage, e.actorKind]))
      .toEqual([[null, "scored", "system"], ["scored", "applied", "candidate"], ["applied", "shortlisted", "system"]]);
  });
  it("scores a candidate outside the scored set when they apply", async () => {
    const role = await mkRole();
    const c = await mkCandidate(64, { openToOpportunities: false }); // never broadcast to, still allowed to apply
    const out = await matching.apply(role, c);
    expect(out.match).toMatchObject({ stage: "shortlisted", fitScore: 64, nudgedAt: null });
  });
  it("refuses a second application, and one after withdrawing", async () => {
    const role = await mkRole();
    const c = await mkCandidate(80);
    const { match } = await matching.apply(role, c);
    await expect(matching.apply(role, c)).rejects.toMatchObject({ code: "already_applied", status: 409 });
    await matching.setStage(match.id, "withdrawn", candidateActor(c));
    await expect(matching.apply(role, c)).rejects.toThrow(/withdrew/);
  });
  it("refuses candidates canApply refuses and writes nothing", async () => {
    const role = await mkRole();
    const away = await mkCandidate(80, { campusId: campusB });
    const pending = await mkCandidate(80, { verificationState: "verification_pending", verificationSource: "association" });
    const blocked = await mkCandidate(80, { trustStatus: "blocked" });
    await expect(matching.apply(role, away)).rejects.toMatchObject({ code: "forbidden", message: expect.stringMatching(/campus/) });
    await expect(matching.apply(role, pending)).rejects.toThrow(/verified/);
    await expect(matching.apply(role, blocked)).rejects.toThrow(/cannot apply/);
    await expect(matching.apply({ ...role, status: "shortlist_ready" }, await mkCandidate(80))).rejects.toThrow(/not taking applications/);
    expect(await db.select().from(schema.match).where(eq(schema.match.roleId, role.id))).toHaveLength(0);
  });
  it("holds a restricted candidate in pending_approval, outside the ranking", async () => {
    const role = await mkRole();
    const c = await mkCandidate(99, { trustStatus: "restricted" });
    const out = await matching.apply(role, c);
    expect(out).toMatchObject({ pendingApproval: true, promoted: [], displaced: [] });
    expect(out.match).toMatchObject({ stage: "pending_approval", rank: null });
    expect(await shortlist(role)).toEqual([]);
    // Staff approve: back to applied, and the next ranking seats them.
    await matching.setStage(out.match.id, "applied", staff);
    expect((await matching.rerank(role)).promoted.map((m) => m.id)).toEqual([out.match.id]);
  });
});

describe("ranking, shortlist_cap and displacement", () => {
  it("keeps the top shortlist_cap by fit score, and a higher scorer displaces the lowest", async () => {
    const role = await mkRole({ shortlistCap: 3 });
    const [c70, c60, c80] = [await mkCandidate(70), await mkCandidate(60), await mkCandidate(80)];
    for (const c of [c70, c60, c80]) { clock.advance(1000); await matching.apply(role, c); }
    expect(await shortlist(role)).toEqual([[c80.userId, 1, "shortlisted"], [c70.userId, 2, "shortlisted"], [c60.userId, 3, "shortlisted"]]);

    clock.advance(1000);
    const c65 = await mkCandidate(65);
    const out = await matching.apply(role, c65);
    expect(out.promoted.map((m) => m.candidateId)).toEqual([c65.userId]);
    expect(out.displaced.map((m) => m.candidateId)).toEqual([c60.userId]);
    expect(await shortlist(role)).toEqual([[c80.userId, 1, "shortlisted"], [c70.userId, 2, "shortlisted"], [c65.userId, 3, "shortlisted"]]);
    const displaced = (await matching.getFor(role.id, c60.userId))!;
    expect(displaced).toMatchObject({ stage: "applied", rank: null });
    expect((await matching.events(displaced.id)).at(-1)).toMatchObject({ fromStage: "shortlisted", toStage: "applied", actor: "system", data: { reason: "displaced" } });
  });
  it("a new top scorer takes rank 1 and everyone below shifts down", async () => {
    const role = await mkRole({ shortlistCap: 2 });
    const [a, b] = [await mkCandidate(70), await mkCandidate(60)];
    for (const c of [a, b]) { clock.advance(1000); await matching.apply(role, c); }
    clock.advance(1000);
    const best = await mkCandidate(90);
    const out = await matching.apply(role, best);
    expect(await shortlist(role)).toEqual([[best.userId, 1, "shortlisted"], [a.userId, 2, "shortlisted"]]);
    expect(out.displaced.map((m) => m.candidateId)).toEqual([b.userId]);
    // The one who only changed rank was neither promoted nor displaced: no event, no notification.
    expect((await matching.events((await matching.getFor(role.id, a.userId))!.id)).map((e) => e.toStage)).toEqual(["scored", "applied", "shortlisted"]);
  });
  it("an equal score does not displace: the earlier application keeps the seat", async () => {
    const role = await mkRole({ shortlistCap: 1 });
    const first = await mkCandidate(75);
    await matching.apply(role, first);
    clock.advance(1000);
    const second = await mkCandidate(75);
    const out = await matching.apply(role, second);
    expect(out.displaced).toEqual([]);
    expect(out.match).toMatchObject({ stage: "applied", rank: null });
    expect(await shortlist(role)).toEqual([[first.userId, 1, "shortlisted"]]);
  });
  it("a lower scorer applying to a full shortlist stays applied in the longlist", async () => {
    const role = await mkRole({ shortlistCap: 1 });
    const [hi, lo] = [await mkCandidate(80), await mkCandidate(40)];
    await matching.apply(role, hi);
    expect((await matching.apply(role, lo)).match).toMatchObject({ stage: "applied", rank: null });
    expect((await matching.listApplicants(role.id)).map((m) => m.candidateId)).toEqual([hi.userId, lo.userId]);
    expect(await matching.applicantCounts([role.id])).toEqual({ [role.id]: 2 });
  });
  it("ranks only verified applicants; a later verification enters on the next ranking and can displace", async () => {
    const role = await mkRole({ shortlistCap: 1 });
    const verified = await mkCandidate(60);
    const referral = await mkCandidate(90, { verificationState: "referral_pending", verificationSource: "referral" });
    await matching.apply(role, verified);
    clock.advance(1000);
    expect((await matching.apply(role, referral)).match).toMatchObject({ stage: "applied", rank: null });
    expect(await shortlist(role)).toEqual([[verified.userId, 1, "shortlisted"]]);

    await identity.verifyCandidate(referral.userId, { by: "staff-1", source: "staff" });
    const out = await matching.rerank(role);
    expect(out.promoted.map((m) => m.candidateId)).toEqual([referral.userId]);
    expect(out.displaced.map((m) => m.candidateId)).toEqual([verified.userId]);
    expect(await shortlist(role)).toEqual([[referral.userId, 1, "shortlisted"]]);
  });
  it("a withdrawal during broadcast frees the seat and the next ranking refills it", async () => {
    const role = await mkRole({ shortlistCap: 2 });
    const [a, b, c] = [await mkCandidate(90), await mkCandidate(80), await mkCandidate(70)];
    for (const x of [a, b, c]) { clock.advance(1000); await matching.apply(role, x); }
    const leaving = (await matching.getFor(role.id, a.userId))!;
    await matching.setStage(leaving.id, "withdrawn", candidateActor(a));
    const out = await matching.rerank(role);
    expect(out.promoted.map((m) => m.candidateId)).toEqual([c.userId]);
    expect(await shortlist(role)).toEqual([[b.userId, 1, "shortlisted"], [c.userId, 2, "shortlisted"]]);
    expect(await matching.get(leaving.id)).toMatchObject({ stage: "withdrawn", rank: null });
  });
  it("never seats more than the cap when applications arrive together", async () => {
    const role = await mkRole({ shortlistCap: 3 });
    const cands = await Promise.all([55, 65, 75, 85, 95, 45, 35, 60].map((s) => mkCandidate(s)));
    await Promise.all(cands.map((c) => db.transaction((tx) => matching.withDb(tx).apply(role, c))));
    const list = await matching.listShortlist(role.id);
    expect(list.map((m) => [m.fitScore, m.rank])).toEqual([[95, 1], [85, 2], [75, 3]]);
    const rows = await db.select().from(schema.match).where(eq(schema.match.roleId, role.id));
    expect(rows.filter((m) => m.stage === "shortlisted")).toHaveLength(3);
    expect(rows.filter((m) => m.stage === "applied")).toHaveLength(5);
  });
});

describe("freeze (§8 step 6)", () => {
  it("freezes ranks: no applications, no refills and no late entries after the role leaves broadcast", async () => {
    const role = await mkRole({ shortlistCap: 2 });
    const [a, b, c] = [await mkCandidate(90), await mkCandidate(80), await mkCandidate(70)];
    const late = await mkCandidate(99, { verificationState: "referral_pending", verificationSource: "referral" });
    for (const x of [a, b, c, late]) { clock.advance(1000); await matching.apply(role, x); }
    expect(await matching.freeze(role)).toEqual({ shortlisted: 2 });
    const frozen = { ...role, status: "shortlist_ready" as const };
    const before = await shortlist(role);
    expect(before).toEqual([[a.userId, 1, "shortlisted"], [b.userId, 2, "shortlisted"]]);

    await expect(matching.apply(frozen, await mkCandidate(100))).rejects.toThrow(/not taking applications/);
    await identity.verifyCandidate(late.userId, { by: "staff-1", source: "staff" });
    expect(await matching.rerank(frozen)).toEqual({ promoted: [], displaced: [], shortlisted: 0 });
    expect(await shortlist(role)).toEqual(before);
    expect((await matching.getFor(role.id, late.userId))!.stage).toBe("applied");

    // A withdrawal after freeze keeps its rank (it was on the frozen shortlist) and is not refilled.
    const leaving = (await matching.getFor(role.id, b.userId))!;
    await matching.setStage(leaving.id, "withdrawn", candidateActor(b));
    await matching.rerank(frozen);
    expect(await shortlist(role)).toEqual([[a.userId, 1, "shortlisted"], [b.userId, 2, "withdrawn"]]);
    expect((await matching.getFor(role.id, c.userId))!.stage).toBe("applied");
    await expect(matching.freeze(frozen)).rejects.toThrow(/in broadcast/);
  });
  it("keeps rank through later stages, so the shortlist stays in its frozen order", async () => {
    const role = await mkRole();
    const [a, b] = [await mkCandidate(90), await mkCandidate(80)];
    for (const x of [a, b]) await matching.apply(role, x);
    await matching.freeze(role);
    const m = (await matching.getFor(role.id, a.userId))!;
    await matching.setStage(m.id, "viewed", company, {}, ready(role));
    await matching.setStage(m.id, "interviewed", company, {}, ready(role));
    expect(await shortlist(role)).toEqual([[a.userId, 1, "interviewed"], [b.userId, 2, "shortlisted"]]);
  });
});

describe("setStage against the database: every transition in the §4.3 table, legal and illegal", () => {
  // Data that satisfies every move's own requirement, so only the table can refuse.
  const data = { offeredCtc: 150_000_000, hiredCtc: 150_000_000, joinedOn: "2026-11-05", rejectionCategory: "skills" as const };
  const actors: Record<(typeof MATCH_ACTOR_KINDS)[number], MatchActor> = { candidate: { kind: "candidate", userId: "c" }, company, staff, system };
  let pool: MatchingCandidate[];
  beforeAll(async () => { pool = await Promise.all(Array.from({ length: MATCH_STAGES.length * MATCH_ACTOR_KINDS.length }, () => mkCandidate(50))); });

  for (const from of MATCH_STAGES) {
    it(`from ${from}: legal moves land and write an event, illegal ones throw IllegalTransition and change nothing`, async () => {
      const role = await mkRole();
      let i = 0;
      for (const to of MATCH_STAGES) for (const kind of MATCH_ACTOR_KINDS) {
        // left_early needs a confirmed join; did_not_join needs an unconfirmed one.
        const m = await matchAt(role, pool[i++]!, from, to === "left_early" ? { joinConfirmedAt: clock.now(), joinedOn: "2026-11-01" } : {});
        const ctx = from === "hired" ? closing(role, m.id) : ready(role);
        const attempt = matching.setStage(m.id, to, actors[kind], data, ctx);
        if (canMove(from, to, kind)) {
          expect((await attempt).stage, `${from} → ${to} by ${kind}`).toBe(to);
          expect(await matching.events(m.id)).toMatchObject([{ fromStage: from, toStage: to, actorKind: kind }]);
        } else {
          await expect(attempt, `${from} → ${to} by ${kind}`).rejects.toBeInstanceOf(IllegalTransition);
          expect(await stageOf(m)).toBe(from);
          expect(await matching.events(m.id)).toHaveLength(0);
        }
      }
    });
  }
});

describe("what each move must carry", () => {
  it("offered needs offered_ctc", async () => {
    const role = await mkRole();
    const m = await matchAt(role, await mkCandidate(70), "interviewed");
    for (const bad of [undefined, 0, -1, 1.5]) await expect(matching.setStage(m.id, "offered", company, { offeredCtc: bad as any }, ready(role))).rejects.toThrow(/offered CTC/);
    const ok = await matching.setStage(m.id, "offered", company, { offeredCtc: 3_000_000_000 }, ready(role));
    expect(ok).toMatchObject({ stage: "offered", offeredCtc: 3_000_000_000 });
    expect((await matching.events(m.id)).at(-1)!.data).toEqual({ offered_ctc: 3_000_000_000 });
  });
  it("hired needs hired_ctc and a real joined_on", async () => {
    const role = await mkRole();
    const m = await matchAt(role, await mkCandidate(70), "offer_accepted");
    await expect(matching.setStage(m.id, "hired", company, { joinedOn: "2026-12-01" }, ready(role))).rejects.toThrow(/hired CTC/);
    for (const bad of [undefined, "1 Dec 2026", "2026-02-30", "2026-13-01"]) {
      await expect(matching.setStage(m.id, "hired", company, { hiredCtc: 150_000_000, joinedOn: bad }, ready(role))).rejects.toThrow(/joining date/);
    }
    const ok = await matching.setStage(m.id, "hired", company, { hiredCtc: 150_000_000, joinedOn: "2026-12-01" }, ready(role));
    expect(ok).toMatchObject({ stage: "hired", hiredCtc: 150_000_000, joinedOn: "2026-12-01", override: false, joinConfirmedAt: null });
  });
  it("rejected needs a category and keeps an optional note", async () => {
    const role = await mkRole();
    const m = await matchAt(role, await mkCandidate(70), "viewed");
    await expect(matching.setStage(m.id, "rejected", company, {}, ready(role))).rejects.toThrow(/category/);
    await expect(matching.setStage(m.id, "rejected", company, { rejectionCategory: "vibes" as any }, ready(role))).rejects.toThrow(/category/);
    const ok = await matching.setStage(m.id, "rejected", company, { rejectionCategory: "experience", rejectionNote: "  two years short  " }, ready(role));
    expect(ok).toMatchObject({ stage: "rejected", rejectionCategory: "experience", rejectionNote: "two years short" });
    const m2 = await matchAt(role, await mkCandidate(70), "shortlisted");
    expect(await matching.setStage(m2.id, "rejected", company, { rejectionCategory: "no_show", rejectionNote: " " }, ready(role))).toMatchObject({ rejectionNote: null });
  });
  it("an unknown match is a NotFound", async () => {
    await expect(matching.setStage("99999999-9999-4999-8999-999999999999", "viewed", company, {}, { id: "x", status: "shortlist_ready", hiredMatchId: null })).rejects.toThrow(/not found/);
  });
  it("two concurrent moves on one match cannot both land", async () => {
    const role = await mkRole();
    const m = await matchAt(role, await mkCandidate(70), "shortlisted");
    const results = await Promise.allSettled([
      matching.setStage(m.id, "viewed", company, {}, ready(role)),
      matching.setStage(m.id, "rejected", company, { rejectionCategory: "skills" }, ready(role)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await matching.events(m.id)).toHaveLength(1);
  });
});

describe("role precondition and the one-hire rule (§4.3)", () => {
  it("a company can act only while the role is shortlist_ready or closing", async () => {
    const role = await mkRole();
    const m = await matchAt(role, await mkCandidate(70), "shortlisted");
    for (const status of ["draft", "broadcast", "closed", "withdrawn"]) {
      await expect(matching.setStage(m.id, "viewed", company, {}, { id: role.id, status, hiredMatchId: null })).rejects.toMatchObject({ code: "not_actionable", status: 409 });
    }
    await expect(matching.setStage(m.id, "viewed", company)).rejects.toThrow(/needs the match's role/);
    await expect(matching.setStage(m.id, "viewed", company, {}, { id: (await mkRole()).id, status: "shortlist_ready", hiredMatchId: null })).rejects.toThrow(/needs the match's role/);
    expect(await stageOf(m)).toBe("shortlisted");
    expect((await matching.setStage(m.id, "viewed", company, {}, closing(role, null))).stage).toBe("viewed"); // closing without a hire
  });
  it("candidates are not bound by the role precondition", async () => {
    const role = await mkRole();
    const c = await mkCandidate(70);
    const m = await matchAt(role, c, "applied");
    expect((await matching.setStage(m.id, "withdrawn", candidateActor(c))).stage).toBe("withdrawn");
  });
  it("one hire per role: a second company hire is refused while hired_match_id is set", async () => {
    const role = await mkRole();
    const first = await matchAt(role, await mkCandidate(70), "offer_accepted");
    const second = await matchAt(role, await mkCandidate(70), "offer_accepted");
    const hire = { hiredCtc: 150_000_000, joinedOn: "2026-12-01" };
    await matching.setStage(first.id, "hired", company, hire, ready(role));
    await expect(matching.setStage(second.id, "hired", company, hire, ready(role, first.id))).rejects.toMatchObject({ code: "one_hire", status: 409 });
    await expect(matching.setStage(second.id, "hired", company, hire, closing(role, first.id))).rejects.toMatchObject({ code: "one_hire" });
    expect(await stageOf(second)).toBe("offer_accepted");
  });
  it("in closing with a hire: other matches can only be rejected, the hired match only did_not_join or left_early", async () => {
    const role = await mkRole();
    const hired = await matchAt(role, await mkCandidate(70), "hired", { hiredCtc: 150_000_000, joinedOn: "2026-11-01" });
    const other = await matchAt(role, await mkCandidate(70), "shortlisted");
    const another = await matchAt(role, await mkCandidate(70), "interviewed");
    const ctx = closing(role, hired.id);
    await expect(matching.setStage(other.id, "viewed", company, {}, ctx)).rejects.toMatchObject({ code: "not_actionable" });
    await expect(matching.setStage(another.id, "offered", company, { offeredCtc: 1 }, ctx)).rejects.toThrow(/only be rejected/);
    expect((await matching.setStage(other.id, "rejected", company, { rejectionCategory: "position_filled" }, ctx)).stage).toBe("rejected");
    expect((await matching.setStage(hired.id, "did_not_join", company, {}, ctx)).stage).toBe("did_not_join");
  });
  it("did_not_join only before joining is confirmed; left_early only after, within the guarantee", async () => {
    const role = await mkRole();
    const unconfirmed = await matchAt(role, await mkCandidate(70), "hired", { joinedOn: "2026-11-01" });
    await expect(matching.setStage(unconfirmed.id, "left_early", company, {}, closing(role, unconfirmed.id))).rejects.toThrow(/not been confirmed/);

    const confirmed = await matchAt(role, await mkCandidate(70), "hired", { joinedOn: "2026-11-01", joinConfirmedAt: clock.now(), joinConfirmedBy: "candidate" });
    await expect(matching.setStage(confirmed.id, "did_not_join", company, {}, closing(role, confirmed.id))).rejects.toThrow(/already confirmed/);
    await expect(matching.setStage(confirmed.id, "did_not_join", system)).rejects.toThrow(/already confirmed/);
    await expect(matching.setStage(confirmed.id, "left_early", company, {}, { id: role.id, status: "closing", hiredMatchId: confirmed.id })).rejects.toThrow(/replacement guarantee/);

    const now = clock.now();
    clock.set("2027-03-01T00:00:00Z"); // 120 days after joining, past the 90-day guarantee
    await expect(matching.setStage(confirmed.id, "left_early", company, {}, closing(role, confirmed.id))).rejects.toThrow(/guarantee has ended/);
    clock.set("2027-01-30T12:00:00Z"); // day 90
    expect((await matching.setStage(confirmed.id, "left_early", company, {}, closing(role, confirmed.id))).stage).toBe("left_early");
    clock.set(now);
  });
  it("staff override to hired: any stage, flagged, self-confirming, exempt from the one-hire rule and the role precondition", async () => {
    const role = await mkRole({ status: "closed" });
    const m = await matchAt(role, await mkCandidate(70), "rejected", { rejectionCategory: "culture" });
    await expect(matching.setStage(m.id, "hired", staff, {})).rejects.toThrow(/hired CTC/);
    const out = await matching.setStage(m.id, "hired", staff, { hiredCtc: 200_000_000, joinedOn: "2026-10-01" });
    expect(out).toMatchObject({ stage: "hired", override: true, joinConfirmedBy: "staff", hiredCtc: 200_000_000, joinedOn: "2026-10-01" });
    expect(out.joinConfirmedAt).toEqual(clock.now());
    expect((await matching.events(m.id)).at(-1)).toMatchObject({ fromStage: "rejected", toStage: "hired", actorKind: "staff", data: { override: true } });
  });
});

describe("closing and blocking", () => {
  it("closeOpenMatches moves every open match to role_closed and leaves settled ones alone", async () => {
    const role = await mkRole();
    const open: MatchStage[] = ["scored", "applied", "pending_approval", "shortlisted", "viewed", "interviewed", "offered", "offer_accepted"];
    const settled: MatchStage[] = ["hired", "did_not_join", "left_early", "rejected", "declined_by_staff", "withdrawn", "offer_reneged", "role_closed"];
    const ms: Record<string, Match> = {};
    for (const s of [...open, ...settled]) ms[s] = await matchAt(role, await mkCandidate(70), s);
    const untouched = await matchAt(await mkRole(), await mkCandidate(70), "applied"); // another role

    const moved = await matching.closeOpenMatches(role.id);
    expect(moved.map((m) => m.id).sort()).toEqual(open.map((s) => ms[s]!.id).sort());
    for (const s of open) {
      expect(await stageOf(ms[s]!)).toBe("role_closed");
      expect((await matching.events(ms[s]!.id)).at(-1)).toMatchObject({ fromStage: s, toStage: "role_closed", actor: "system" });
    }
    for (const s of settled) { expect(await stageOf(ms[s]!)).toBe(s); expect(await matching.events(ms[s]!.id)).toHaveLength(0); }
    expect(await stageOf(untouched)).toBe("applied");
    expect(await matching.closeOpenMatches(role.id)).toEqual([]);
  });
  it("declineOpenMatches moves a candidate's open matches to declined_by_staff across roles", async () => {
    const c = await mkCandidate(70), other = await mkCandidate(70);
    const [r1, r2, r3] = [await mkRole(), await mkRole(), await mkRole()];
    const a = await matchAt(r1, c, "shortlisted"), b = await matchAt(r2, c, "offered"), done = await matchAt(r3, c, "hired");
    const theirs = await matchAt(r1, other, "shortlisted");
    expect((await matching.declineOpenMatches(c.userId)).map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
    expect([await stageOf(a), await stageOf(b), await stageOf(done), await stageOf(theirs)]).toEqual(["declined_by_staff", "declined_by_staff", "hired", "shortlisted"]);
  });
});

describe("engagedShortlistFraction (§4.3)", () => {
  it("counts shortlisted candidates with a qualifying company action against the shortlist at freeze", async () => {
    const role = await mkRole({ shortlistCap: 4 });
    const cs = await Promise.all([90, 80, 70, 60, 50].map((s) => mkCandidate(s)));
    for (const c of cs) await matching.apply(role, c); // the fifth stays applied, outside the shortlist
    await matching.freeze(role);
    expect(await matching.engagedShortlistFraction(role.id)).toBe(0);
    const [m1, m2, m3, m4] = await matching.listShortlist(role.id);
    const ctx = ready(role);

    await matching.setStage(m1!.id, "viewed", company, {}, ctx); // viewed does not count
    expect(await matching.engagedShortlistFraction(role.id)).toBe(0);
    await matching.setStage(m1!.id, "interviewed", company, {}, ctx);
    await matching.setStage(m1!.id, "offered", company, { offeredCtc: 150_000_000 }, ctx); // a second action on the same candidate counts once
    expect(await matching.engagedShortlistFraction(role.id)).toBe(0.25);
    await matching.setStage(m2!.id, "rejected", company, { rejectionCategory: "skills" }, ctx);
    expect(await matching.engagedShortlistFraction(role.id)).toBe(0.5);
    await matching.setStage(m3!.id, "withdrawn", candidateActor({ userId: m3!.candidateId })); // a candidate's move is not a company action
    await matching.setStage(m4!.id, "viewed", company, {}, ctx);
    expect(await matching.engagedShortlistFraction(role.id)).toBe(0.5);
  });
  it("is 0 for a role with an empty shortlist", async () => {
    expect(await matching.engagedShortlistFraction((await mkRole()).id)).toBe(0);
  });
});

describe("a candidate's applications", () => {
  it("lists what they applied to, newest first, and not what they were only scored for", async () => {
    const c = await mkCandidate(70);
    const [r1, r2, r3] = [await mkRole(), await mkRole(), await mkRole()];
    await matching.broadcast(r3, [c], { pool: 200 }); // scored and nudged, never applied
    await matching.apply(r1, c);
    clock.advance(DAY);
    await matching.apply(r2, c);
    expect((await matching.listForCandidate(c.userId)).map((m) => m.roleId)).toEqual([r2.id, r1.id]);
    expect((await matching.listForCandidateOnRoles(c.userId, [r1.id, r3.id])).map((m) => m.roleId).sort()).toEqual([r1.id, r3.id].sort());
    expect(await matching.listForCandidateOnRoles(c.userId, [])).toEqual([]);
    expect(await matching.applicantCounts([r1.id, r3.id])).toEqual({ [r1.id]: 1 });
  });
});
