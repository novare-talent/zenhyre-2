import { eq, isNull } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";
import { Clock } from "@zenhyre/shared";
import { createAuth } from "./auth";

export function createAssociationModule(db: DbOrTx, clock: Clock) {
  const auth = createAuth(db, clock);
  return {
    async createAssociation(input: { campusId: string; name: string; shareRate: number; payoutMode: "cash" | "sponsorship_credit"; contacts?: Record<string, unknown> }) {
      const [row] = await db.insert(schema.association)
        .values({ campusId: input.campusId, name: input.name, shareRate: input.shareRate.toFixed(4), payoutMode: input.payoutMode, contacts: input.contacts ?? {} }).returning();
      return row!;
    },
    async associationForCampus(campusId: string) {
      const [row] = await db.select().from(schema.association).where(eq(schema.association.campusId, campusId));
      return row ?? null;
    },
    async inviteAssociationAdmin(input: { associationId: string; invitedBy: string; email: string }) {
      return auth.issueMagicLink(input.email, "association_admin_invite", { associationId: input.associationId, invitedBy: input.invitedBy });
    },
    async acceptAssociationInvite(userId: string, payload: { associationId: string; invitedBy: string }) {
      const [row] = await db.insert(schema.associationAdmin)
        .values({ userId, associationId: payload.associationId, invitedBy: payload.invitedBy }).onConflictDoNothing().returning();
      return row ?? { userId, associationId: payload.associationId, invitedBy: payload.invitedBy, joinedAt: clock.now() };
    },
    async associationsForUser(userId: string) {
      const rows = await db.select({ a: schema.association }).from(schema.associationAdmin)
        .innerJoin(schema.association, eq(schema.association.id, schema.associationAdmin.associationId))
        .where(eq(schema.associationAdmin.userId, userId));
      return rows.map((r) => r.a);
    },
    /** §6.2: staff may resolve these associations' verification items without waiting for the escape hatch. */
    async associationIdsWithoutAdmins() {
      const rows = await db.select({ id: schema.association.id }).from(schema.association)
        .leftJoin(schema.associationAdmin, eq(schema.associationAdmin.associationId, schema.association.id))
        .where(isNull(schema.associationAdmin.userId));
      return rows.map((r) => r.id);
    },
  };
}
