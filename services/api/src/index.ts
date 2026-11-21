import { serve } from "@hono/node-server";
import { buildApp } from "./app";
import { buildDeps } from "./context";
import { startScheduler } from "./scheduler";
import { configFromEnv } from "./config";
import { startPgBoss } from "./pgboss";
import { listen } from "@zenhyre/db";
import { processSettlement, reconcilePayments } from "./workflows/payments";

const cfg = configFromEnv();
const deps = await buildDeps(cfg);
const app = await buildApp(cfg, deps);
// Background jobs (§3.2): pg-boss by default. JOB_RUNNER=inline runs role jobs inside the request and the §18 jobs on
// the old in-process timer (one API instance only). SCHEDULER=off leaves scheduled jobs to POST /admin/jobs/:name/run.
let stopJobs: () => Promise<unknown> = async () => {};
if (process.env.JOB_RUNNER === "inline") {
  if (process.env.SCHEDULER !== "off") { startScheduler(deps); console.log("jobs: inline, scheduled jobs on the in-process timer"); }
} else {
  const pb = await startPgBoss(deps, process.env.PGBOSS_DATABASE_URL ?? process.env.DATABASE_URL!, { schedules: process.env.SCHEDULER !== "off" });
  deps.jobs = pb.queue;
  stopJobs = pb.stop;
  console.log(`jobs: pg-boss${process.env.SCHEDULER === "off" ? " (schedules off)" : ", hourly and nightly schedules (UTC)"}`);
}
// Payments: a settlement queued by any path (rule, finance console, or `request_deposit_settlement()` in SQL) wakes
// the worker through NOTIFY; a one-minute sweep is the backstop and also checks open checkouts and refunds in flight.
let stopListen: () => Promise<unknown> = async () => {};
if (process.env.PAYMENTS_WORKER !== "off") {
  const url = process.env.DATABASE_URL!;
  try {
    stopListen = await listen(url, "deposit_settlement", (id) => { void processSettlement(deps, id); });
  } catch (err) { console.warn("payments: LISTEN unavailable, relying on the sweep:", err instanceof Error ? err.message : err); }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await reconcilePayments(deps); } catch (err) { console.error("[payments] sweep failed:", err); } finally { running = false; }
  };
  setInterval(tick, 60_000).unref();
  void tick();
  console.log("payments: settlement worker on (LISTEN deposit_settlement + 1-minute sweep)");
}
// HOST=127.0.0.1 in production: only the web app (on the same machine, behind nginx) reaches the API.
const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4000), hostname: process.env.HOST || undefined },
  (i) => console.log(`api on ${process.env.HOST ?? "*"}:${i.port}`));
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, () => { server.close(); void Promise.all([stopJobs(), stopListen()]).finally(() => process.exit(0)); });
}
