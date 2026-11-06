import { AppDeps } from "../context";
import { inTx, requireStaff, User } from "./tx";

/**
 * §3.3 waiveDeposit: staff, with a note, move `deposit_pending → broadcast` with `deposit_mode = waived`. The broadcast
 * window opens now and closes `match.broadcast_days` later. No ledger entry: nothing was received (§9.1).
 */
export async function waiveDeposit(deps: AppDeps, input: { roleId: string; user: User; note: string }) {
  const actor = requireStaff(input.user);
  return inTx(deps, async (w) => {
    const role = await w.m.roles.waiveDeposit(input.roleId, actor, input.note, { broadcastDays: await w.m.ops.config.get("match.broadcast_days") });
    await w.m.ops.audit(input.user.id, "role.deposit.waive", "role", role.id, input.note);
    w.after(() => deps.jobs.enqueue("role.broadcast", { roleId: role.id }));
    return role;
  });
}
