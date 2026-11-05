import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "@zenhyre/db/test";
import { fixedClock } from "@zenhyre/shared";
import { createIdentity } from "../src/index";

let db: any, close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(() => close());

describe("magic links", () => {
  it("issues a token, redeems it once, creates user + verified email + session", async () => {
    const clock = fixedClock("2026-11-05T10:00:00Z");
    const id = createIdentity(db, { clock });
    const { token } = await id.issueMagicLink("new@gmail.com", "signin", {});
    const r = await id.redeemMagicLink(token);
    expect(r.userId).toBeTruthy();
    expect(r.sessionId).toBeTruthy();
    expect(r.created).toBe(true);
    await expect(id.redeemMagicLink(token)).rejects.toThrow(/used|expired/i);
  });
  it("rejects an expired token", async () => {
    const id = createIdentity(db, { clock: fixedClock("2026-11-05T10:00:00Z") });
    const { token } = await id.issueMagicLink("late@gmail.com", "signin", {});
    const later = createIdentity(db, { clock: fixedClock("2026-11-05T10:16:00Z") });
    await expect(later.redeemMagicLink(token)).rejects.toThrow(/expired/i);
  });
  it("signs an existing user in via a second email on the same account", async () => {
    const id = createIdentity(db, { clock: fixedClock("2026-11-05T10:00:00Z") });
    const first = await id.redeemMagicLink((await id.issueMagicLink("a@iitb.ac.in", "signin", {})).token);
    await id.addEmail(first.userId, "a.personal@gmail.com");
    const second = await id.redeemMagicLink((await id.issueMagicLink("a.personal@gmail.com", "signin", {})).token);
    expect(second.userId).toBe(first.userId);
    expect(second.created).toBe(false);
  });
  it("resolves a session to its user until expiry", async () => {
    const id = createIdentity(db, { clock: fixedClock("2026-11-05T10:00:00Z") });
    const { sessionId, userId } = await id.redeemMagicLink((await id.issueMagicLink("s@gmail.com", "signin", {})).token);
    expect((await id.userForSession(sessionId))?.id).toBe(userId);
    const after = createIdentity(db, { clock: fixedClock("2026-12-20T10:00:00Z") });
    expect(await after.userForSession(sessionId)).toBeNull();
  });
});
