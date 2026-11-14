import { uuid, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { z2 } from "./_schema";
import { sql } from "drizzle-orm";

export const reviewKind = z2.enum("review_kind", ["gate", "verification", "leakage", "join_dispute", "deposit_resolution", "candidate_approval", "alert"]);

export const reviewItem = z2.table("review_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: reviewKind("kind").notNull(),
  refType: text("ref_type").notNull(),
  refId: text("ref_id").notNull(),
  associationId: uuid("association_id"),
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
  actorUserId: uuid("actor_user_id").notNull(),
  action: text("action").notNull(),
  refType: text("ref_type").notNull(),
  refId: text("ref_id").notNull(),
  note: text("note"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});
