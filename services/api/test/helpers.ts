import { testDb } from "@zenhyre/db/test";
import { mutableClock } from "@zenhyre/shared";
import { MemoryTransport } from "@zenhyre/notify";
import { buildApp } from "../src/app";
import type { AppConfig } from "../src/context";
import { fakeAuth } from "../src/auth/fakeAuth";

/** A fresh database and app per test file. The clock is fixed at `iso` and can be moved with `clock.set` / `clock.advance`. */
export async function testApp(iso = "2026-11-05T10:00:00Z", extra: Partial<Pick<AppConfig, "gateModel" | "scorer" | "jobs" | "linkLimits" | "gateway">> & { accessTtlMs?: number } = {}) {
  const { db, url, close } = await testDb();
  const transport = new MemoryTransport();
  const clock = mutableClock(iso);
  // Scenario tests move the clock by days; the web app would refresh tokens meanwhile. Expiry itself is tested in auth.test.ts.
  const { accessTtlMs = 10 * 365 * 24 * 3600 * 1000, ...cfgExtra } = extra;
  const auth = fakeAuth(clock, { accessTtlMs });
  // Tests sign the same people in many times on a frozen clock; the link limits get their own test in auth.test.ts.
  const app = await buildApp({ db, clock, transport, baseUrl: "http://test", auth, linkLimits: { perEmail: 1e6, perIp: 1e6 }, ...cfgExtra });
  const lastLink = () => transport.sent.at(-1)!.text.match(/https?:\/\/\S+/)![0];
  async function signIn(email: string) {
    await app.request("/auth/magic-link", { method: "POST", body: JSON.stringify({ email }), headers: { "content-type": "application/json" } });
    const t = new URL(lastLink()).searchParams.get("t")!;
    const res = await app.request("/auth/redeem", { method: "POST", body: JSON.stringify({ t }), headers: { "content-type": "application/json" } });
    const json = await res.json() as any;
    // The web app keeps the access token in the zh_session cookie and forwards it; the API accepts it there.
    return { cookie: `zh_session=${json.session.accessToken}`, json };
  }
  const as = (cookie: string) => (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), cookie, "content-type": "application/json" } });
  return { app, db, url, close, transport, clock, auth, signIn, as };
}
