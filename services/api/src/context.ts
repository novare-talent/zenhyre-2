import { Db } from "@zenhyre/db";
import { Clock } from "@zenhyre/shared";
import { createOps, Ops } from "@zenhyre/ops";
import { createIdentity, Identity } from "@zenhyre/identity";
import { createNotify, Notify, Transport } from "@zenhyre/notify";
import { createRoles, Roles } from "@zenhyre/roles";
import { createMatching, Matching, Scorer } from "@zenhyre/matching";
import { createLedger, fakeGateway, Ledger, PaymentGateway } from "@zenhyre/ledger";
import type { GateModel } from "@zenhyre/gate";
import { inlineJobs, JobQueue } from "./jobs";
import type { AuthProvider } from "./auth/provider";
import { rateLimiter } from "./rateLimit";

export interface AppConfig {
  db: Db; clock: Clock; transport: Transport; baseUrl: string; webhookSecret?: string;
  /** Sign-in: Supabase Auth in production (`auth/supabaseAuth.ts`), the in-memory fake in tests and offline dev. */
  auth: AuthProvider;
  /** Enables GET /cron/:cadence (Vercel Cron) for callers presenting `Authorization: Bearer <cronSecret>`. */
  cronSecret?: string;
  /** Sign-in link requests allowed per 15 minutes. Defaults: 5 per address, 30 per client IP. */
  linkLimits?: { perEmail?: number; perIp?: number };
  /** §7 stage 2. Without one, every role that passes the rules goes to human review: nothing is accepted unseen. */
  gateModel?: GateModel;
  /** §8 step 3. Defaults to matching's deterministic scorer. */
  scorer?: Scorer;
  /** Where workflows enqueue follow-up jobs. Defaults to running them in-process right after commit; pg-boss replaces it. */
  jobs?: (deps: AppDeps) => JobQueue;
  /** Deposits and fees: Cashfree (`PAYMENT_PROVIDER=cashfree`), else the in-memory fake. */
  gateway?: PaymentGateway;
  /**
   * Where the gateway posts its webhooks. Default: the web app's `/api/webhooks/cashfree`, which forwards to this API,
   * so the API itself never has to be reachable from the internet.
   */
  paymentWebhookUrl?: string;
  /** Minutes a checkout stays payable. Default 60. */
  orderExpiryMinutes?: number;
}
type Limiter = ReturnType<typeof rateLimiter>;
export interface AppDeps extends Omit<AppConfig, "jobs" | "linkLimits" | "gateway" | "paymentWebhookUrl" | "orderExpiryMinutes"> {
  ops: Ops; identity: Identity; notify: Notify; roles: Roles; matching: Matching; jobs: JobQueue;
  ledger: Ledger; gateway: PaymentGateway; paymentWebhookUrl: string; orderExpiryMinutes: number;
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
  const { jobs, linkLimits, gateway, paymentWebhookUrl, orderExpiryMinutes, ...rest } = cfg;
  const window = 15 * 60 * 1000;
  const deps = {
    ...rest, ops, identity, notify: createNotify(cfg.db, cfg.transport),
    limits: {
      linkPerEmail: rateLimiter(cfg.db, cfg.clock, "link:email", linkLimits?.perEmail ?? 5, window),
      linkPerIp: rateLimiter(cfg.db, cfg.clock, "link:ip", linkLimits?.perIp ?? 30, window),
    },
    roles: createRoles(cfg.db, { clock: cfg.clock }),
    matching: createMatching(cfg.db, { clock: cfg.clock, scorer: cfg.scorer, candidates: identity }),
    ledger: createLedger(cfg.db, { clock: cfg.clock }),
    gateway: gateway ?? fakeGateway(),
    paymentWebhookUrl: paymentWebhookUrl ?? `${cfg.baseUrl.replace(/\/$/, "")}/api/webhooks/cashfree`,
    orderExpiryMinutes: orderExpiryMinutes ?? 60,
  } as AppDeps;
  deps.jobs = jobs ? jobs(deps) : inlineJobs(deps);
  return deps;
}

export type Vars = { user: { id: string; isStaff: boolean; isFinance: boolean } | null; deps: AppDeps };
