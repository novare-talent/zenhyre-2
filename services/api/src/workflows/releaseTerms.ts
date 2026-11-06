import type { FeeTerms } from "@zenhyre/roles";
import { AppDeps } from "../context";
import { inTx, notifyCompany, requireStaff, roleUrl, User } from "./tx";

/** Staff edit the prefilled terms before (or after) release, until the company accepts (§7). */
export async function editFeeTerms(deps: AppDeps, input: { roleId: string; user: User; terms: FeeTerms }) {
  requireStaff(input.user);
  return inTx(deps, async (w) => {
    const role = await w.m.roles.setFeeTerms(input.roleId, input.terms);
    await w.m.ops.audit(input.user.id, "role.fee_terms.edit", "role", role.id);
    return role;
  });
}

/**
 * §3.3 releaseTerms: shows the terms to the company. Called by staff, or with no user by `role.terms_auto_release`
 * 48 hours after acceptance. Releasing twice is a no-op and notifies nobody.
 */
export async function releaseTerms(deps: AppDeps, input: { roleId: string; user?: User }) {
  if (input.user) requireStaff(input.user);
  return inTx(deps, async (w) => {
    const { role, released } = await w.m.roles.releaseTerms(input.roleId);
    if (released) {
      notifyCompany(w, role.companyId, "terms_released", { roleTitle: role.title, url: roleUrl(deps, role.id) });
      if (input.user) await w.m.ops.audit(input.user.id, "role.fee_terms.release", "role", role.id);
    }
    return role;
  });
}
