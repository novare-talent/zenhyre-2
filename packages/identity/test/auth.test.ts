import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "@zenhyre/db/test";
import { fixedClock } from "@zenhyre/shared";
import { createIdentity } from "../src/index";

let db: any, close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(() => close());

describe("ensureUser (a verified Supabase sign-in)", () => {
  it("creates the user with the auth id and a verified primary email, once", async () => {
    const id = createIdentity(db, { clock: fixedClock("2026-11-05T10:00:00Z") });
    const sub = randomUUID();
    const first = await id.ensureUser({ id: sub, email: "New@Gmail.com" });
    expect(first.created).toBe(true);
    expect(first.user.id).toBe(sub);
    const emails = await id.emailsFor(sub);
    expect(emails).toMatchObject([{ email: "new@gmail.com", isPrimary: true }]);
    expect(emails[0]!.verifiedAt).not.toBeNull();
    const again = await id.ensureUser({ id: sub, email: "new@gmail.com" });
    expect(again.created).toBe(false);
    expect(await id.emailsFor(sub)).toHaveLength(1);
  });
  it("adds a second address to the same account as a non-primary email and verifies a pending one", async () => {
    const id = createIdentity(db, { clock: fixedClock("2026-11-05T10:00:00Z") });
    const sub = randomUUID();
    await id.ensureUser({ id: sub, email: "a@iitb.ac.in" });
    await id.addEmail(sub, "a.personal@gmail.com");
    expect((await id.emailsFor(sub)).find((e) => e.email === "a.personal@gmail.com")!.verifiedAt).toBeNull();
    await id.ensureUser({ id: sub, email: "a.personal@gmail.com" });
    const rows = await id.emailsFor(sub);
    expect(rows.find((e) => e.email === "a.personal@gmail.com")).toMatchObject({ isPrimary: false });
    expect(rows.find((e) => e.email === "a.personal@gmail.com")!.verifiedAt).not.toBeNull();
    expect(await id.userIdForEmail("A.Personal@gmail.com")).toBe(sub);
  });
  it("refuses an address that belongs to another account", async () => {
    const id = createIdentity(db, { clock: fixedClock("2026-11-05T10:00:00Z") });
    await id.ensureUser({ id: randomUUID(), email: "taken@gmail.com" });
    await expect(id.ensureUser({ id: randomUUID(), email: "taken@gmail.com" })).rejects.toThrow(/another account/);
  });
});

describe("invites", () => {
  it("are open for 7 days, for the invited address only, until accepted", async () => {
    const id = createIdentity(db, { clock: fixedClock("2026-11-05T10:00:00Z") });
    const inv = await id.createInvite({ email: "Invited@Alumni.org", purpose: "association_admin_invite", payload: { x: 1 }, invitedBy: null });
    const sixDays = createIdentity(db, { clock: fixedClock("2026-11-11T09:00:00Z") });
    expect((await sixDays.pendingInvitesFor(["invited@alumni.org"])).map((i) => i.id)).toEqual([inv.id]);
    expect(await sixDays.pendingInvitesFor(["someone@alumni.org"])).toEqual([]);
    const eightDays = createIdentity(db, { clock: fixedClock("2026-11-13T11:00:00Z") });
    expect(await eightDays.pendingInvitesFor(["invited@alumni.org"])).toEqual([]);
    await sixDays.markInviteAccepted(inv.id);
    expect(await sixDays.pendingInvitesFor(["invited@alumni.org"])).toEqual([]);
  });
});
