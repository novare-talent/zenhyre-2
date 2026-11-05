import { DbOrTx } from "@zenhyre/db";
import { createConfig } from "./config";
export * from "./defaults";
export function createOps(db: DbOrTx) {
  return { config: createConfig(db) };
}
export type Ops = ReturnType<typeof createOps>;
