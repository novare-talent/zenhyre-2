import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";
import { Clock, DomainError, Forbidden, IllegalTransition, Invalid, NotFound } from "@zenhyre/shared";
import { MatchActor, MatchStage, QUALIFYING_STAGES, REJECTION_CATEGORIES, RejectionCategory, SETTLED_STAGES, SYSTEM_ACTOR,
  canMove, guaranteeEndsAt, matchActorRef } from "./stages";
import { MatchingCandidate, MatchingRole, canApply, isMatchable } from "./filter";
import { Fit, Scorer } from "./scorer";

export type Match = typeof schema.match.$inferSelect;
export type MatchEvent = typeof schema.matchEvent.$inferSelect;

/**
 * How matching learns a candidate's current verification and trust state. `identity` satisfies it; matching never
 * reads identity's tables (§3.3).
 */
export interface CandidateDirectory {
  listCandidatesByIds(userIds: string[]): Promise<Array<{ userId: string; verificationState: string; trustStatus: string }>>;
  withDb(tx: DbOrTx): CandidateDirectory;
}

/** What `setStage` needs to know about the role when a company acts (§4.3 role precondition and one-hire rule). */
export interface RoleContext {
  id: string; status: string; hiredMatchId: string | null;
  /** From the role's fee terms; needed only for `left_early`. */
  replacementGuaranteeDays?: number;
}

export interface StageData {
  offeredCtc?: number; hiredCtc?: number; joinedOn?: string;
  rejectionCategory?: RejectionCategory; rejectionNote?: string;
}

export interface RerankResult { promoted: Match[]; displaced: Match[]; shortlisted: number }
export interface ApplyResult extends RerankResult { match: Match; pendingApproval: boolean }

const isCtc = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00Z").getTime())
  && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
const closed = (msg: string) => new DomainError("not_actionable", msg, 409);

