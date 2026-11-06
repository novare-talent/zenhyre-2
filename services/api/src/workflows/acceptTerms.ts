import { depositFor } from "@zenhyre/roles";
import { AppDeps } from "../context";
import { inTx, roleActor, User } from "./tx";

/**
 * §3.3 acceptTerms: the company accepts the released terms; the role moves to `deposit_pending` owing the deposit for
 * its reach (§9.1), doubled on probation, unless staff set an amount on the role beforehand.
 * Slice 1 has no Razorpay: no order is created and `deposit_mode` stays unset until staff waive the deposit.
 */
export async function acceptTerms(deps: AppDeps, input: { roleId: string; user: User }) {
  return inTx(deps, async (w) => {
    const role = await w.m.roles.require(input.roleId);
    const actor = await roleActor(w, input.user, role);
    const company = await w.m.identity.getCompany(role.companyId);
    const multiplier = company?.status === "probation" ? await w.m.ops.config.get("deposit.probation_multiplier") : 1;
    const depositAmount = role.depositAmount ?? depositFor(await w.m.ops.config.get("deposit.tiers"), role.campusReach.length, multiplier);
    return w.m.roles.acceptTerms(role.id, actor, { depositAmount });
  });
}
