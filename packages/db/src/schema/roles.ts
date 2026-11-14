import { uuid, text, timestamp, integer, bigint, bigserial, jsonb, real, index } from "drizzle-orm/pg-core";
import { z2 } from "./_schema";
import { company } from "./identity";

export const roleType = z2.enum("role_type", ["intern", "fresher", "experienced"]);
/** §5. Open: draft, gated, terms_pending, deposit_pending, broadcast, shortlist_ready. Terminal: closed, withdrawn, rejected. */
export const roleStatus = z2.enum("role_status", [
  "draft", "gated", "rejected", "terms_pending", "deposit_pending", "broadcast", "shortlist_ready", "closing", "closed", "withdrawn"]);
export const depositMode = z2.enum("deposit_mode", ["razorpay", "waived"]);
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
 * `final_gate_decision_id` and `hired_match_id` carry no FK: the first would be circular, the second points into `matching`'s table.
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
  finalGateDecisionId: uuid("final_gate_decision_id"),
  feeTerms: jsonb("fee_terms").$type<FeeTerms>(),
  feeTermsReleasedAt: timestamp("fee_terms_released_at", { withTimezone: true }),
  feeTermsAcceptedAt: timestamp("fee_terms_accepted_at", { withTimezone: true }),
  depositAmount: bigint("deposit_amount", { mode: "number" }),
  /** Null until a deposit path is chosen. Slice 1 only ever writes `waived` (staff waiver); Slice 2 writes `razorpay` at acceptTerms. */
  depositMode: depositMode("deposit_mode"),
  depositOrderId: text("deposit_order_id"),
  refundOwed: bigint("refund_owed", { mode: "number" }),
  broadcastOpensAt: timestamp("broadcast_opens_at", { withTimezone: true }),
  broadcastClosesAt: timestamp("broadcast_closes_at", { withTimezone: true }),
  broadcastExtendedAt: timestamp("broadcast_extended_at", { withTimezone: true }),
  shortlistReadyAt: timestamp("shortlist_ready_at", { withTimezone: true }),
  shortlistCap: integer("shortlist_cap").notNull().default(25),
  nudgeCap: integer("nudge_cap").notNull().default(150),
  replacementOfRoleId: uuid("replacement_of_role_id"),
  hiredMatchId: uuid("hired_match_id"),
  hiredAt: timestamp("hired_at", { withTimezone: true }),
  jobError: text("job_error"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("role_company_idx").on(t.companyId),
  index("role_status_idx").on(t.status),
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
}, (t) => [index("role_gate_decision_role_idx").on(t.roleId, t.decidedAt)]);
