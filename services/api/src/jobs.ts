import type { AppDeps } from "./context";
import { gateDecision } from "./workflows/gateDecision";
import { broadcastRole } from "./workflows/broadcastRole";
import { freezeShortlist } from "./workflows/freezeShortlist";
import { releaseTerms } from "./workflows/releaseTerms";

/** Jobs a workflow enqueues after it commits (§3.3). Each takes the role it is about. */
export const ROLE_JOBS = {
  /** §7: runs when a role enters `gated` from `draft`. */
  "role.gate": (deps: AppDeps, p: { roleId: string }) => gateDecision(deps, { trigger: "job", roleId: p.roleId }),
  /** §8: runs when a role enters `broadcast`. */
  "role.broadcast": (deps: AppDeps, p: { roleId: string }) => broadcastRole(deps, p),
} as const;
export type RoleJobName = keyof typeof ROLE_JOBS;

export interface JobQueue { enqueue(name: RoleJobName, payload: { roleId: string }): Promise<void> }

/**
 * §13: a job's final failure writes `Role.job_error` and opens an `alert` ReviewItem. Written in its own transaction,
 * after the failed workflow has rolled back. A later success clears the error.
 */
export async function runRoleJob(deps: AppDeps, name: string, roleId: string, run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    const role = await deps.roles.get(roleId);
    if (role?.jobError) await deps.roles.update(roleId, { jobError: null });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[job] ${name} failed for role ${roleId}:`, err);
    try {
      await deps.db.transaction(async (tx) => {
        await deps.roles.withDb(tx).update(roleId, { jobError: `${name}: ${message}`.slice(0, 500) });
        await deps.ops.withDb(tx).openReview({ kind: "alert", refType: "role", refId: roleId, associationId: null, payload: { job: name, error: message } });
      });
    } catch (inner) { console.error(`[job] could not record the failure of ${name} for role ${roleId}:`, inner); }
    return false;
  }
}

/**
 * The default queue: runs the job in-process as soon as it is enqueued, once, and never throws back into the caller.
 * pg-boss (3 attempts, exponential backoff, §13) implements the same interface when the scheduler is wired.
 */
export function inlineJobs(deps: AppDeps): JobQueue {
  return { enqueue: async (name, payload) => { await runRoleJob(deps, name, payload.roleId, () => ROLE_JOBS[name](deps, payload)); } };
}

/** §18 scheduled jobs this slice provides. Each is safe to run at any time and as often as wanted. */
export const SCHEDULED_JOBS = {
  /** Hourly: freeze the shortlist of every broadcast whose window has ended. */
  "role.close_broadcast": async (deps: AppDeps) => {
    let done = 0;
    for (const role of await deps.roles.listBroadcastsDue()) {
      if (await runRoleJob(deps, "role.close_broadcast", role.id, () => freezeShortlist(deps, { roleId: role.id }))) done++;
    }
    return { roles: done };
  },
  /** Hourly: release prefilled terms staff have left untouched for `gate.terms_auto_release_hours`. */
  "role.terms_auto_release": async (deps: AppDeps) => {
    let done = 0;
    for (const role of await deps.roles.listTermsAwaitingRelease(await deps.ops.config.get("gate.terms_auto_release_hours"))) {
      if (await runRoleJob(deps, "role.terms_auto_release", role.id, () => releaseTerms(deps, { roleId: role.id }))) done++;
    }
    return { roles: done };
  },
} as const;
export type ScheduledJobName = keyof typeof SCHEDULED_JOBS;
