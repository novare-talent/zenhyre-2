import { depositFor, depositForCtc } from "@zenhyre/roles";
import { AppDeps } from "../context";
import { inTx, roleActor, User } from "./tx";

/**
 * §3.3 acceptTerms: the company accepts the released terms; the role moves to `deposit_pending` owing the deposit for
 * the CTC it offers (`deposit.ctc_slabs` on `ctc_max`, before GST), doubled on probation, unless staff set an amount on
 * the role beforehand. A role with no CTC falls back to the campus-count tiers. The company then pays at checkout
 * (`workflows/payments.ts`), or staff waive it.
 */
export async function acceptTerms(deps: AppDeps, input: { roleId: string; user: User }) {
  return inTx(deps, async (w) => {
    const role = await w.m.roles.require(input.roleId);
    const actor = await roleActor(w, input.user, role);
    const company = await w.m.identity.getCompany(role.companyId);
    const multiplier = company?.status === "probation" ? await w.m.ops.config.get("deposit.probation_multiplier") : 1;
    const depositAmount = role.depositAmount
      ?? depositForCtc(await w.m.ops.config.get("deposit.ctc_slabs"), role.ctcMax ?? role.ctcMin, multiplier)
      ?? depositFor(await w.m.ops.config.get("deposit.tiers"), role.campusReach.length, multiplier);
    return w.m.roles.acceptTerms(role.id, actor, { depositAmount });
  });
}
