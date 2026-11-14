import PgBoss from "pg-boss";
import type { AppDeps } from "./context";
import { JobQueue, ROLE_JOBS, RoleJobName, runRoleJob, SCHEDULED_JOBS, ScheduledJobName } from "./jobs";
import { CADENCE } from "./scheduler";

/**
 * §3.2 / §13: background jobs on pg-boss, in the same Postgres (schema `pgboss`).
 *
 * - Role jobs (`role.gate`, `role.broadcast`) are queued by workflows after commit. Three attempts with exponential
 *   backoff; only the final failure writes `Role.job_error` and opens an `alert` (as `runRoleJob` does inline).
 * - The §18 scheduled jobs run from two cron schedules, `hourly` and `nightly` (UTC). Each runs its jobs in
 *   `SCHEDULED_JOBS` order, so joining is settled before guarantees are checked. Schedules are cluster-safe:
 *   several API instances still run each tick once.
 */
const RETRY_LIMIT = 2; // 3 attempts in all
const queueOf = (name: string) => name.replace(/\./g, "_"); // "role.gate" -> "role_gate"
const SCHEDULES = { hourly: "0 * * * *", nightly: "0 0 * * *" } as const;

export async function startPgBoss(deps: AppDeps, connectionString: string, opts: { schedules?: boolean } = {}) {
  const boss = new PgBoss({ connectionString, schema: "pgboss", max: 4 });
  boss.on("error", (err) => console.error("[pg-boss]", err));
  await boss.start();

  for (const name of Object.keys(ROLE_JOBS) as RoleJobName[]) {
    await boss.createQueue(queueOf(name), { name: queueOf(name), retryLimit: RETRY_LIMIT, retryBackoff: true, retryDelay: 30 });
    await boss.work<{ roleId: string }>(queueOf(name), { includeMetadata: true }, async ([job]) => {
      if (!job) return;
      const { roleId } = job.data;
      const run = () => ROLE_JOBS[name](deps, { roleId });
      // The last attempt records a failure on the role instead of throwing; earlier ones throw so pg-boss retries.
      if (job.retryCount >= RETRY_LIMIT) { await runRoleJob(deps, name, roleId, run); return; }
      await run();
      const role = await deps.roles.get(roleId);
      if (role?.jobError?.startsWith(`${name}: `)) await deps.roles.update(roleId, { jobError: null });
    });
  }

  for (const cadence of Object.keys(SCHEDULES) as (keyof typeof SCHEDULES)[]) {
    await boss.createQueue(cadence, { name: cadence, retryLimit: 0 });
    await boss.work(cadence, async () => { await runCadence(deps, cadence); });
    if (opts.schedules !== false) await boss.schedule(cadence, SCHEDULES[cadence], {}, { tz: "UTC" });
  }

  const queue: JobQueue = {
    enqueue: async (name, payload) => { await boss.send(queueOf(name), payload, { retryLimit: RETRY_LIMIT, retryBackoff: true, retryDelay: 30 }); },
  };
  return { boss, queue, stop: () => boss.stop({ graceful: true, timeout: 20_000 }) };
}

/** Runs every job of one cadence in order. A job that throws is logged; the rest still run (each re-checks what is due). */
export async function runCadence(deps: AppDeps, cadence: "hourly" | "nightly") {
  const ran: ScheduledJobName[] = [];
  for (const name of Object.keys(SCHEDULED_JOBS) as ScheduledJobName[]) {
    if (CADENCE[name] !== cadence) continue;
    try { await SCHEDULED_JOBS[name](deps); ran.push(name); }
    catch (err) { console.error(`[jobs] ${name} failed:`, err); }
  }
  return ran;
}
