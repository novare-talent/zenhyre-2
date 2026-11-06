import { Forbidden } from "@zenhyre/shared";
import type { Ops } from "@zenhyre/ops";
import type { Identity } from "@zenhyre/identity";
import type { TemplateName } from "@zenhyre/notify";
import type { Actor, Role, Roles } from "@zenhyre/roles";
import type { Matching, RoleContext } from "@zenhyre/matching";
import type { AppDeps } from "../context";

/** The signed-in user a workflow acts for. */
export interface User { id: string; isStaff: boolean }

/** Module interfaces bound to the workflow's transaction. */
export interface Modules { ops: Ops; identity: Identity; roles: Roles; matching: Matching }
/** What a workflow body gets: tx-bound modules, the app deps, and `after` for steps that must wait for the commit. */
export interface Wf { m: Modules; deps: AppDeps; after(step: () => Promise<unknown>): void }

/**
 * §3.3: a workflow calls module interfaces in sequence inside one transaction. Slow follow-ups (email, enqueued jobs)
 * are registered with `after` and run once the transaction has committed, so a rollback sends nothing and an email
 * provider outage cannot undo a committed state change. A failed follow-up is logged, never rethrown.
 */
export async function inTx<T>(deps: AppDeps, body: (w: Wf) => Promise<T>): Promise<T> {
  const steps: Array<() => Promise<unknown>> = [];
  const out = await deps.db.transaction((tx) => body({
    deps, after: (step) => { steps.push(step); },
    m: { ops: deps.ops.withDb(tx), identity: deps.identity.withDb(tx), roles: deps.roles.withDb(tx), matching: deps.matching.withDb(tx) },
  }));
  for (const step of steps) {
    try { await step(); } catch (err) { console.error("[workflow] post-commit step failed:", err); }
  }
  return out;
}

/** Email + in-app to one user, after commit. */
export function notifyUser(w: Wf, userId: string, template: TemplateName, data: Record<string, unknown>) {
  w.after(() => w.deps.notify.send(userId, template, data));
}
/** Email + in-app to every unlocked user of a company, after commit. */
export function notifyCompany(w: Wf, companyId: string, template: TemplateName, data: Record<string, unknown>) {
  w.after(async () => {
    for (const u of await w.deps.identity.listCompanyUsers(companyId)) {
      if (!u.lockedAt) await w.deps.notify.send(u.userId, template, data);
    }
  });
}

/** Who a user is to a role: staff as staff, otherwise an unlocked member of the role's company. Anyone else is refused. */
export async function roleActor(w: Wf, user: User, role: Pick<Role, "companyId">): Promise<Actor> {
  if (user.isStaff) return { kind: "staff", userId: user.id };
  await w.m.identity.requireActiveMember(user.id, role.companyId);
  return { kind: "company", userId: user.id };
}
export function requireStaff(user: User): Actor {
  if (!user.isStaff) throw new Forbidden("staff only");
  return { kind: "staff", userId: user.id };
}

/** What matching needs to know about a role when a company acts on a match (§4.3). */
export const roleContext = (role: Role): RoleContext => ({
  id: role.id, status: role.status, hiredMatchId: role.hiredMatchId, replacementGuaranteeDays: role.feeTerms?.replacement_guarantee_days });

export const roleUrl = (deps: AppDeps, roleId: string) => `${deps.baseUrl}/company/roles/${roleId}`;
