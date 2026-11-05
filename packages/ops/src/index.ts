import { DbOrTx } from "@zenhyre/db";
import { createConfig } from "./config";
import { createReview } from "./review";
import { createAudit } from "./audit";
export * from "./defaults";
export * from "./review";

function buildOps(db: DbOrTx) {
  return { config: createConfig(db), ...createReview(db), ...createAudit(db) };
}
export type Ops = ReturnType<typeof buildOps> & { withDb(tx: DbOrTx): Ops };
export function createOps(db: DbOrTx): Ops {
  return { ...buildOps(db), withDb: (tx) => createOps(tx) };
}
