import { DbOrTx } from "@zenhyre/db";
import { Clock, systemClock } from "@zenhyre/shared";
import { createAuth } from "./auth";
import { createCandidateModule } from "./candidate";
import { createCompanyModule } from "./company";
import { createAssociationModule } from "./association";
export * from "./candidate";
export { PERSON_FIELDS, splitName, type PersonPatch } from "./auth";

export interface IdentityDeps {
  clock?: Clock; finalYearMonths?: number; maxVerificationAttempts?: number; freemailDomains?: string[];
}

function buildIdentity(db: DbOrTx, deps: IdentityDeps) {
  const clock = deps.clock ?? systemClock;
  return {
    ...createAuth(db, clock),
    ...createCandidateModule(db, clock, { finalYearMonths: deps.finalYearMonths ?? 12, maxVerificationAttempts: deps.maxVerificationAttempts ?? 2 }),
    ...createCompanyModule(db, clock, { freemailDomains: deps.freemailDomains ?? [] }),
    ...createAssociationModule(db, clock),
  };
}
export type Identity = ReturnType<typeof buildIdentity> & { withDb(tx: DbOrTx): Identity };
export function createIdentity(db: DbOrTx, deps: IdentityDeps = {}): Identity {
  return { ...buildIdentity(db, deps), withDb: (tx) => createIdentity(tx, deps) };
}
