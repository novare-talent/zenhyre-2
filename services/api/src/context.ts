import { Db } from "@zenhyre/db";
import { Clock } from "@zenhyre/shared";
import { createOps, Ops } from "@zenhyre/ops";
import { createIdentity, Identity } from "@zenhyre/identity";
import { createNotify, Notify, Transport } from "@zenhyre/notify";
import { createRoles, Roles } from "@zenhyre/roles";
import { createMatching, Matching, Scorer } from "@zenhyre/matching";
import type { GateModel } from "@zenhyre/gate";
import { inlineJobs, JobQueue } from "./jobs";

export interface AppConfig {
  db: Db; clock: Clock; transport: Transport; baseUrl: string; webhookSecret?: string;
  /** §7 stage 2. Without one, every role that passes the rules goes to human review: nothing is accepted unseen. */
  gateModel?: GateModel;
  /** §8 step 3. Defaults to matching's deterministic scorer. */
  scorer?: Scorer;
  /** Where workflows enqueue follow-up jobs. Defaults to running them in-process right after commit; pg-boss replaces it. */
  jobs?: (deps: AppDeps) => JobQueue;
}
export interface AppDeps extends Omit<AppConfig, "jobs"> { ops: Ops; identity: Identity; notify: Notify; roles: Roles; matching: Matching; jobs: JobQueue }

export async function buildDeps(cfg: AppConfig): Promise<AppDeps> {
  const ops = createOps(cfg.db);
  const identity = createIdentity(cfg.db, {
    clock: cfg.clock,
    freemailDomains: await ops.config.get("identity.freemail_domains"),
    finalYearMonths: await ops.config.get("identity.final_year_months_before_grad"),
    maxVerificationAttempts: await ops.config.get("identity.max_verification_attempts"),
  });
  const { jobs, ...rest } = cfg;
  const deps = {
    ...rest, ops, identity, notify: createNotify(cfg.db, cfg.transport),
    roles: createRoles(cfg.db, { clock: cfg.clock }),
    matching: createMatching(cfg.db, { clock: cfg.clock, scorer: cfg.scorer, candidates: identity }),
  } as AppDeps;
  deps.jobs = jobs ? jobs(deps) : inlineJobs(deps);
  return deps;
}

export type Vars = { user: { id: string; isStaff: boolean } | null; deps: AppDeps };
