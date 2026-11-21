import type { AppDeps } from "./context";
import { gateDecision } from "./workflows/gateDecision";
import { broadcastRole } from "./workflows/broadcastRole";
import { freezeShortlist } from "./workflows/freezeShortlist";
import { releaseTerms } from "./workflows/releaseTerms";
import { termsTimeout } from "./workflows/withdrawRole";
import { darkCheck } from "./workflows/darkCheck";
import { guaranteeExpiry } from "./workflows/guaranteeExpiry";
import { joinGrace, joinPrompt } from "./workflows/confirmJoin";
import { reconcilePayments } from "./workflows/payments";

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
 * after the failed workflow has rolled back. A later success of the same job clears the error.
 */
export async function runRoleJob(deps: AppDeps, name: string, roleId: string, run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    const role = await deps.roles.get(roleId);
    // Only this job's own error: a role can be swept by several jobs a night, and one succeeding says nothing about another.
    if (role?.jobError?.startsWith(`${name}: `)) await deps.roles.update(roleId, { jobError: null });
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

/**
 * Runs `step` for each role under `runRoleJob` and counts the roles it acted on. The lists these sweeps start from are
 * read outside any lock, so each step re-checks under the role's lock and reports whether it did anything.
 */
async function sweep(deps: AppDeps, name: string, roles: Array<{ id: string }>, step: (roleId: string) => Promise<boolean>) {
  let done = 0;
  for (const { id } of roles) {
    let acted = false;
    if (await runRoleJob(deps, name, id, async () => { acted = await step(id); }) && acted) done++;
  }
  return { roles: done };
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
  /** Nightly: withdraw roles whose released terms went unaccepted for `gate.terms_timeout_days`. */
  "role.terms_timeout": async (deps: AppDeps) =>
    sweep(deps, "role.terms_timeout", await deps.roles.listTermsTimedOut(await deps.ops.config.get("gate.terms_timeout_days")),
      async (roleId) => (await termsTimeout(deps, { roleId })).withdrawn),
  /** Nightly: close shortlists with no hire `deposit.dark_days` after they were made ready. */
  "role.dark_check": async (deps: AppDeps) =>
    sweep(deps, "role.dark_check", await deps.roles.listShortlistsDark(await deps.ops.config.get("deposit.dark_days")),
      async (roleId) => (await darkCheck(deps, { roleId })).abandoned),
  /** Nightly: ask each hire "did you join?" once its joining date has come. */
  "role.join_prompt": async (deps: AppDeps) =>
    sweep(deps, "role.join_prompt", await deps.roles.listClosingWithHire(), async (roleId) => (await joinPrompt(deps, { roleId })).sent),
  /** Nightly: confirm hires nobody disputed within the grace period; reverse hires whose dispute the company left unanswered. */
  "role.join_grace": async (deps: AppDeps) =>
    sweep(deps, "role.join_grace", await deps.roles.listClosingWithHire(), async (roleId) => (await joinGrace(deps, { roleId })).outcome !== "none"),
  /** Nightly, after the two above: close hired roles whose replacement guarantee has ended. */
  "role.guarantee_expiry": async (deps: AppDeps) =>
    sweep(deps, "role.guarantee_expiry", await deps.roles.listClosingWithHire(), async (roleId) => (await guaranteeExpiry(deps, { roleId })).closed),
  /**
   * Hourly (and every minute in the long-running server): check open checkouts with the gateway, carry out queued
   * settlements (including ones requested from SQL), and re-check refunds in flight.
   */
  "payment.reconcile": async (deps: AppDeps) => reconcilePayments(deps),
  /** Nightly: student → final_year → alumnus by `grad_date` (§6.1). */
  "candidate.status_flip": async (deps: AppDeps) => ({ candidates: await deps.identity.refreshCandidateStatuses() }),
  /** Nightly: ask candidates to add a personal email at `identity.grad_nudge_days` around graduation (§6.1), once per offset. */
  "candidate.grad_nudge": async (deps: AppDeps) => {
    let sent = 0;
    for (const { userId, offset } of await deps.identity.candidatesDueGradNudge(await deps.ops.config.get("identity.grad_nudge_days"))) {
      if (await deps.notify.alreadySent(userId, "add_personal_email", "offset", offset)) continue;
      await deps.notify.send(userId, "add_personal_email", { offset });
      sent++;
    }
    return { candidates: sent };
  },
} as const;
export type ScheduledJobName = keyof typeof SCHEDULED_JOBS;
