import { and, asc, desc, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";
import type { FeeTerms } from "@zenhyre/db/schema";
import { Clock, IllegalTransition, Invalid, NotFound } from "@zenhyre/shared";
import { Actor, RoleStatus, actorRef, canTransition } from "./lifecycle";
import { assertValidFeeTerms } from "./terms";

export type Role = typeof schema.role.$inferSelect;
export type RoleEvent = typeof schema.roleEvent.$inferSelect;
export type RoleGateDecision = typeof schema.roleGateDecision.$inferSelect;
export type RoleType = Role["type"];

/** What a company writes. Editable only while the role is `draft` (the reach also by staff at the gate). */
export interface RoleContent {
  title: string; jd: string; type: RoleType;
  ctcMin: number | null; ctcMax: number | null;
  yearsExpMin: number; yearsExpMax: number;
  locations: string[]; campusReach: string[];
}
/** Non-status fields workflows keep on the role. Status only ever changes through `transition`. */
export interface RoleBookkeeping {
  depositAmount: number | null;
  broadcastClosesAt: Date; broadcastExtendedAt: Date | null;
  shortlistCap: number; nudgeCap: number; jobError: string | null;
}
export type RolePatch = Partial<RoleContent> & Partial<RoleBookkeeping>;

const CONTENT_KEYS = ["title", "jd", "type", "ctcMin", "ctcMax", "yearsExpMin", "yearsExpMax", "locations", "campusReach"] as const;
const BOOKKEEPING_KEYS = ["depositAmount", "broadcastClosesAt", "broadcastExtendedAt", "shortlistCap", "nudgeCap", "jobError"] as const;

/** Data some moves need. `transition` refuses the move when its data is missing. */
export interface TransitionOpts {
  /** gated → terms_pending: the prefilled terms. */
  feeTerms?: FeeTerms;
  /** terms_pending → deposit_pending. */
  depositAmount?: number;
  /** → broadcast: `match.broadcast_days`. */
  broadcastDays?: number;
  /** deposit_pending → broadcast because the gateway confirmed the deposit (no note needed; `deposit_mode = cashfree`). */
  depositPaid?: boolean;
  /** shortlist_ready → closing with a hire. */
  hiredMatchId?: string;
  /** rejected → gated: `gate.appeal_window_days`. */
  appealWindowDays?: number;
}

export interface GateDecisionInput {
  stage: "rules" | "model" | "human"; outcome: "accept" | "reject" | "needs_review"; reason: string;
  rule?: string | null; suggestedReach?: string[]; modelScore?: number | null; decidedBy: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const isMoney = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

function assertValidContent(c: Partial<RoleContent>) {
  if (c.title !== undefined && !c.title.trim()) throw new Invalid("a role needs a title");
  if (c.ctcMin != null && !isMoney(c.ctcMin)) throw new Invalid("ctcMin must be a whole number of paise");
  if (c.ctcMax != null && !isMoney(c.ctcMax)) throw new Invalid("ctcMax must be a whole number of paise");
  for (const k of ["yearsExpMin", "yearsExpMax"] as const) {
    const v = c[k];
    if (v !== undefined && !(Number.isFinite(v) && v >= 0 && v <= 60)) throw new Invalid(`${k} must be between 0 and 60`);
  }
}

export function createRolesModule(db: DbOrTx, clock: Clock) {
  async function get(roleId: string): Promise<Role | null> {
    const [row] = await db.select().from(schema.role).where(eq(schema.role.id, roleId));
    return row ?? null;
  }
  async function must(roleId: string): Promise<Role> {
    const r = await get(roleId);
    if (!r) throw new NotFound("role");
    return r;
  }
  /**
   * Reads the role and holds its row until the caller's transaction ends. Workflows whose outcome depends on the
   * role's status (apply, withdraw, freeze, company actions) start with this, so an application cannot slip in behind
   * a freeze on a status it read a moment too early. Outside a transaction it is a plain read.
   */
  async function lock(roleId: string): Promise<Role> {
    const [row] = await db.select().from(schema.role).where(eq(schema.role.id, roleId)).for("update");
    if (!row) throw new NotFound("role");
    return row;
  }
  async function events(roleId: string): Promise<RoleEvent[]> {
    return db.select().from(schema.roleEvent).where(eq(schema.roleEvent.roleId, roleId)).orderBy(asc(schema.roleEvent.seq));
  }

  /**
   * The only way a role's status changes. Checks the move against the lifecycle table and the actor, applies the
   * move's own preconditions and bookkeeping, and writes the RoleEvent. Race-safe: the update is conditional on the
   * status it read, so of two concurrent moves one fails.
   */
  async function transition(roleId: string, to: RoleStatus, actor: Actor, note?: string | null, opts: TransitionOpts = {}): Promise<Role> {
    const r = await must(roleId);
    const from = r.status;
    if (!canTransition(from, to, actor.kind)) throw new IllegalTransition(from, to);
    const now = clock.now();
    const set: Partial<typeof schema.role.$inferInsert> = { status: to };

    if (from === "rejected" && to === "gated") {
      if (opts.appealWindowDays === undefined) throw new Invalid("an appeal needs the appeal window");
      const history = await events(roleId);
      if (history.some((e) => e.fromStatus === "rejected" && e.toStatus === "gated")) throw new Invalid("this role has already been appealed once");
      const rejectedAt = history.filter((e) => e.toStatus === "rejected").at(-1)?.at ?? r.createdAt;
      if (now.getTime() > rejectedAt.getTime() + opts.appealWindowDays * DAY_MS) throw new Invalid(`the ${opts.appealWindowDays}-day appeal window has closed`);
    }
    if (to === "terms_pending") {
      if (!opts.feeTerms) throw new Invalid("accepting a role needs prefilled fee terms");
      assertValidFeeTerms(opts.feeTerms);
      set.feeTerms = opts.feeTerms;
    }
    if (to === "deposit_pending") {
      if (!r.feeTerms || !r.feeTermsReleasedAt) throw new Invalid("the fee terms have not been released yet");
      if (!isMoney(opts.depositAmount)) throw new Invalid("accepting terms needs the deposit amount");
      set.feeTermsAcceptedAt = now;
      set.depositAmount = opts.depositAmount;
    }
    if (to === "broadcast") {
      // Two ways in: the gateway confirmed the deposit (system), or the staff waiver (§5), which always needs a note.
      if (opts.depositPaid) {
        if (actor.kind !== "system") throw new Invalid("only the payment confirmation opens a broadcast on a paid deposit");
      } else {
        // The system cannot waive: without a paid deposit its move is illegal, as the waiver is staff-only.
        if (actor.kind === "system") throw new IllegalTransition(from, to);
        if (!note?.trim()) throw new Invalid("waiving a deposit needs a note");
      }
      if (!opts.broadcastDays || opts.broadcastDays <= 0) throw new Invalid("opening a broadcast needs its length in days");
      set.depositMode = opts.depositPaid ? "cashfree" : "waived";
      set.broadcastOpensAt = now;
      set.broadcastClosesAt = new Date(now.getTime() + opts.broadcastDays * DAY_MS);
    }
    if (from === "shortlist_ready" && to === "closing") {
      if (actor.kind === "company" && !opts.hiredMatchId) throw new Invalid("a company closes a role by recording a hire");
      if (opts.hiredMatchId) { set.hiredMatchId = opts.hiredMatchId; set.hiredAt = now; }
    }
    if (from === "closing" && to === "shortlist_ready") {
      if (!r.hiredMatchId) throw new Invalid("only a role with a recorded hire can reopen");
      set.hiredMatchId = null; set.hiredAt = null;
    }
    // Every entry to shortlist_ready, reopen included, restarts the 30-day clock (§4.2).
    if (to === "shortlist_ready") set.shortlistReadyAt = now;

    const [row] = await db.update(schema.role).set(set).where(and(eq(schema.role.id, roleId), eq(schema.role.status, from))).returning();
    if (!row) throw new IllegalTransition(from, to);
    await db.insert(schema.roleEvent).values({ roleId, fromStatus: from, toStatus: to, actor: actorRef(actor), note: note ?? null, at: now });
    return row;
  }

  return {
    get,
    /** Like `get`, but a missing role is a NotFound. */
    require: must,
    lock,
    events,
    transition,

    async create(input: { companyId: string; createdBy: string; content: Partial<RoleContent> & Pick<RoleContent, "title" | "type">; shortlistCap?: number; nudgeCap?: number }): Promise<Role> {
      assertValidContent(input.content);
      const now = clock.now();
      const [row] = await db.insert(schema.role).values({
        ...input.content, companyId: input.companyId, createdBy: input.createdBy, createdAt: now,
        ...(input.shortlistCap !== undefined ? { shortlistCap: input.shortlistCap } : {}),
        ...(input.nudgeCap !== undefined ? { nudgeCap: input.nudgeCap } : {}),
      }).returning();
      await db.insert(schema.roleEvent).values({ roleId: row!.id, fromStatus: null, toStatus: "draft", actor: input.createdBy, at: now });
      return row!;
    },

    /** Any non-status field. Content only while `draft`; the reach also while `gated` (staff adjust it at the gate). */
    async update(roleId: string, patch: RolePatch): Promise<Role> {
      const r = await must(roleId);
      const touched = CONTENT_KEYS.filter((k) => patch[k] !== undefined);
      if (touched.length && r.status !== "draft") {
        const reachAtGate = r.status === "gated" && touched.every((k) => k === "campusReach");
        if (!reachAtGate) throw new Invalid(`a ${r.status} role's content can no longer be edited`);
      }
      assertValidContent(patch);
      if (patch.shortlistCap !== undefined && !(Number.isInteger(patch.shortlistCap) && patch.shortlistCap > 0)) throw new Invalid("shortlistCap must be a positive whole number");
      if (patch.nudgeCap !== undefined && !(Number.isInteger(patch.nudgeCap) && patch.nudgeCap >= 0)) throw new Invalid("nudgeCap must be a whole number");
      if (patch.depositAmount != null && !isMoney(patch.depositAmount)) throw new Invalid("depositAmount must be a whole number of paise");
      // Only the fields named above are written: a stray `status` in the patch never reaches the table.
      const set: Record<string, unknown> = {};
      for (const k of [...CONTENT_KEYS, ...BOOKKEEPING_KEYS]) if (patch[k] !== undefined) set[k] = patch[k];
      if (Object.keys(set).length === 0) return r;
      const [row] = await db.update(schema.role).set(set).where(eq(schema.role.id, roleId)).returning();
      return row!;
    },

    async listForCompany(companyId: string): Promise<Role[]> {
      return db.select().from(schema.role).where(eq(schema.role.companyId, companyId)).orderBy(desc(schema.role.createdAt), desc(schema.role.id));
    },
    async listByStatus(statuses: RoleStatus | RoleStatus[]): Promise<Role[]> {
      const list = Array.isArray(statuses) ? statuses : [statuses];
      return db.select().from(schema.role).where(inArray(schema.role.status, list)).orderBy(desc(schema.role.createdAt), desc(schema.role.id));
    },
    async listByIds(ids: string[]): Promise<Role[]> {
      if (!ids.length) return [];
      return db.select().from(schema.role).where(inArray(schema.role.id, ids));
    },
    /** For `role.close_broadcast`: broadcasts whose window has ended. */
    async listBroadcastsDue(): Promise<Role[]> {
      return db.select().from(schema.role).where(and(eq(schema.role.status, "broadcast"), lte(schema.role.broadcastClosesAt, clock.now())));
    },
    /** For `role.terms_auto_release`: terms prefilled at least `hours` ago that staff have not released. */
    async listTermsAwaitingRelease(hours: number): Promise<Role[]> {
      const cutoff = new Date(clock.now().getTime() - hours * 60 * 60 * 1000);
      const rows = await db.select({ role: schema.role }).from(schema.role)
        .innerJoin(schema.roleEvent, and(eq(schema.roleEvent.roleId, schema.role.id), eq(schema.roleEvent.toStatus, "terms_pending")))
        .where(and(eq(schema.role.status, "terms_pending"), isNull(schema.role.feeTermsReleasedAt), lte(schema.roleEvent.at, cutoff)));
      return [...new Map(rows.map((x) => [x.role.id, x.role])).values()];
    },
    /** For `role.terms_timeout`: terms released at least `days` ago that the company has not accepted. */
    async listTermsTimedOut(days: number): Promise<Role[]> {
      const cutoff = new Date(clock.now().getTime() - days * DAY_MS);
      return db.select().from(schema.role).where(and(eq(schema.role.status, "terms_pending"), lte(schema.role.feeTermsReleasedAt, cutoff)));
    },
    /** For `role.dark_check`: shortlists with no hire `days` after they were last made ready (a reopen restarts the clock). */
    async listShortlistsDark(days: number): Promise<Role[]> {
      const cutoff = new Date(clock.now().getTime() - days * DAY_MS);
      return db.select().from(schema.role).where(and(eq(schema.role.status, "shortlist_ready"), isNull(schema.role.hiredMatchId), lte(schema.role.shortlistReadyAt, cutoff)));
    },
    /** For `role.guarantee_expiry`: roles holding in `closing` on a recorded hire. Whether the guarantee has run out is the hired match's to say. */
    async listClosingWithHire(): Promise<Role[]> {
      return db.select().from(schema.role).where(and(eq(schema.role.status, "closing"), isNotNull(schema.role.hiredMatchId)));
    },

    /** draft → gated. The gate job, not this call, decides whether the content is good enough. */
    submit(roleId: string, actor: Actor) { return transition(roleId, "gated", actor); },

    /** rejected → gated, once, within the appeal window. Goes straight to human review (§7). */
    appeal(roleId: string, actor: Actor, opts: { appealWindowDays: number; note?: string }) {
      return transition(roleId, "gated", actor, opts.note ?? "appeal", { appealWindowDays: opts.appealWindowDays });
    },

    /** Appends a decision and points `final_gate_decision_id` at it. Does not move the role. */
    async recordGateDecision(roleId: string, d: GateDecisionInput): Promise<RoleGateDecision> {
      await must(roleId);
      const [row] = await db.insert(schema.roleGateDecision).values({
        roleId, stage: d.stage, outcome: d.outcome, reason: d.reason, rule: d.rule ?? null,
        suggestedReach: d.suggestedReach ?? [], modelScore: d.modelScore ?? null, decidedBy: d.decidedBy, decidedAt: clock.now() }).returning();
      await db.update(schema.role).set({ finalGateDecisionId: row!.id }).where(eq(schema.role.id, roleId));
      return row!;
    },
    async gateDecisions(roleId: string): Promise<RoleGateDecision[]> {
      return db.select().from(schema.roleGateDecision).where(eq(schema.roleGateDecision.roleId, roleId))
        .orderBy(asc(schema.roleGateDecision.decidedAt), asc(schema.roleGateDecision.id));
    },
    async finalGateDecision(role: Pick<Role, "finalGateDecisionId">): Promise<RoleGateDecision | null> {
      if (!role.finalGateDecisionId) return null;
      const [row] = await db.select().from(schema.roleGateDecision).where(eq(schema.roleGateDecision.id, role.finalGateDecisionId));
      return row ?? null;
    },

    /** Staff edit the prefilled terms while the role is `terms_pending`. Terms cannot change after acceptance (§7). */
    async setFeeTerms(roleId: string, terms: FeeTerms): Promise<Role> {
      const r = await must(roleId);
      if (r.status !== "terms_pending" || r.feeTermsAcceptedAt) throw new Invalid("fee terms can only change while the role is waiting for acceptance");
      assertValidFeeTerms(terms);
      const [row] = await db.update(schema.role).set({ feeTerms: terms }).where(eq(schema.role.id, roleId)).returning();
      return row!;
    },
    /** Shows the terms to the company. Returns `released: false` when they were already out. */
    async releaseTerms(roleId: string): Promise<{ role: Role; released: boolean }> {
      const r = await must(roleId);
      if (r.status !== "terms_pending") throw new Invalid("only a role waiting on terms can have them released");
      if (r.feeTermsReleasedAt) return { role: r, released: false };
      const [row] = await db.update(schema.role).set({ feeTermsReleasedAt: clock.now() })
        .where(and(eq(schema.role.id, roleId), isNull(schema.role.feeTermsReleasedAt))).returning();
      return row ? { role: row, released: true } : { role: await must(roleId), released: false };
    },
    /** terms_pending → deposit_pending: stores the acceptance time and the deposit the role now owes. */
    acceptTerms(roleId: string, actor: Actor, opts: { depositAmount: number }) {
      return transition(roleId, "deposit_pending", actor, null, { depositAmount: opts.depositAmount });
    },
    /** deposit_pending → broadcast with `deposit_mode = waived`. Always a staff actor and a note (§5). */
    waiveDeposit(roleId: string, actor: Actor, note: string, opts: { broadcastDays: number }) {
      return transition(roleId, "broadcast", actor, note, { broadcastDays: opts.broadcastDays });
    },
    /** deposit_pending → broadcast with `deposit_mode = cashfree`: the gateway confirmed the deposit. */
    depositPaid(roleId: string, opts: { broadcastDays: number; note: string }) {
      return transition(roleId, "broadcast", { kind: "system" }, opts.note, { broadcastDays: opts.broadcastDays, depositPaid: true });
    },
    /** Pushes `broadcast_closes_at` out by `days`. Once per role, and only while it is in broadcast (§5). */
    async extendBroadcast(roleId: string, days: number): Promise<Role> {
      const r = await must(roleId);
      if (r.status !== "broadcast" || !r.broadcastClosesAt) throw new Invalid("only a role in broadcast can be extended");
      if (r.broadcastExtendedAt) throw new Invalid("this broadcast has already been extended once");
      if (!(days > 0)) throw new Invalid("an extension needs its length in days");
      const [row] = await db.update(schema.role)
        .set({ broadcastClosesAt: new Date(r.broadcastClosesAt.getTime() + days * DAY_MS), broadcastExtendedAt: clock.now() })
        .where(and(eq(schema.role.id, roleId), eq(schema.role.status, "broadcast"), isNull(schema.role.broadcastExtendedAt))).returning();
      if (!row) throw new Invalid("this broadcast has already been extended once");
      return row;
    },
    /**
     * §5 replacement role, for a hire who left inside the guarantee: a copy of the original's content and reach with a
     * zero fee and a waived deposit, created directly in `broadcast`. Gate and terms are inherited from the original.
     */
    async createReplacement(roleId: string, actor: Actor, opts: { broadcastDays: number }): Promise<Role> {
      const o = await must(roleId);
      if (!o.feeTerms) throw new Invalid("only a role with fee terms can be replaced");
      if (!(opts.broadcastDays > 0)) throw new Invalid("opening a broadcast needs its length in days");
      const now = clock.now();
      const [row] = await db.insert(schema.role).values({
        companyId: o.companyId, createdBy: o.createdBy, createdAt: now, title: o.title, jd: o.jd, type: o.type, ctcMin: o.ctcMin, ctcMax: o.ctcMax,
        yearsExpMin: o.yearsExpMin, yearsExpMax: o.yearsExpMax, locations: o.locations, campusReach: o.campusReach,
        shortlistCap: o.shortlistCap, nudgeCap: o.nudgeCap, finalGateDecisionId: o.finalGateDecisionId,
        feeTerms: { ...o.feeTerms, amount: 0 }, feeTermsReleasedAt: o.feeTermsReleasedAt, feeTermsAcceptedAt: o.feeTermsAcceptedAt,
        depositAmount: 0, depositMode: "waived", status: "broadcast", broadcastOpensAt: now,
        broadcastClosesAt: new Date(now.getTime() + opts.broadcastDays * DAY_MS), replacementOfRoleId: o.id }).returning();
      await db.insert(schema.roleEvent).values({ roleId: row!.id, fromStatus: null, toStatus: "broadcast", actor: actorRef(actor), note: `replacement for role ${o.id}`, at: now });
      return row!;
    },
    /** shortlist_ready → closing, recording the one hire. */
    recordHire(roleId: string, matchId: string, actor: Actor) {
      return transition(roleId, "closing", actor, null, { hiredMatchId: matchId });
    },
    /** closing → shortlist_ready after a hire fell through: clears the hire and restarts the shortlist clock. */
    reopen(roleId: string, actor: Actor, note?: string) {
      return transition(roleId, "shortlist_ready", actor, note ?? "hire did not join");
    },

    /** `mergeCompanies`: the absorbed company's roles move to the survivor. */
    async reassignCompany(fromCompanyId: string, toCompanyId: string): Promise<number> {
      const rows = await db.update(schema.role).set({ companyId: toCompanyId }).where(eq(schema.role.companyId, fromCompanyId)).returning({ id: schema.role.id });
      return rows.length;
    },
  };
}
