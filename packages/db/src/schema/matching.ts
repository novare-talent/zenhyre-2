import { uuid, text, timestamp, integer, bigint, bigserial, boolean, date, jsonb, unique, index } from "drizzle-orm/pg-core";
import { z2 } from "./_schema";
import { candidate } from "./identity";
import { role } from "./roles";

/** §4.3. Settled: hired, did_not_join, left_early, rejected, declined_by_staff, withdrawn, offer_reneged, role_closed. All others are open. */
export const matchStage = z2.enum("match_stage", [
  "scored", "applied", "pending_approval", "shortlisted", "viewed", "interviewed", "offered", "offer_accepted", "hired",
  "offer_reneged", "rejected", "withdrawn", "did_not_join", "left_early", "declined_by_staff", "role_closed"]);
export const rejectionCategory = z2.enum("rejection_category", [
  "skills", "experience", "location", "compensation", "culture", "position_filled", "no_show", "other"]);
export const joinConfirmedBy = z2.enum("join_confirmed_by", ["candidate", "grace", "staff"]);

export const match = z2.table("match", {
  id: uuid("id").primaryKey().defaultRandom(),
  roleId: uuid("role_id").notNull().references(() => role.id),
  candidateId: uuid("candidate_id").notNull().references(() => candidate.userId),
  /** 0–100. */
  fitScore: integer("fit_score").notNull(),
  fitReason: text("fit_reason").notNull().default(""),
  nudgedAt: timestamp("nudged_at", { withTimezone: true }),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  /** Position in the shortlist. Recomputed while the role is `broadcast`, frozen from `shortlist_ready` on; displacement clears it. */
  rank: integer("rank"),
  stage: matchStage("stage").notNull().default("scored"),
  rejectionCategory: rejectionCategory("rejection_category"),
  rejectionNote: text("rejection_note"),
  offeredCtc: bigint("offered_ctc", { mode: "number" }),
  hiredCtc: bigint("hired_ctc", { mode: "number" }),
  joinedOn: date("joined_on"),
  joinPromptSentAt: timestamp("join_prompt_sent_at", { withTimezone: true }),
  joinConfirmedAt: timestamp("join_confirmed_at", { withTimezone: true }),
  joinConfirmedBy: joinConfirmedBy("join_confirmed_by"),
  override: boolean("override").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("match_role_candidate_uq").on(t.roleId, t.candidateId),
  index("match_candidate_idx").on(t.candidateId),
  index("match_role_stage_idx").on(t.roleId, t.stage),
]);

/** Append-only. `from_stage` is null for the event that records the match being scored. */
export const matchEvent = z2.table("match_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Insertion order: applying and being shortlisted happen in the same instant. */
  seq: bigserial("seq", { mode: "number" }).notNull(),
  matchId: uuid("match_id").notNull().references(() => match.id),
  fromStage: matchStage("from_stage"),
  toStage: matchStage("to_stage").notNull(),
  /** A user id, or "system". */
  actor: text("actor").notNull(),
  /** candidate | company | staff | system: who the actor was acting as. Qualifying actions (§4.3) are the company ones. */
  actorKind: text("actor_kind").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("match_event_match_idx").on(t.matchId, t.seq)]);
