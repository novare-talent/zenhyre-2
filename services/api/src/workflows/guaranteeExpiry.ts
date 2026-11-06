import { guaranteeEndsAt } from "@zenhyre/matching";
import { AppDeps } from "../context";
import { inTx } from "./tx";
import { closeRoleTx } from "./closeRole";

/**
 * §3.3 guaranteeExpiry (`role.guarantee_expiry`): a `closing` role with a hire moves to `closed` once the replacement
 * guarantee, `joined_on + fee_terms.replacement_guarantee_days`, has ended. Until that instant the company can still
 * reverse the hire or mark it left early, so the role holds.
 *
 * A hire whose joining is not confirmed (`join_confirmed_at` null) is skipped. That also covers an open
 * `join_dispute`, which only ever exists on an unconfirmed hire. `confirmJoin` settles every hire one way or the
 * other (the candidate's answer, the grace period, or staff), so the hold always ends.
 */
export async function guaranteeExpiry(deps: AppDeps, input: { roleId: string }) {
  const skip = (reason: string) => ({ closed: false as const, reason });
  return inTx(deps, async (w) => {
    const role = await w.m.roles.lock(input.roleId);
    if (role.status !== "closing" || !role.hiredMatchId) return skip("not closing on a hire");
    const match = await w.m.matching.require(role.hiredMatchId);
    const days = role.feeTerms?.replacement_guarantee_days;
    // A recorded hire always carries both; without them the role would sit in `closing` unnoticed, so fail loudly.
    if (!match.joinedOn || days === undefined) throw new Error("guaranteeExpiry: the hire has no joining date or the role no guarantee period");
    if (deps.clock.now().getTime() <= guaranteeEndsAt(match.joinedOn, days).getTime()) return skip("guarantee still running");
    if (!match.joinConfirmedAt) return skip("joining not confirmed");
    const out = await closeRoleTx(w, { role, note: `${days}-day replacement guarantee ended` });
    return { closed: true as const, role: out.role };
  });
}
