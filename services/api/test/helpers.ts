import { testDb } from "@zenhyre/db/test";
import { fixedClock } from "@zenhyre/shared";
import { MemoryTransport } from "@zenhyre/notify";
import { buildApp } from "../src/app";

export async function testApp(iso = "2026-11-05T10:00:00Z") {
  const { db, close } = await testDb();
  const transport = new MemoryTransport();
  const app = await buildApp({ db, clock: fixedClock(iso), transport, baseUrl: "http://test" });
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
  return { app, db, close, transport, signIn, as };
}
