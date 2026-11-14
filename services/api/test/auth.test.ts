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

describe("sign-in through the auth provider (Supabase in production)", () => {
  let u: Awaited<ReturnType<typeof testApp>>;
  beforeAll(async () => (u = await testApp("2026-11-05T10:00:00Z", { accessTtlMs: 60 * 60 * 1000, linkLimits: { perEmail: 3, perIp: 5 } })));
  afterAll(() => u.close());
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    u.app.request(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
  const linkFor = async (email: string, ip = "1.1.1.1") => {
    expect((await post("/auth/magic-link", { email }, { "x-zh-client-ip": ip })).status).toBe(200);
    return new URL(u.transport.sent.at(-1)!.text.match(/https?:\/\/\S+/)![0]).searchParams.get("t")!;
  };

  it("stores the user under the provider's id, and a link works once", async () => {
    const t1 = await linkFor("one@gmail.com");
    const r = await post("/auth/redeem", { t: t1 });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.userId).toBe(u.auth.userIdFor("one@gmail.com"));
    expect(j.purpose).toBe("signin");
    expect((await post("/auth/redeem", { t: t1 })).status).toBe(400);
  });
  it("accepts the access token as a bearer header or the zh_session cookie", async () => {
    const j = await (await post("/auth/redeem", { t: await linkFor("two@gmail.com") })).json() as any;
    expect((await u.app.request("/me", { headers: { authorization: `Bearer ${j.session.accessToken}` } })).status).toBe(200);
    expect((await u.app.request("/me", { headers: { cookie: `zh_session=${j.session.accessToken}` } })).status).toBe(200);
    expect((await u.app.request("/me", { headers: { authorization: "Bearer nonsense" } })).status).toBe(401);
  });
  it("expires access tokens after an hour; the refresh token gets a new one, once", async () => {
    const j = await (await post("/auth/redeem", { t: await linkFor("three@gmail.com") })).json() as any;
    u.clock.advance(61 * 60 * 1000);
    expect((await u.app.request("/me", { headers: { authorization: `Bearer ${j.session.accessToken}` } })).status).toBe(401);
    const r = await post("/auth/refresh", { refreshToken: j.session.refreshToken });
    expect(r.status).toBe(200);
    const fresh = (await r.json() as any).session;
    expect((await u.app.request("/me", { headers: { authorization: `Bearer ${fresh.accessToken}` } })).status).toBe(200);
    expect((await post("/auth/refresh", { refreshToken: j.session.refreshToken })).status).toBe(401);
  });
  it("signs out: the token stops working", async () => {
    const j = await (await post("/auth/redeem", { t: await linkFor("four@gmail.com") })).json() as any;
    const bearer = { authorization: `Bearer ${j.session.accessToken}` };
    expect((await post("/auth/signout", {}, bearer)).status).toBe(200);
    expect((await u.app.request("/me", { headers: bearer })).status).toBe(401);
    expect((await post("/auth/refresh", { refreshToken: j.session.refreshToken })).status).toBe(401);
  });
  it("rate-limits sign-in links per address and per client IP", async () => {
    for (let i = 0; i < 3; i++) await linkFor("spam@gmail.com", "9.9.9.9");
    expect((await post("/auth/magic-link", { email: "spam@gmail.com" }, { "x-zh-client-ip": "8.8.8.8" })).status).toBe(429);
    await linkFor("other1@gmail.com", "9.9.9.9"); await linkFor("other2@gmail.com", "9.9.9.9");
    expect((await post("/auth/magic-link", { email: "other3@gmail.com" }, { "x-zh-client-ip": "9.9.9.9" })).status).toBe(429);
    u.clock.advance(15 * 60 * 1000);
    expect((await post("/auth/magic-link", { email: "spam@gmail.com" }, { "x-zh-client-ip": "9.9.9.9" })).status).toBe(200);
  });
});
