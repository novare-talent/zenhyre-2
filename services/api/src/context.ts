import { Db } from "@zenhyre/db";
import { Clock } from "@zenhyre/shared";
import { createOps, Ops } from "@zenhyre/ops";
import { createIdentity, Identity } from "@zenhyre/identity";
import { createNotify, Notify, Transport } from "@zenhyre/notify";

export interface AppConfig { db: Db; clock: Clock; transport: Transport; baseUrl: string; webhookSecret?: string }
export interface AppDeps extends AppConfig { ops: Ops; identity: Identity; notify: Notify }

export async function buildDeps(cfg: AppConfig): Promise<AppDeps> {
  const ops = createOps(cfg.db);
  const identity = createIdentity(cfg.db, {
    clock: cfg.clock,
    freemailDomains: await ops.config.get("identity.freemail_domains"),
    finalYearMonths: await ops.config.get("identity.final_year_months_before_grad"),
    maxVerificationAttempts: await ops.config.get("identity.max_verification_attempts"),
  });
  return { ...cfg, ops, identity, notify: createNotify(cfg.db, cfg.transport) };
}

export type Vars = { user: { id: string; isStaff: boolean } | null; deps: AppDeps };
