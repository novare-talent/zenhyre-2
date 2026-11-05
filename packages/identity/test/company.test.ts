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
const signedIn = async (e: string) => id.redeemMagicLink((await id.issueMagicLink(e, "signin", {})).token);

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
    expect(inv.token).toBeTruthy();
    await expect(id.inviteCompanyUser({ companyId: company.id, invitedBy: userId, email: "x@other.io" })).rejects.toThrow(/domain/i);
    const ov = await id.inviteCompanyUser({ companyId: company.id, invitedBy: userId, email: "x@other.io", staffOverride: true });
    expect(ov.token).toBeTruthy();
    // redeeming the invite creates the membership
    const r = await id.redeemMagicLink(inv.token);
    const m = await id.acceptCompanyInvite(r.userId, r.payload as any);
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
    const r = await id.redeemMagicLink(inv.token);
    const m = await id.acceptAssociationInvite(r.userId, r.payload as any);
    expect(m.associationId).toBe(assoc.id);
    expect((await id.associationsForUser(r.userId)).map((a) => a.id)).toEqual([assoc.id]);
  });
});
