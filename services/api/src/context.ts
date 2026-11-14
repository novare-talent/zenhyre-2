import { Db } from "@zenhyre/db";
import { Clock } from "@zenhyre/shared";
import { createOps, Ops } from "@zenhyre/ops";
import { createIdentity, Identity } from "@zenhyre/identity";
import { createNotify, Notify, Transport } from "@zenhyre/notify";
import { createRoles, Roles } from "@zenhyre/roles";
import { createMatching, Matching, Scorer } from "@zenhyre/matching";
import type { GateModel } from "@zenhyre/gate";
import { inlineJobs, JobQueue } from "./jobs";
import type { AuthProvider } from "./auth/provider";
import { rateLimiter } from "./rateLimit";

export interface AppConfig {
  db: Db; clock: Clock; transport: Transport; baseUrl: string; webhookSecret?: string;
  /** Sign-in: Supabase Auth in production (`auth/supabaseAuth.ts`), the in-memory fake in tests and offline dev. */
  auth: AuthProvider;
  /** Sign-in link requests allowed per 15 minutes. Defaults: 5 per address, 30 per client IP. */
  linkLimits?: { perEmail?: number; perIp?: number };
  /** §7 stage 2. Without one, every role that passes the rules goes to human review: nothing is accepted unseen. */
  gateModel?: GateModel;
  /** §8 step 3. Defaults to matching's deterministic scorer. */
  scorer?: Scorer;
  /** Where workflows enqueue follow-up jobs. Defaults to running them in-process right after commit; pg-boss replaces it. */
  jobs?: (deps: AppDeps) => JobQueue;
}
type Limiter = ReturnType<typeof rateLimiter>;
export interface AppDeps extends Omit<AppConfig, "jobs" | "linkLimits"> {
  ops: Ops; identity: Identity; notify: Notify; roles: Roles; matching: Matching; jobs: JobQueue;
  limits: { linkPerEmail: Limiter; linkPerIp: Limiter };
}

export async function buildDeps(cfg: AppConfig): Promise<AppDeps> {
  const ops = createOps(cfg.db);
  const identity = createIdentity(cfg.db, {
    clock: cfg.clock,
    freemailDomains: await ops.config.get("identity.freemail_domains"),
    finalYearMonths: await ops.config.get("identity.final_year_months_before_grad"),
    maxVerificationAttempts: await ops.config.get("identity.max_verification_attempts"),
  });
  const { jobs, linkLimits, ...rest } = cfg;
  const window = 15 * 60 * 1000;
  const deps = {
    ...rest, ops, identity, notify: createNotify(cfg.db, cfg.transport),
    limits: {
      linkPerEmail: rateLimiter(cfg.clock, linkLimits?.perEmail ?? 5, window),
      linkPerIp: rateLimiter(cfg.clock, linkLimits?.perIp ?? 30, window),
    },
    roles: createRoles(cfg.db, { clock: cfg.clock }),
    matching: createMatching(cfg.db, { clock: cfg.clock, scorer: cfg.scorer, candidates: identity }),
  } as AppDeps;
  deps.jobs = jobs ? jobs(deps) : inlineJobs(deps);
  return deps;
}

export type Vars = { user: { id: string; isStaff: boolean } | null; deps: AppDeps };
