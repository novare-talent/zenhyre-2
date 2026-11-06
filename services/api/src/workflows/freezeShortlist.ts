import { SYSTEM } from "@zenhyre/roles";
import { AppDeps } from "../context";
import { inTx, notifyCompany, requireStaff, roleUrl, User } from "./tx";

/**
 * §3.3 freezeShortlist (`role.close_broadcast`, at `broadcast_closes_at`): applications close, ranks freeze, the role
 * moves to `shortlist_ready` and the company is told. A no-op if the role has left `broadcast` or its window is still
 * open; staff can close a window early, which is audited.
 */
export async function freezeShortlist(deps: AppDeps, input: { roleId: string; user?: User; note?: string }) {
  const staff = input.user ? requireStaff(input.user) : null;
  return inTx(deps, async (w) => {
    if (!(await w.m.roles.get(input.roleId))) return { frozen: false as const, reason: "not in broadcast" };
    const role = await w.m.roles.lock(input.roleId);
    if (role.status !== "broadcast") return { frozen: false as const, reason: "not in broadcast" };
    const due = !!role.broadcastClosesAt && role.broadcastClosesAt.getTime() <= deps.clock.now().getTime();
    if (!due && !staff) return { frozen: false as const, reason: "broadcast window still open" };
    const { shortlisted } = await w.m.matching.freeze(role);
    const updated = await w.m.roles.transition(role.id, "shortlist_ready", staff ?? SYSTEM, due ? "broadcast window closed" : input.note?.trim() || "closed early by staff");
    if (staff) await w.m.ops.audit(input.user!.id, "role.broadcast.close", "role", role.id, input.note);
    notifyCompany(w, role.companyId, "shortlist_ready", { roleTitle: role.title, count: shortlisted, url: roleUrl(deps, role.id) });
    return { frozen: true as const, shortlisted, role: updated };
  });
}
