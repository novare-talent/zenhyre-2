import { uuid, text, timestamp, integer, bigint, bigserial, jsonb, real, index, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z2 } from "./_schema";
import { company, user } from "./identity";
import { match } from "./matching";

export const roleType = z2.enum("role_type", ["intern", "fresher", "experienced"]);
/** §5. Open: draft, gated, terms_pending, deposit_pending, broadcast, shortlist_ready. Terminal: closed, withdrawn, rejected. */
export const roleStatus = z2.enum("role_status", [
  "draft", "gated", "rejected", "terms_pending", "deposit_pending", "broadcast", "shortlist_ready", "closing", "closed", "withdrawn"]);
export const depositMode = z2.enum("deposit_mode", ["razorpay", "waived", "cashfree"]);
export const gateStage = z2.enum("gate_stage", ["rules", "model", "human"]);
export const gateOutcome = z2.enum("gate_outcome", ["accept", "reject", "needs_review"]);

/** §4.2. `amount` is paise for `flat` and a fraction (0.10 = 10%) for `percent`. */
export interface FeeTerms {
  kind: "flat" | "percent";
  amount: number;
  replacement_guarantee_days: number;
  notes?: string;
}

/**
 * §4.2 Role. All money is paise; CTC is annual (monthly stipend × 12 for interns) and bigint because int4 tops out near ₹2.1 crore.
 * `embedding vector(1536)` arrives with pgvector; Slice 1 scores through `matching`'s Scorer interface instead.
 * `final_gate_decision_id`, `hired_match_id` and `replacement_of_role_id` are foreign keys since 0006 (circular references are
 * fine in Postgres: they are nullable and set after the row they point to exists).
 */
export const role = z2.table("role", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => company.id),
  title: text("title").notNull(),
  jd: text("jd").notNull().default(""),
  type: roleType("type").notNull(),
  ctcMin: bigint("ctc_min", { mode: "number" }),
  ctcMax: bigint("ctc_max", { mode: "number" }),
  yearsExpMin: real("years_exp_min").notNull().default(0),
  yearsExpMax: real("years_exp_max").notNull().default(0),
  locations: text("locations").array().notNull().default([]),
  campusReach: uuid("campus_reach").array().notNull().default([]),
  status: roleStatus("status").notNull().default("draft"),
  finalGateDecisionId: uuid("final_gate_decision_id").references((): AnyPgColumn => roleGateDecision.id),
  feeTerms: jsonb("fee_terms").$type<FeeTerms>(),
  feeTermsReleasedAt: timestamp("fee_terms_released_at", { withTimezone: true }),
  feeTermsAcceptedAt: timestamp("fee_terms_accepted_at", { withTimezone: true }),
  depositAmount: bigint("deposit_amount", { mode: "number" }),
  /** Null until a deposit path is chosen. `waived` by the staff waiver or a replacement role, `cashfree` once the deposit is paid. `razorpay` is unused. */
  depositMode: depositMode("deposit_mode"),
  broadcastOpensAt: timestamp("broadcast_opens_at", { withTimezone: true }),
  broadcastClosesAt: timestamp("broadcast_closes_at", { withTimezone: true }),
  broadcastExtendedAt: timestamp("broadcast_extended_at", { withTimezone: true }),
  shortlistReadyAt: timestamp("shortlist_ready_at", { withTimezone: true }),
  shortlistCap: integer("shortlist_cap").notNull().default(25),
  nudgeCap: integer("nudge_cap").notNull().default(150),
  replacementOfRoleId: uuid("replacement_of_role_id").references((): AnyPgColumn => role.id),
  hiredMatchId: uuid("hired_match_id").references((): AnyPgColumn => match.id),
  hiredAt: timestamp("hired_at", { withTimezone: true }),
  jobError: text("job_error"),
  createdBy: uuid("created_by").references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("role_company_idx").on(t.companyId),
  index("role_status_idx").on(t.status),
  check("role_ctc_ck", sql`(ctc_min is null or ctc_min >= 0) and (ctc_max is null or ctc_max >= 0) and (ctc_min is null or ctc_max is null or ctc_min <= ctc_max)`),
  check("role_years_ck", sql`years_exp_min >= 0 and years_exp_min <= years_exp_max`),
  check("role_caps_ck", sql`shortlist_cap > 0 and nudge_cap > 0`),
  check("role_deposit_ck", sql`deposit_amount is null or deposit_amount >= 0`),
]);

/** Append-only. `from_status` is null for the creation event (and for replacement roles created directly in `broadcast`). */
export const roleEvent = z2.table("role_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Insertion order. `at` alone cannot order two events written in the same millisecond. */
  seq: bigserial("seq", { mode: "number" }).notNull(),
  roleId: uuid("role_id").notNull().references(() => role.id),
  fromStatus: roleStatus("from_status"),
  toStatus: roleStatus("to_status").notNull(),
  /** A user id, or "system". */
  actor: text("actor").notNull(),
  note: text("note"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("role_event_role_idx").on(t.roleId, t.seq)]);

export const roleGateDecision = z2.table("role_gate_decision", {
  id: uuid("id").primaryKey().defaultRandom(),
  roleId: uuid("role_id").notNull().references(() => role.id),
  stage: gateStage("stage").notNull(),
  outcome: gateOutcome("outcome").notNull(),
  reason: text("reason").notNull(),
  /** The rule that decided, for a stage-1 reject ("Role category", "Minimum CTC", "Required fields"). */
  rule: text("rule"),
  suggestedReach: uuid("suggested_reach").array().notNull().default([]),
  modelScore: integer("model_score"),
  /** A user id, or "system". */
  decidedBy: text("decided_by").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("role_gate_decision_role_idx").on(t.roleId, t.decidedAt),
  check("role_gate_decision_score_ck", sql`model_score is null or model_score between 0 and 100`),
]);
