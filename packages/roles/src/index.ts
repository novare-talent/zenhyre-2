import { DbOrTx } from "@zenhyre/db";
import { Clock, systemClock } from "@zenhyre/shared";
import { createRolesModule } from "./service";
export * from "./lifecycle";
export * from "./terms";
export type { Role, RoleEvent, RoleGateDecision, RoleType, RoleContent, RoleBookkeeping, RolePatch, TransitionOpts, GateDecisionInput } from "./service";
export type { FeeTerms } from "@zenhyre/db/schema";

export interface RolesDeps { clock?: Clock }
export type Roles = ReturnType<typeof createRolesModule> & { withDb(tx: DbOrTx): Roles };
export function createRoles(db: DbOrTx, deps: RolesDeps = {}): Roles {
  return { ...createRolesModule(db, deps.clock ?? systemClock), withDb: (tx) => createRoles(tx, deps) };
}
