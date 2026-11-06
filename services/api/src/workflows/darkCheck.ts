import { SYSTEM } from "@zenhyre/roles";
import { AppDeps } from "../context";
import { DAY_MS, inTx } from "./tx";
import { resolveDepositTx } from "./resolveDeposit";

/**
 * `role.dark_check` (§5, §18): a `shortlist_ready` role with no hire `deposit.dark_days` after `shortlist_ready_at`
 * is abandoned. It moves to `closing` and its deposit is resolved (§9.1); Slice 1 holds no deposit, so the role
 * reaches `closed` in the same transaction. A no-op if a hire was recorded, the role was withdrawn, or a reopen
 * restarted the clock in the meantime.
 */
export async function darkCheck(deps: AppDeps, input: { roleId: string }) {
  return inTx(deps, async (w) => {
    const role = await w.m.roles.lock(input.roleId);
    const days = await w.m.ops.config.get("deposit.dark_days");
    const due = role.status === "shortlist_ready" && !role.hiredMatchId && !!role.shortlistReadyAt
      && role.shortlistReadyAt.getTime() + days * DAY_MS <= deps.clock.now().getTime();
    if (!due) return { abandoned: false as const };
    const closing = await w.m.roles.transition(role.id, "closing", SYSTEM, `no hire ${days} days after the shortlist`);
    const out = await resolveDepositTx(w, { role: closing, note: "no deposit held" });
    return { abandoned: true as const, role: out.role };
  });
}
