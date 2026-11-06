import { testDb } from "@zenhyre/db/test";
import { mutableClock } from "@zenhyre/shared";
import { MemoryTransport } from "@zenhyre/notify";
import { buildApp } from "../src/app";
import type { AppConfig } from "../src/context";

/** A fresh database and app per test file. The clock is fixed at `iso` and can be moved with `clock.set` / `clock.advance`. */
export async function testApp(iso = "2026-11-05T10:00:00Z", extra: Partial<Pick<AppConfig, "gateModel" | "scorer" | "jobs">> = {}) {
  const { db, close } = await testDb();
  const transport = new MemoryTransport();
  const clock = mutableClock(iso);
  const app = await buildApp({ db, clock, transport, baseUrl: "http://test", ...extra });
  const lastLink = () => transport.sent.at(-1)!.text.match(/https?:\/\/\S+/)![0];
  async function signIn(email: string) {
    await app.request("/auth/magic-link", { method: "POST", body: JSON.stringify({ email }), headers: { "content-type": "application/json" } });
    const url = new URL(lastLink());
    const res = await app.request(url.pathname + url.search);
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    return { cookie, json: await res.json() as any };
  }
  const as = (cookie: string) => (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), cookie, "content-type": "application/json" } });
  return { app, db, close, transport, clock, signIn, as };
}
