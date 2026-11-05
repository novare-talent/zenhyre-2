import { pgTable, uuid, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
export const notifyChannel = pgEnum("notify_channel", ["email", "in_app"]);
export const notification = pgTable("notification", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  template: text("template").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  channel: notifyChannel("channel").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  bounceReason: text("bounce_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
