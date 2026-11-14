import { and, eq, gt, isNull } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";
import { Clock, Invalid } from "@zenhyre/shared";

/**
 * Sign-in is Supabase Auth (magic links). This module keeps Zenhyre's own view of a user in step with it:
 * `user.id` is the Supabase `auth.users.id`, and every address a person signs in with is a `user_email` row.
 *
 * Invitations to a company or an association are rows in `invite`, accepted the first time someone signs in
 * with the invited address (the API applies the one-email-one-role rule before accepting).
 */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Staff-issued association access is a standing grant, not a time-boxed teammate invite. */
const GRANT_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export type InvitePurpose = "company_invite" | "association_admin_invite";
export type LinkPurpose = "signin" | InvitePurpose;

export function createAuth(db: DbOrTx, clock: Clock) {
  async function findUserByEmail(email: string) {
    const [row] = await db.select().from(schema.userEmail).where(eq(schema.userEmail.email, email.toLowerCase()));
    return row ?? null;
  }
  return {
    /**
     * Called with the claims of a verified Supabase access token. Creates the Zenhyre user on first sight,
     * records the address as verified, and returns the user. An address already held by another account is refused.
     */
    async ensureUser(input: { id: string; email: string }) {
      const email = input.email.toLowerCase();
      let created = false;
      let [u] = await db.select().from(schema.user).where(eq(schema.user.id, input.id));
      if (!u) {
        [u] = await db.insert(schema.user).values({ id: input.id }).onConflictDoNothing().returning();
        if (u) created = true;
        else [u] = await db.select().from(schema.user).where(eq(schema.user.id, input.id));
      }
      const held = await findUserByEmail(email);
      if (held && held.userId !== input.id) throw new Invalid("email belongs to another account");
      if (!held) {
        const others = await db.select().from(schema.userEmail).where(eq(schema.userEmail.userId, input.id));
        await db.insert(schema.userEmail).values({ userId: input.id, email, verifiedAt: clock.now(), isPrimary: others.length === 0 })
          .onConflictDoNothing();
      } else if (!held.verifiedAt) {
        await db.update(schema.userEmail).set({ verifiedAt: clock.now() }).where(eq(schema.userEmail.email, email));
      }
      return { user: u!, created };
    },
    async getUser(userId: string) {
      const [u] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
      return u ?? null;
    },
    async createInvite(input: { email: string; purpose: InvitePurpose; payload: Record<string, unknown>; invitedBy: string | null; ttlMs?: number }) {
      const [row] = await db.insert(schema.invite).values({
        email: input.email.toLowerCase(), purpose: input.purpose, payload: input.payload, invitedBy: input.invitedBy,
        expiresAt: new Date(clock.now().getTime() + (input.ttlMs ?? INVITE_TTL_MS)),
      }).returning();
      return row!;
    },
    /** Open, unexpired invites for any of a user's addresses, oldest first. */
    async pendingInvitesFor(emails: string[]) {
      const now = clock.now();
      const rows = [];
      for (const email of emails) {
        rows.push(...await db.select().from(schema.invite)
          .where(and(eq(schema.invite.email, email.toLowerCase()), isNull(schema.invite.acceptedAt), gt(schema.invite.expiresAt, now))));
      }
      return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
    async markInviteAccepted(inviteId: string) {
      await db.update(schema.invite).set({ acceptedAt: clock.now() }).where(eq(schema.invite.id, inviteId));
    },
    async addEmail(userId: string, email: string) {
      const taken = await findUserByEmail(email);
      if (taken && taken.userId !== userId) throw new Invalid("email belongs to another account");
      if (!taken) await db.insert(schema.userEmail).values({ userId, email: email.toLowerCase() });
    },
    async emailsFor(userId: string) {
      return db.select().from(schema.userEmail).where(eq(schema.userEmail.userId, userId));
    },
    async userIdForEmail(email: string): Promise<string | null> {
      const r = await findUserByEmail(email);
      return r?.userId ?? null;
    },
  };
}

export { GRANT_TTL_MS };
