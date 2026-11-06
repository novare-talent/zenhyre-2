import { AppDeps } from "../context";
import { inTx, notifyCompany, roleActor, User } from "./tx";

/** §3.3 appealRole: a rejected role re-enters `gated`, once and within the appeal window, and goes straight to human review (§7). */
export async function appealRole(deps: AppDeps, input: { roleId: string; user: User; note?: string }) {
  return inTx(deps, async (w) => {
    const role = await w.m.roles.require(input.roleId);
    const actor = await roleActor(w, input.user, role);
    const previous = await w.m.roles.finalGateDecision(role);
    const appealed = await w.m.roles.appeal(role.id, actor, { appealWindowDays: await w.m.ops.config.get("gate.appeal_window_days"), note: input.note?.trim() || undefined });
    await w.m.ops.openReview({ kind: "gate", refType: "role", refId: role.id, associationId: null,
      payload: { reason: "Appeal", appeal: true, note: input.note?.trim() ?? "", rejectedFor: previous?.reason ?? null, roleTitle: role.title, companyId: role.companyId } });
    notifyCompany(w, role.companyId, "role_needs_review", { roleTitle: role.title });
    return appealed;
  });
}