export function createMatchingModule(db: DbOrTx, clock: Clock, scorer: Scorer, candidates: CandidateDirectory) {
  async function get(matchId: string): Promise<Match | null> {
    const [row] = await db.select().from(schema.match).where(eq(schema.match.id, matchId));
    return row ?? null;
  }
  async function must(matchId: string): Promise<Match> {
    const m = await get(matchId);
    if (!m) throw new NotFound("match");
    return m;
  }
  async function getFor(roleId: string, candidateId: string): Promise<Match | null> {
    const [row] = await db.select().from(schema.match).where(and(eq(schema.match.roleId, roleId), eq(schema.match.candidateId, candidateId)));
    return row ?? null;
  }
  /** Serialises ranking for one role inside the caller's transaction, so two applies cannot both take the last seat. */
  async function lockRole(roleId: string) {
    await db.execute(sql`select pg_advisory_xact_lock(hashtext(${"match:" + roleId}))`);
  }

  /** Writes the stage change and its MatchEvent. Conditional on the stage it read, so concurrent moves cannot both land. */
  async function move(m: Match, to: MatchStage, actor: MatchActor, set: Partial<typeof schema.match.$inferInsert>, data: Record<string, unknown>): Promise<Match> {
    const now = clock.now();
    const [row] = await db.update(schema.match).set({ ...set, stage: to, updatedAt: now })
      .where(and(eq(schema.match.id, m.id), eq(schema.match.stage, m.stage))).returning();
    if (!row) throw new IllegalTransition(m.stage, to);
    await db.insert(schema.matchEvent).values({ matchId: m.id, fromStage: m.stage, toStage: to, actor: matchActorRef(actor), actorKind: actor.kind, data, at: now });
    return row;
  }

  /** §4.3 role precondition for company actors, and the one-hire rule. */
  function assertCompanyMayAct(m: Match, to: MatchStage, role: RoleContext | undefined) {
    if (!role || role.id !== m.roleId) throw new Invalid("a company action needs the match's role");
    if (role.status !== "shortlist_ready" && role.status !== "closing") throw closed("The shortlist is not open for action.");
    if (to === "hired" && role.hiredMatchId) throw new DomainError("one_hire", "This role already has a recorded hire.", 409);
    if (role.status === "closing" && role.hiredMatchId) {
      const allowed: MatchStage[] = m.id === role.hiredMatchId ? ["did_not_join", "left_early"] : ["rejected"];
      if (!allowed.includes(to)) throw closed(m.id === role.hiredMatchId
        ? "The hired candidate can only be marked as did not join or left early."
        : "A hire is recorded on this role; other candidates can only be rejected.");
    }
  }

  /**
   * The only way a match's stage changes. Anything not in the §4.3 table is an IllegalTransition; a legal move still
   * has to carry its data (`offered_ctc`, `hired_ctc` + `joined_on`, `rejection_category`) and, for a company actor,
   * pass the role precondition and the one-hire rule.
   */
  async function setStage(matchId: string, to: MatchStage, actor: MatchActor, data: StageData = {}, role?: RoleContext): Promise<Match> {
    const m = await must(matchId);
    const from = m.stage;
    if (!canMove(from, to, actor.kind)) throw new IllegalTransition(from, to);
    if (actor.kind === "company") assertCompanyMayAct(m, to, role);

    const now = clock.now();
    const set: Partial<typeof schema.match.$inferInsert> = {};
    const eventData: Record<string, unknown> = {};

    if (to === "applied" && from === "scored") set.appliedAt = now;
    if (to === "applied" && from === "shortlisted") set.rank = null; // displacement
    if (to === "offered") {
      if (!isCtc(data.offeredCtc)) throw new Invalid("an offer needs the offered CTC in paise");
      set.offeredCtc = data.offeredCtc; eventData.offered_ctc = data.offeredCtc;
    }
    if (to === "hired") {
      if (!isCtc(data.hiredCtc)) throw new Invalid("a hire needs the hired CTC in paise");
      if (!isDate(data.joinedOn)) throw new Invalid("a hire needs the joining date (YYYY-MM-DD)");
      set.hiredCtc = data.hiredCtc; set.joinedOn = data.joinedOn;
      eventData.hired_ctc = data.hiredCtc; eventData.joined_on = data.joinedOn;
      if (actor.kind === "staff") {
        // confirmLeakage: the override is its own join confirmation and is exempt from the one-hire rule.
        set.override = true; set.joinConfirmedAt = now; set.joinConfirmedBy = "staff"; eventData.override = true;
      } else {
        set.joinConfirmedAt = null; set.joinConfirmedBy = null; set.joinPromptSentAt = null;
      }
    }
    if (to === "rejected") {
      if (!data.rejectionCategory || !REJECTION_CATEGORIES.includes(data.rejectionCategory)) throw new Invalid("a rejection needs a category");
      set.rejectionCategory = data.rejectionCategory; set.rejectionNote = data.rejectionNote?.trim() || null;
      eventData.rejection_category = data.rejectionCategory;
      if (set.rejectionNote) eventData.rejection_note = set.rejectionNote;
    }
    if (to === "did_not_join" && m.joinConfirmedAt) throw closed("Joining was already confirmed; use left early instead.");
    if (to === "left_early") {
      if (!m.joinConfirmedAt) throw closed("Joining has not been confirmed yet; use did not join instead.");
      const days = role?.replacementGuaranteeDays;
      if (days === undefined || !m.joinedOn) throw new Invalid("left early needs the role's replacement guarantee");
      if (now.getTime() > guaranteeEndsAt(m.joinedOn, days).getTime()) throw closed(`The ${days}-day replacement guarantee has ended.`);
    }
    return move(m, to, actor, set, eventData);
  }

  /**
   * While the role is `broadcast`: the top `shortlist_cap` verified applicants by fit score hold the shortlist, ranked
   * from 1. Ties go to the earlier application, so an equal score never displaces. A no-op in any other status, which
   * is what freezes the ranks.
   */
  async function rerank(role: Pick<MatchingRole, "id" | "status" | "shortlistCap">): Promise<RerankResult> {
    const result: RerankResult = { promoted: [], displaced: [], shortlisted: 0 };
    if (role.status !== "broadcast") return result;
    await lockRole(role.id);
    const pool = await db.select().from(schema.match)
      .where(and(eq(schema.match.roleId, role.id), sql`(${schema.match.stage} in ('applied', 'shortlisted') or ${schema.match.rank} is not null)`));
    const contenders = pool.filter((m) => m.stage === "applied" || m.stage === "shortlisted");
    const verified = new Set((await candidates.listCandidatesByIds(contenders.map((m) => m.candidateId)))
      .filter((c) => c.verificationState === "verified").map((c) => c.userId));
    const ranked = contenders.filter((m) => verified.has(m.candidateId)).sort((a, b) =>
      b.fitScore - a.fitScore || (a.appliedAt?.getTime() ?? 0) - (b.appliedAt?.getTime() ?? 0) || a.candidateId.localeCompare(b.candidateId));
    const top = ranked.slice(0, role.shortlistCap);
    const seat = new Map(top.map((m, i) => [m.id, i + 1]));

    // Displace first, so nobody is ever seated above the cap.
    for (const m of pool) {
      if (seat.has(m.id)) continue;
      if (m.stage === "shortlisted") result.displaced.push(await move(m, "applied", SYSTEM_ACTOR, { rank: null }, { reason: "displaced" }));
      else if (m.rank !== null) await db.update(schema.match).set({ rank: null }).where(eq(schema.match.id, m.id)); // left the shortlist during broadcast
    }
    for (const m of top) {
      const rank = seat.get(m.id)!;
      if (m.stage === "applied") result.promoted.push(await move(m, "shortlisted", SYSTEM_ACTOR, { rank }, { rank }));
      else if (m.rank !== rank) await db.update(schema.match).set({ rank }).where(eq(schema.match.id, m.id));
    }
    result.shortlisted = top.length;
    return result;
  }

  async function insertScored(role: MatchingRole, fits: Array<{ c: MatchingCandidate; fit: Fit }>): Promise<Match[]> {
    if (!fits.length) return [];
    const now = clock.now();
    const rows = fits.map(({ c, fit }) => ({
      roleId: role.id, candidateId: c.userId, fitScore: Math.max(0, Math.min(100, Math.round(fit.fitScore))), fitReason: fit.fitReason, updatedAt: now }));
    const inserted = await db.insert(schema.match).values(rows).onConflictDoNothing().returning();
    if (inserted.length) {
      await db.insert(schema.matchEvent).values(inserted.map((m) => ({ matchId: m.id, fromStage: null, toStage: "scored" as const, actor: "system", actorKind: "system", data: { fit_score: m.fitScore }, at: now })));
    }
    return inserted;
  }

  return {
    get,
    /** Like `get`, but a missing match is a NotFound. */
    require: must,
    getFor,
    setStage,
    rerank,

    async events(matchId: string): Promise<MatchEvent[]> {
      return db.select().from(schema.matchEvent).where(eq(schema.matchEvent.matchId, matchId)).orderBy(asc(schema.matchEvent.seq));
    },

    /**
     * §8 steps 3–4. Scores the matchable candidates, keeps the best `pool` (`match.rerank_pool`), writes a
     * `Match(stage = scored)` for each, and marks the top `nudge_cap` with `trust_status = ok` as nudged. Safe to run
     * twice: existing matches are kept and nobody is nudged a second time. Returns the candidates to notify.
     */
    async broadcast(role: MatchingRole, cands: MatchingCandidate[], opts: { pool: number }): Promise<{ scored: number; nudged: string[] }> {
      if (role.status !== "broadcast") throw new Invalid("only a role in broadcast can be broadcast");
      await lockRole(role.id);
      const eligible = cands.filter((c) => isMatchable(role, c));
      const scoredFits = await Promise.all(eligible.map(async (c) => ({ c, fit: await scorer.score(role, c) })));
      scoredFits.sort((a, b) => b.fit.fitScore - a.fit.fitScore || a.c.userId.localeCompare(b.c.userId));
      const inserted = await insertScored(role, scoredFits.slice(0, opts.pool));

      const trustOk = new Set(eligible.filter((c) => c.trustStatus === "ok").map((c) => c.userId));
      const all = await db.select().from(schema.match).where(eq(schema.match.roleId, role.id))
        .orderBy(desc(schema.match.fitScore), asc(schema.match.candidateId));
      const toNudge = all.filter((m) => trustOk.has(m.candidateId)).slice(0, role.nudgeCap).filter((m) => m.nudgedAt === null);
      if (toNudge.length) {
        await db.update(schema.match).set({ nudgedAt: clock.now() }).where(inArray(schema.match.id, toNudge.map((m) => m.id)));
      }
      return { scored: inserted.length, nudged: toNudge.map((m) => m.candidateId) };
    },

    /**
     * §8 step 5. Refuses candidates `canApply` refuses. A candidate outside the scored set is scored now. Restricted
     * candidates wait in `pending_approval` (the workflow opens the review item); everyone else is ranked at once.
     */
    async apply(role: MatchingRole, candidate: MatchingCandidate): Promise<ApplyResult> {
      const check = canApply(role, candidate);
      if (!check.ok) throw new Forbidden(check.reason);
      await lockRole(role.id);
      let m = await getFor(role.id, candidate.userId);
      if (!m) {
        await insertScored(role, [{ c: candidate, fit: await scorer.score(role, candidate) }]);
        m = (await getFor(role.id, candidate.userId))!;
      }
      if (m.stage !== "scored") throw new DomainError("already_applied", m.stage === "withdrawn" ? "You withdrew this application." : "You have already applied to this role.", 409);
      const actor: MatchActor = { kind: "candidate", userId: candidate.userId };
      m = await setStage(m.id, "applied", actor);
      if (candidate.trustStatus === "restricted") {
        m = await setStage(m.id, "pending_approval", SYSTEM_ACTOR);
        return { match: m, pendingApproval: true, promoted: [], displaced: [], shortlisted: 0 };
      }
      const rr = await rerank(role);
      return { match: (await get(m.id))!, pendingApproval: false, ...rr };
    },

    /** §8 step 6: one last ranking, then the caller moves the role to `shortlist_ready`, after which ranks no longer change. */
    async freeze(role: Pick<MatchingRole, "id" | "status" | "shortlistCap">): Promise<{ shortlisted: number }> {
      if (role.status !== "broadcast") throw new Invalid("only a role in broadcast can be frozen");
      const { shortlisted } = await rerank(role);
      return { shortlisted };
    },

    /** The ranked shortlist. Rows keep their rank as they move through later stages, so this is the list as frozen. */
    async listShortlist(roleId: string): Promise<Match[]> {
      return db.select().from(schema.match).where(and(eq(schema.match.roleId, roleId), isNotNull(schema.match.rank))).orderBy(asc(schema.match.rank));
    },
    /** Everyone who applied, best fit first. Staff only: displaced and unranked applicants are in here. */
    async listApplicants(roleId: string): Promise<Match[]> {
      return db.select().from(schema.match).where(and(eq(schema.match.roleId, roleId), isNotNull(schema.match.appliedAt)))
        .orderBy(desc(schema.match.fitScore), asc(schema.match.appliedAt));
    },
    /** A candidate's applications, newest first. Matches they were only scored or nudged for are not applications. */
    async listForCandidate(candidateId: string): Promise<Match[]> {
      return db.select().from(schema.match).where(and(eq(schema.match.candidateId, candidateId), isNotNull(schema.match.appliedAt)))
        .orderBy(desc(schema.match.appliedAt));
    },
    /** A candidate's matches on the given roles, applied or not (for "you were nudged" / "you applied" on the role board). */
    async listForCandidateOnRoles(candidateId: string, roleIds: string[]): Promise<Match[]> {
      if (!roleIds.length) return [];
      return db.select().from(schema.match).where(and(eq(schema.match.candidateId, candidateId), inArray(schema.match.roleId, roleIds)));
    },
    async applicantCounts(roleIds: string[]): Promise<Record<string, number>> {
      if (!roleIds.length) return {};
      const rows = await db.select({ roleId: schema.match.roleId, n: sql<number>`count(*)::int` }).from(schema.match)
        .where(and(inArray(schema.match.roleId, roleIds), isNotNull(schema.match.appliedAt))).groupBy(schema.match.roleId);
      return Object.fromEntries(rows.map((r) => [r.roleId, r.n]));
    },

    /** `role.join_prompt`: records that the hired candidate was asked `did_you_join`. False if they already were, or the match is no longer `hired`. */
    async markJoinPromptSent(matchId: string): Promise<boolean> {
      const rows = await db.update(schema.match).set({ joinPromptSentAt: clock.now() })
        .where(and(eq(schema.match.id, matchId), eq(schema.match.stage, "hired"), isNull(schema.match.joinPromptSentAt))).returning({ id: schema.match.id });
      return rows.length > 0;
    },
    /**
     * §9.2: the hire's joining is confirmed, by the candidate, by grace (no answer), or by staff settling a dispute.
     * Once only; from here `did_not_join` is closed and `left_early` opens. The stage stays `hired`, so the event
     * records `hired → hired` with who confirmed.
     */
    async confirmJoin(matchId: string, by: "candidate" | "grace" | "staff", actor: MatchActor): Promise<Match> {
      const m = await must(matchId);
      if (m.stage !== "hired") throw closed("Only a recorded hire can be confirmed as joined.");
      const now = clock.now();
      const [row] = await db.update(schema.match).set({ joinConfirmedAt: now, joinConfirmedBy: by, updatedAt: now })
        .where(and(eq(schema.match.id, m.id), eq(schema.match.stage, "hired"), isNull(schema.match.joinConfirmedAt))).returning();
      if (!row) throw closed("Joining is already confirmed.");
      await db.insert(schema.matchEvent).values({ matchId: m.id, fromStage: "hired", toStage: "hired", actor: matchActorRef(actor), actorKind: actor.kind, data: { join_confirmed_by: by }, at: now });
      return row;
    },

    /** `closeRole` / `withdrawRole`: every open match on the role becomes `role_closed`. Settled matches, `hired` included, are untouched. */
    async closeOpenMatches(roleId: string): Promise<Match[]> {
      const open = await db.select().from(schema.match).where(and(eq(schema.match.roleId, roleId), notInArray(schema.match.stage, [...SETTLED_STAGES])));
      const out: Match[] = [];
      for (const m of open) out.push(await move(m, "role_closed", SYSTEM_ACTOR, {}, {}));
      return out;
    },
    /** `blockCandidate`: every open match of the candidate becomes `declined_by_staff`. */
    async declineOpenMatches(candidateId: string): Promise<Match[]> {
      const open = await db.select().from(schema.match).where(and(eq(schema.match.candidateId, candidateId), notInArray(schema.match.stage, [...SETTLED_STAGES])));
      const out: Match[] = [];
      for (const m of open) out.push(await move(m, "declined_by_staff", SYSTEM_ACTOR, {}, { reason: "candidate_blocked" }));
      return out;
    },

    /** §4.3: distinct shortlisted candidates with at least one qualifying company action ÷ candidates shortlisted at freeze. */
    async engagedShortlistFraction(roleId: string): Promise<number> {
      const shortlist = await db.select({ id: schema.match.id }).from(schema.match).where(and(eq(schema.match.roleId, roleId), isNotNull(schema.match.rank)));
      if (!shortlist.length) return 0;
      const engaged = await db.selectDistinct({ matchId: schema.matchEvent.matchId }).from(schema.matchEvent).where(and(
        inArray(schema.matchEvent.matchId, shortlist.map((m) => m.id)), eq(schema.matchEvent.actorKind, "company"),
        inArray(schema.matchEvent.toStage, [...QUALIFYING_STAGES])));
      return engaged.length / shortlist.length;
    },
  };
}
