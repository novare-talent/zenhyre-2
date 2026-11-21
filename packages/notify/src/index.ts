import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";
import { TEMPLATES, TemplateName } from "./templates";
import { Attachment, Transport } from "./transport";
export * from "./transport";
export * from "./templates";

export interface SendResult { email: "sent" | "skipped" | "undeliverable"; inApp: boolean }

/**
 * Bounce policy (interpretation of §11 chosen for v1): one hard bounce disqualifies an address;
 * when every verified address on the account is disqualified, send() returns "undeliverable"
 * and the caller opens an `alert` ReviewItem.
 */
function buildNotify(db: DbOrTx, transport: Transport) {
  async function deliverableEmail(userId: string): Promise<string | null> {
    const rows = await db.select().from(schema.userEmail)
      .where(and(eq(schema.userEmail.userId, userId), isNotNull(schema.userEmail.verifiedAt), lt(schema.userEmail.bounceCount, 1)))
      .orderBy(asc(schema.userEmail.email));
    const pick = rows.find((r) => r.isPrimary) ?? rows[0];
    return pick?.email ?? null;
  }

  return {
    /** For recipients who may not have a user yet (magic links, invites). Email-only; no notification row. */
    async sendToEmail(email: string, template: TemplateName, data: Record<string, unknown>, opts: { attachments?: Attachment[] } = {}) {
      const t = TEMPLATES[template];
      await transport.send({ to: email.toLowerCase(), subject: t.subject(data), text: t.text(data), attachments: opts.attachments });
    },
    async hasDeliverableEmail(userId: string) { return (await deliverableEmail(userId)) !== null; },
    /** Whether this template already went to the user with `data[key] === value` (for jobs that must not repeat). */
    async alreadySent(userId: string, template: TemplateName, key: string, value: string | number) {
      const [row] = await db.select({ id: schema.notification.id }).from(schema.notification)
        .where(and(eq(schema.notification.userId, userId), eq(schema.notification.template, template),
          sql`${schema.notification.data}->>${key} = ${String(value)}`)).limit(1);
      return !!row;
    },
    /** The in-app feed (§11): newest first, with the subject line each template renders. */
    async listInApp(userId: string, opts: { limit?: number; unreadOnly?: boolean } = {}) {
      const conds = [eq(schema.notification.userId, userId), eq(schema.notification.channel, "in_app")];
      if (opts.unreadOnly) conds.push(isNull(schema.notification.readAt));
      const rows = await db.select().from(schema.notification).where(and(...conds))
        .orderBy(desc(schema.notification.createdAt)).limit(Math.min(opts.limit ?? 50, 200));
      const [unread] = await db.select({ n: count() }).from(schema.notification)
        .where(and(eq(schema.notification.userId, userId), eq(schema.notification.channel, "in_app"), isNull(schema.notification.readAt)));
      return {
        unread: Number(unread?.n ?? 0),
        items: rows.map((r) => {
          const t = TEMPLATES[r.template as TemplateName];
          return { id: r.id, template: r.template, title: t ? t.subject(r.data) : r.template, data: r.data, createdAt: r.createdAt, readAt: r.readAt };
        }),
      };
    },
    /** Marks the given in-app notifications read (or all of them), only ever the caller's own. */
    async markRead(userId: string, ids?: string[]) {
      const conds = [eq(schema.notification.userId, userId), eq(schema.notification.channel, "in_app"), isNull(schema.notification.readAt)];
      if (ids) { if (!ids.length) return 0; conds.push(inArray(schema.notification.id, ids)); }
      const rows = await db.update(schema.notification).set({ readAt: new Date() }).where(and(...conds)).returning({ id: schema.notification.id });
      return rows.length;
    },
    async send(userId: string, template: TemplateName, data: Record<string, unknown>, opts: { attachments?: Attachment[] } = {}): Promise<SendResult> {
      const t = TEMPLATES[template];
      const result: SendResult = { email: "skipped", inApp: false };
      if (t.channels.includes("in_app")) {
        await db.insert(schema.notification).values({ userId, template, data, channel: "in_app", sentAt: new Date() });
        result.inApp = true;
      }
      if (t.channels.includes("email")) {
        const to = await deliverableEmail(userId);
        if (!to) {
          await db.insert(schema.notification).values({ userId, template, data, channel: "email", bounceReason: "no deliverable email" });
          result.email = "undeliverable";
        } else {
          await transport.send({ to, subject: t.subject(data), text: t.text(data), attachments: opts.attachments });
          await db.insert(schema.notification).values({ userId, template, data, channel: "email", sentAt: new Date() });
          result.email = "sent";
        }
      }
      return result;
    },
    /** Atomic increment; a no-op for addresses we don't know. The reason is recorded on the last email notification row for that user, if any. */
    async recordBounce(email: string, reason: string) {
      const [row] = await db.update(schema.userEmail)
        .set({ bounceCount: sql`${schema.userEmail.bounceCount} + 1` })
        .where(eq(schema.userEmail.email, email.toLowerCase())).returning();
      if (row) {
        await db.execute(sql`update notification set bounce_reason = ${reason}
          where id = (select id from notification where user_id = ${row.userId} and channel = 'email' order by created_at desc limit 1)`);
      }
    },
  };
}
export type Notify = ReturnType<typeof buildNotify> & { withDb(tx: DbOrTx): Notify };
export function createNotify(db: DbOrTx, transport: Transport): Notify {
  return { ...buildNotify(db, transport), withDb: (tx) => createNotify(tx, transport) };
}
