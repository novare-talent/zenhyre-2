import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "@zenhyre/db/test";
import { fixedClock } from "@zenhyre/shared";
import { createIdentity } from "../src/index";

let db: any, close: () => Promise<void>, id: ReturnType<typeof createIdentity>;
const FREEMAIL = ["gmail.com", "yahoo.com"];
beforeAll(async () => {
  ({ db, close } = await testDb());
  id = createIdentity(db, { clock: fixedClock("2026-11-05T10:00:00Z"), freemailDomains: FREEMAIL });
});
afterAll(() => close());
/** Stands in for a Supabase sign-in: the same address always maps to the same auth user id. */
const signedIn = async (e: string) => {
  const r = await id.ensureUser({ id: (await id.userIdForEmail(e)) ?? randomUUID(), email: e });
  return { userId: r.user.id };
};

describe("company", () => {
  it("creates a company from a work email; first user is owner; domain is verified_domain", async () => {
    const { userId } = await signedIn("founder@lab0.ai");
    const { company, membership } = await id.createCompany({ userId, email: "founder@lab0.ai", name: "Lab0" });
    expect(company.verifiedDomain).toBe("lab0.ai");
    expect(membership.role).toBe("owner");
  });
  it("refuses free-mail domains", async () => {
    const { userId } = await signedIn("someone@gmail.com");
    await expect(id.createCompany({ userId, email: "someone@gmail.com", name: "X" })).rejects.toThrow(/work email/i);
  });
  it("invites a member on the same domain and refuses other domains unless staff override", async () => {
    const { userId } = await signedIn("own@acme.io");
    const { company } = await id.createCompany({ userId, email: "own@acme.io", name: "Acme" });
    const inv = await id.inviteCompanyUser({ companyId: company.id, invitedBy: userId, email: "eng@acme.io" });
    expect(inv).toMatchObject({ email: "eng@acme.io", purpose: "company_invite", payload: { companyId: company.id, invitedBy: userId } });
    await expect(id.inviteCompanyUser({ companyId: company.id, invitedBy: userId, email: "x@other.io" })).rejects.toThrow(/domain/i);
    const ov = await id.inviteCompanyUser({ companyId: company.id, invitedBy: userId, email: "x@other.io", staffOverride: true });
    expect(ov.email).toBe("x@other.io");
    // the invitee signs in; accepting the invite creates the membership
    const r = await signedIn("eng@acme.io");
    const m = await id.acceptCompanyInvite(r.userId, inv.payload as any);
    expect(m.role).toBe("member");
    expect(m.companyId).toBe(company.id);
  });
  it("locks users and merges companies", async () => {
    const a = await signedIn("a@one.io"); const ca = (await id.createCompany({ userId: a.userId, email: "a@one.io", name: "One" })).company;
    const b = await signedIn("b@one-dup.io"); const cb = (await id.createCompany({ userId: b.userId, email: "b@one-dup.io", name: "One (dup)" })).company;
    await id.lockCompanyUsers(cb.id);
    expect((await id.listCompanyUsers(cb.id))[0]!.lockedAt).not.toBeNull();
    await id.mergeCompanies({ survivorId: ca.id, absorbedId: cb.id });
    expect((await id.listCompanyUsers(ca.id)).map((u) => u.userId).sort()).toEqual([a.userId, b.userId].sort());
    expect(await id.getCompany(cb.id)).toBeNull();
  });
});

describe("association", () => {
  it("creates an association for a campus and invites an admin", async () => {
    const staff = await signedIn("ops@novaretalent.com");
    await id.seedCampuses([{ name: "IIT Hyderabad", shortCode: "IITH", emailDomains: ["iith.ac.in"], rollNumberRegex: null, internalTier: 2 }]);
    const campusId = (await id.campusByShortCode("IITH"))!.id;
    const assoc = await id.createAssociation({ campusId, name: "IITHAA", shareRate: 0.15, payoutMode: "sponsorship_credit" });
    const inv = await id.inviteAssociationAdmin({ associationId: assoc.id, invitedBy: staff.userId, email: "admin@iithaa.org" });
    const r = await signedIn("admin@iithaa.org");
    const m = await id.acceptAssociationInvite(r.userId, inv.payload as any);
    expect(m.associationId).toBe(assoc.id);
    expect((await id.associationsForUser(r.userId)).map((a) => a.id)).toEqual([assoc.id]);
  });
  it("lists associations that have no admins yet; a pending invite does not count", async () => {
    const staff = await signedIn("ops2@novaretalent.com");
    await id.seedCampuses([{ name: "IIT Indore", shortCode: "IITI", emailDomains: ["iiti.ac.in"], rollNumberRegex: null, internalTier: 2 }]);
    const campusId = (await id.campusByShortCode("IITI"))!.id;
    const assoc = await id.createAssociation({ campusId, name: "IITIAA", shareRate: 0.15, payoutMode: "cash" });
    expect(await id.associationIdsWithoutAdmins()).toEqual([assoc.id]);
    const inv = await id.inviteAssociationAdmin({ associationId: assoc.id, invitedBy: staff.userId, email: "admin@iitiaa.org" });
    expect(await id.associationIdsWithoutAdmins()).toEqual([assoc.id]);
    const r = await signedIn("admin@iitiaa.org");
    await id.acceptAssociationInvite(r.userId, inv.payload as any);
    expect(await id.associationIdsWithoutAdmins()).toEqual([]);
  });
  it("grants staff-issued access at once to an existing account, or as a standing invite to a new address", async () => {
    const staff = await signedIn("ops3@novaretalent.com");
    await id.seedCampuses([{ name: "IIT Patna", shortCode: "IITP", emailDomains: ["iitp.ac.in"], rollNumberRegex: null, internalTier: 3 }]);
    const assoc = await id.createAssociation({ campusId: (await id.campusByShortCode("IITP"))!.id, name: "IITPAA", shareRate: 0.15, payoutMode: "cash" });
    const known = await signedIn("known@iitpaa.org");
    expect(await id.grantAssociationAdmin({ associationId: assoc.id, invitedBy: staff.userId, email: "known@iitpaa.org" })).toEqual({ userId: known.userId, pending: false });
    expect((await id.associationsForUser(known.userId)).map((a) => a.id)).toEqual([assoc.id]);
    expect(await id.grantAssociationAdmin({ associationId: assoc.id, invitedBy: staff.userId, email: "New@iitpaa.org" })).toEqual({ userId: null, pending: true });
    const later = createIdentity(db, { clock: fixedClock("2027-06-01T00:00:00Z") });
    expect(await later.pendingInvitesFor(["new@iitpaa.org"])).toMatchObject([{ purpose: "association_admin_invite", payload: { associationId: assoc.id } }]);
  });
});
