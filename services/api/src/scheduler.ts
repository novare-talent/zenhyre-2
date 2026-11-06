import type { AppDeps } from "./context";
import { SCHEDULED_JOBS, type ScheduledJobName } from "./jobs";

/**
 * An interim, in-process scheduler for the §18 jobs, so they run without staff pressing a button. It keeps no state
 * beyond memory: after a restart every job runs once, which is safe because each job re-checks what is due. With more
 * than one API process each runs its own copy; the jobs lock the role they act on, so that is wasteful, not wrong.
 * pg-boss (§3.2) replaces this file when it is wired; `SCHEDULED_JOBS` and the cadence table stay.
 */
export const CADENCE: Record<ScheduledJobName, "hourly" | "nightly"> = {
  "role.close_broadcast": "hourly",
  "role.terms_auto_release": "hourly",
  "role.terms_timeout": "nightly",
  "role.dark_check": "nightly",
  "role.join_prompt": "nightly",
  "role.join_grace": "nightly",
  "role.guarantee_expiry": "nightly",
  "candidate.status_flip": "nightly",
};

const HOUR_MS = 60 * 60 * 1000;
const utcDay = (ms: number) => Math.floor(ms / (24 * HOUR_MS));
export type LastRun = Partial<Record<ScheduledJobName, number>>;

/**
 * The jobs to run at `now`, in `SCHEDULED_JOBS` order (joining is settled before guarantees are checked): an hourly
 * job an hour after its last run, a nightly job once per UTC day, and any job that has not run since start-up.
 */
export function dueJobs(now: Date, lastRun: LastRun): ScheduledJobName[] {
  return (Object.keys(SCHEDULED_JOBS) as ScheduledJobName[]).filter((name) => {
    const last = lastRun[name];
    if (last === undefined) return true;
    return CADENCE[name] === "hourly" ? now.getTime() - last >= HOUR_MS : utcDay(now.getTime()) > utcDay(last);
  });
}

/** Runs whatever is due. A job that throws is logged and tried again on the next tick; the others still run. */
export async function tick(deps: AppDeps, lastRun: LastRun, run: (name: ScheduledJobName) => Promise<unknown> = (name) => SCHEDULED_JOBS[name](deps)) {
  const ran: ScheduledJobName[] = [];
  for (const name of dueJobs(deps.clock.now(), lastRun)) {
    try {
      await run(name);
      lastRun[name] = deps.clock.now().getTime();
      ran.push(name);
    } catch (err) { console.error(`[scheduler] ${name} failed:`, err); }
  }
  return ran;
}

/** Ticks now and then every `everyMs` (default: a minute). Returns a function that stops it. */
export function startScheduler(deps: AppDeps, everyMs = 60 * 1000): () => void {
  const lastRun: LastRun = {};
  let busy = false;
  const go = async () => {
    if (busy) return; // a slow run is not overtaken by the next tick
    busy = true;
    try { await tick(deps, lastRun); } finally { busy = false; }
  };
  void go();
  const timer = setInterval(go, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
