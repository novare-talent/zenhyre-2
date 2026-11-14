import { serve } from "@hono/node-server";
import { buildApp } from "./app";
import { buildDeps } from "./context";
import { startScheduler } from "./scheduler";
import { configFromEnv } from "./config";
import { startPgBoss } from "./pgboss";

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
const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4000) }, (i) => console.log(`api on :${i.port}`));
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, () => { server.close(); void stopJobs().finally(() => process.exit(0)); });
}
