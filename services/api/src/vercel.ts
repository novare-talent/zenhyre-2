// Vercel entry: the Build Output (scripts/build-vercel.mjs) bundles this into one function that every path routes to.
// Jobs run inline (role jobs right after the request's commit); Vercel Cron calls /cron/hourly and /cron/nightly.
import { Hono } from "hono";
import { handle } from "@hono/node-server/vercel";
import { buildApp } from "./app";
import { buildDeps } from "./context";
import { configFromEnv } from "./config";

let ready: Promise<{ fetch: (req: Request) => Response | Promise<Response> }> | undefined;
function app() {
  ready ??= (async () => {
    const cfg = configFromEnv();
    return buildApp(cfg, await buildDeps(cfg));
  })().catch((e) => { ready = undefined; throw e; }); // a failed cold start is retried by the next request
  return ready;
}

const outer = new Hono();
outer.all("*", async (c) => (await app()).fetch(c.req.raw));

export const config = { api: { bodyParser: false } };
export default handle(outer);
