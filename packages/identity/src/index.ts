import { DbOrTx } from "@zenhyre/db";
import { Clock, systemClock } from "@zenhyre/shared";
import { createAuth } from "./auth";
import { createCandidateModule } from "./candidate";
export * from "./candidate";
export interface IdentityDeps { clock?: Clock; finalYearMonths?: number; maxVerificationAttempts?: number }
function buildIdentity(db: DbOrTx, deps: IdentityDeps) {
  const clock = deps.clock ?? systemClock;
  return {
    ...createAuth(db, clock),
    ...createCandidateModule(db, clock, { finalYearMonths: deps.finalYearMonths ?? 12, maxVerificationAttempts: deps.maxVerificationAttempts ?? 2 }),
  };
}
export type Identity = ReturnType<typeof buildIdentity> & { withDb(tx: DbOrTx): Identity };
export function createIdentity(db: DbOrTx, deps: IdentityDeps = {}): Identity {
  return { ...buildIdentity(db, deps), withDb: (tx) => createIdentity(tx, deps) };
}
