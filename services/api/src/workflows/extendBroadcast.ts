import { DomainError } from "@zenhyre/shared";
import { AppDeps } from "../context";
import { inTx, notifyCompany, requireStaff, User } from "./tx";

/**
 * §3.3 extendBroadcast: staff push a thin broadcast's close date out by `match.extension_days`, once, and only while
 * it has fewer than `match.extension_min_applicants` applicants (§5). The company is told the new date.
 */
export async function extendBroadcast(deps: AppDeps, input: { roleId: string; user: User; note?: string }) {
  requireStaff(input.user);
  return inTx(deps, async (w) => {
    const role = await w.m.roles.lock(input.roleId);
    const min = await w.m.ops.config.get("match.extension_min_applicants");
    const applicants = (await w.m.matching.applicantCounts([role.id]))[role.id] ?? 0;
    if (role.status === "broadcast" && applicants >= min) {
      throw new DomainError("not_extendable", `A broadcast is extended only below ${min} applicants; this one has ${applicants}.`, 409);
    }
    const extended = await w.m.roles.extendBroadcast(role.id, await w.m.ops.config.get("match.extension_days"));
    await w.m.ops.audit(input.user.id, "role.broadcast.extend", "role", role.id, input.note?.trim() || undefined);
    notifyCompany(w, role.companyId, "broadcast_extended", { roleTitle: role.title, closesAt: extended.broadcastClosesAt!.toISOString().slice(0, 10) });
    return extended;
  });
}
