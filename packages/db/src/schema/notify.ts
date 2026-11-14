import { uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { z2 } from "./_schema";
export const notifyChannel = z2.enum("notify_channel", ["email", "in_app"]);
export const notification = z2.table("notification", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  template: text("template").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  channel: notifyChannel("channel").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  bounceReason: text("bounce_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("notification_user_idx").on(t.userId, t.channel, t.createdAt)]);
