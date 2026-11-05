import { DbOrTx } from "@zenhyre/db";
import { Clock, systemClock } from "@zenhyre/shared";
import { createAuth } from "./auth";
export interface IdentityDeps { clock?: Clock }
function buildIdentity(db: DbOrTx, deps: IdentityDeps) {
  return { ...createAuth(db, deps.clock ?? systemClock) };
}
export type Identity = ReturnType<typeof buildIdentity> & { withDb(tx: DbOrTx): Identity };
export function createIdentity(db: DbOrTx, deps: IdentityDeps = {}): Identity {
  return { ...buildIdentity(db, deps), withDb: (tx) => createIdentity(tx, deps) };
}
