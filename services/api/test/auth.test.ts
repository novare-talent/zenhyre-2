import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testApp } from "./helpers";

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => (t = await testApp()));
afterAll(() => t.close());

describe("auth", () => {
  it("emails a magic link, redeems it, sets a session cookie, and /me works", async () => {
    const { cookie, json } = await t.signIn("x@gmail.com");
    expect(json.created).toBe(true);
    const me = await t.as(cookie)("/me");
    expect(me.status).toBe(200);
    expect((await me.json() as any).user.id).toBe(json.userId);
  });
  it("/me returns the signed-in email and never the campus tier", async () => {
    const { cookie } = await t.signIn("who@startup.io");
    const me = await (await t.as(cookie)("/me")).json() as any;
    expect(me.emails).toEqual([{ email: "who@startup.io", isPrimary: true, verified: true }]);
    expect(me.candidate).toBeNull();
    expect(me.campus).toBeNull();
    expect(me.company).toBeNull();
    expect(JSON.stringify(me)).not.toContain("internalTier");
  });
  it("rejects /me without a session", async () => {
    expect((await t.app.request("/me")).status).toBe(401);
  });
});
