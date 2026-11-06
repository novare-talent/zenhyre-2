import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";
import { Clock, Invalid } from "@zenhyre/shared";

const LINK_TTL_MS = 15 * 60 * 1000;
/** Invites are issued by one person and opened by another, often days later. A sign-in link is asked for and used at once. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export type LinkPurpose = "signin" | "company_invite" | "association_admin_invite";

export function createAuth(db: DbOrTx, clock: Clock) {
  async function findUserByEmail(email: string) {
    const [row] = await db.select().from(schema.userEmail).where(eq(schema.userEmail.email, email));
    return row ?? null;
  }
  return {
    async issueMagicLink(email: string, purpose: LinkPurpose, payload: Record<string, unknown>) {
      const token = randomBytes(32).toString("base64url");
      await db.insert(schema.magicLinkToken).values({
        token, email: email.toLowerCase(), purpose, payload, expiresAt: new Date(clock.now().getTime() + (purpose === "signin" ? LINK_TTL_MS : INVITE_TTL_MS)) });
      return { token };
    },
    /** Marks the token used, upserts the user+email, opens a session. Returns payload for invite purposes. */
    async redeemMagicLink(token: string) {
      const [t] = await db.select().from(schema.magicLinkToken).where(eq(schema.magicLinkToken.token, token));
      if (!t) throw new Invalid("unknown link");
      if (t.usedAt) throw new Invalid("link already used");
      if (t.expiresAt.getTime() < clock.now().getTime()) throw new Invalid("link expired");
      await db.update(schema.magicLinkToken).set({ usedAt: clock.now() }).where(eq(schema.magicLinkToken.token, token));

      let created = false;
      let existing = await findUserByEmail(t.email);
      if (!existing) {
        const [u] = await db.insert(schema.user).values({}).returning();
        const [e] = await db.insert(schema.userEmail).values({ userId: u!.id, email: t.email, verifiedAt: clock.now(), isPrimary: true }).returning();
        existing = e!; created = true;
      } else if (!existing.verifiedAt) {
        await db.update(schema.userEmail).set({ verifiedAt: clock.now() }).where(eq(schema.userEmail.email, t.email));
      }
      const sessionId = randomBytes(32).toString("base64url");
      await db.insert(schema.session).values({ id: sessionId, userId: existing.userId, expiresAt: new Date(clock.now().getTime() + SESSION_TTL_MS) });
      return { userId: existing.userId, email: t.email, sessionId, created, purpose: t.purpose as LinkPurpose, payload: t.payload };
    },
    async addEmail(userId: string, email: string) {
      const taken = await findUserByEmail(email.toLowerCase());
      if (taken && taken.userId !== userId) throw new Invalid("email belongs to another account");
      if (!taken) await db.insert(schema.userEmail).values({ userId, email: email.toLowerCase() });
    },
    async emailsFor(userId: string) {
      return db.select().from(schema.userEmail).where(eq(schema.userEmail.userId, userId));
    },
    async userIdForEmail(email: string): Promise<string | null> {
      const r = await findUserByEmail(email.toLowerCase());
      return r?.userId ?? null;
    },
    async userForSession(sessionId: string) {
      const [s] = await db.select().from(schema.session).where(eq(schema.session.id, sessionId));
      if (!s || s.expiresAt.getTime() < clock.now().getTime()) return null;
      const [u] = await db.select().from(schema.user).where(eq(schema.user.id, s.userId));
      return u ?? null;
    },
    async endSession(sessionId: string) {
      await db.delete(schema.session).where(eq(schema.session.id, sessionId));
    },
  };
}
