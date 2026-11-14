import { and, eq } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";
import { Clock, Invalid, NotFound, Forbidden } from "@zenhyre/shared";
import { createAuth } from "./auth";

const domainOf = (e: string) => e.toLowerCase().split("@")[1] ?? "";

export function createCompanyModule(db: DbOrTx, clock: Clock, opts: { freemailDomains: string[] }) {
  const auth = createAuth(db, clock);
  async function get(id: string) {
    const [row] = await db.select().from(schema.company).where(eq(schema.company.id, id));
    return row ?? null;
  }
  return {
    getCompany: get,
    async createCompany(input: { userId: string; email: string; name: string }) {
      const domain = domainOf(input.email);
      if (opts.freemailDomains.includes(domain)) throw new Invalid("use a work email to register a company");
      const [company] = await db.insert(schema.company).values({ name: input.name, verifiedDomain: domain }).returning();
      const [membership] = await db.insert(schema.companyUser).values({ userId: input.userId, companyId: company!.id, role: "owner" }).returning();
      return { company: company!, membership: membership! };
    },
    async inviteCompanyUser(input: { companyId: string; invitedBy: string; email: string; staffOverride?: boolean }) {
      const c = await get(input.companyId); if (!c) throw new NotFound("company");
      if (!input.staffOverride && domainOf(input.email) !== c.verifiedDomain) throw new Invalid(`invitee must be on the ${c.verifiedDomain} domain`);
      return auth.createInvite({ email: input.email, purpose: "company_invite", payload: { companyId: c.id, invitedBy: input.invitedBy }, invitedBy: input.invitedBy });
    },
    async acceptCompanyInvite(userId: string, payload: { companyId: string; invitedBy: string }) {
      const [row] = await db.insert(schema.companyUser)
        .values({ userId, companyId: payload.companyId, role: "member", invitedBy: payload.invitedBy })
        .onConflictDoNothing().returning();
      if (row) return row;
      const [existing] = await db.select().from(schema.companyUser).where(and(eq(schema.companyUser.userId, userId), eq(schema.companyUser.companyId, payload.companyId)));
      return existing!;
    },
    async listCompanyUsers(companyId: string) {
      return db.select().from(schema.companyUser).where(eq(schema.companyUser.companyId, companyId));
    },
    async membershipFor(userId: string) {
      const [row] = await db.select().from(schema.companyUser).where(eq(schema.companyUser.userId, userId));
      return row ?? null;
    },
    async requireActiveMember(userId: string, companyId: string) {
      const [m] = await db.select().from(schema.companyUser).where(and(eq(schema.companyUser.userId, userId), eq(schema.companyUser.companyId, companyId)));
      if (!m || m.lockedAt) throw new Forbidden();
      return m;
    },
    async lockCompanyUsers(companyId: string) {
      await db.update(schema.companyUser).set({ lockedAt: clock.now() }).where(eq(schema.companyUser.companyId, companyId));
    },
    async setCompanyStatus(companyId: string, status: "active" | "probation" | "banned") {
      await db.update(schema.company).set({ status, statusChangedAt: clock.now() }).where(eq(schema.company.id, companyId));
    },
    /** Moves users (and, once the roles module exists, roles) to the survivor and deletes the absorbed company. */
    async mergeCompanies(input: { survivorId: string; absorbedId: string }) {
      const users = await db.select().from(schema.companyUser).where(eq(schema.companyUser.companyId, input.absorbedId));
      for (const u of users) {
        // Locks belong to the absorbed company's history; the survivor's status governs from here.
        await db.insert(schema.companyUser).values({ ...u, companyId: input.survivorId, role: "member", lockedAt: null }).onConflictDoNothing();
      }
      await db.delete(schema.companyUser).where(eq(schema.companyUser.companyId, input.absorbedId));
      await db.delete(schema.company).where(eq(schema.company.id, input.absorbedId));
    },
  };
}
