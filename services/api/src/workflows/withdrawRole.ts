import { SYSTEM, type Actor, type Role } from "@zenhyre/roles";
import { AppDeps } from "../context";
import { DAY_MS, inTx, notifyCompany, roleActor, User, Wf } from "./tx";
import { closeMatchesTx } from "./closeRole";
import { resolveDepositTx } from "./resolveDeposit";

/**
 * §3.3 withdrawRole: the role moves to `withdrawn` (the lifecycle table allows it from any open state; never from
 * `closing`, `rejected` or `closed`), its open matches close, and the deposit is resolved (§9.1), which ends in
 * `closeRole`. The company gets one message: `terms_expired` when the terms timed out, `role_closed` otherwise.
 */
export async function withdrawRoleTx(w: Wf, input: { role: Role; actor: Actor; note?: string; tell?: "role_closed" | "terms_expired" }) {
  const withdrawn = await w.m.roles.transition(input.role.id, "withdrawn", input.actor, input.note);
  const closedMatches = await closeMatchesTx(w, withdrawn);
  const { role } = await resolveDepositTx(w, { role: withdrawn });
  notifyCompany(w, role.companyId, input.tell ?? "role_closed", { roleTitle: role.title });
  return { role, closedMatches };
}

/** A member of the role's company, or staff (audited), withdraws the role. */
export async function withdrawRole(deps: AppDeps, input: { roleId: string; user: User; note?: string }) {
  return inTx(deps, async (w) => {
    const role = await w.m.roles.lock(input.roleId);
    const actor = await roleActor(w, input.user, role);
    const note = input.note?.trim() || undefined;
    const out = await withdrawRoleTx(w, { role, actor, note });
    if (actor.kind === "staff") await w.m.ops.audit(input.user.id, "role.withdraw", "role", role.id, note);
    return out.role;
  });
}

/**
 * `role.terms_timeout` (§5, §18): released terms left unaccepted for `gate.terms_timeout_days` withdraw the role and the
 * company is sent `terms_expired`. A no-op if the terms were accepted, or the role withdrawn, in the meantime.
 */
export async function termsTimeout(deps: AppDeps, input: { roleId: string }) {
  return inTx(deps, async (w) => {
    const role = await w.m.roles.lock(input.roleId);
    const days = await w.m.ops.config.get("gate.terms_timeout_days");
    const due = role.status === "terms_pending" && !!role.feeTermsReleasedAt
      && role.feeTermsReleasedAt.getTime() + days * DAY_MS <= deps.clock.now().getTime();
    if (!due) return { withdrawn: false as const };
    const out = await withdrawRoleTx(w, { role, actor: SYSTEM, note: `terms not accepted within ${days} days of release`, tell: "terms_expired" });
    return { withdrawn: true as const, role: out.role };
  });
}
