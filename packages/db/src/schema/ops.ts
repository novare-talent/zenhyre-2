import { uuid, text, timestamp, jsonb, uniqueIndex, integer, check } from "drizzle-orm/pg-core";
import { z2 } from "./_schema";
import { association, user } from "./identity";
import { sql } from "drizzle-orm";

export const reviewKind = z2.enum("review_kind", ["gate", "verification", "leakage", "join_dispute", "deposit_resolution", "candidate_approval", "alert"]);

export const reviewItem = z2.table("review_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: reviewKind("kind").notNull(),
  refType: text("ref_type").notNull(),
  refId: text("ref_id").notNull(),
  associationId: uuid("association_id").references(() => association.id),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by"),
  resolution: text("resolution"),
}, (t) => [
  // At most one OPEN item per kind+ref; makes openReview's idempotency race-free.
  uniqueIndex("review_item_open_uq").on(t.kind, t.refType, t.refId).where(sql`resolved_at is null`),
]);

export const configValue = z2.table("config_value", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const staffAction = z2.table("staff_action", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id").notNull().references(() => user.id),
  action: text("action").notNull(),
  refType: text("ref_type").notNull(),
  refId: text("ref_id").notNull(),
  note: text("note"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

/** Fixed-window request counters (sign-in link limits). Shared by every API instance, including serverless ones. */
export const rateLimit = z2.table("rate_limit", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
}, () => [check("rate_limit_count_ck", sql`count >= 0`)]);
