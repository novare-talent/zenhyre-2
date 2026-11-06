import { guaranteeEndsAt } from "@zenhyre/matching";
import { AppDeps } from "../context";
import { inTx } from "./tx";
import { closeRoleTx } from "./closeRole";

/**
 * Whether a role may close only once its hire's joining is confirmed (`Match.join_confirmed_at`), as §3.3 specifies.
 *
 * Slice 1 says no. `confirmJoin` (the `did_you_join` prompt, the grace period, the dispute queue) is not built, so
 * nothing in this slice ever sets `join_confirmed_at`; requiring it would hold every hired role in `closing` for good
 * and §14's Slice-1 path, "waived through hire and guarantee expiry to closed", could not finish. Until then a hire
 * the company did not reverse with "did not join" at any point in the guarantee window counts as joined, which is the
 * reading §9.2's grace rule gives a candidate who never answers. The match's `join_confirmed_at` is left null: writing
 * it is `confirmJoin`'s job.
 *
 * When `confirmJoin` lands: set this to true, and skip a role with an open `join_dispute` in the same place.
 */
export const JOIN_CONFIRMATION_REQUIRED: boolean = false;

/**
 * §3.3 guaranteeExpiry (`role.guarantee_expiry`): a `closing` role with a hire moves to `closed` once the replacement
 * guarantee, `joined_on + fee_terms.replacement_guarantee_days`, has ended. Until that instant the company can still
 * reverse the hire, so the role holds. A no-op on any role that is not `closing` on a hire, or not yet due.
 */
export async function guaranteeExpiry(deps: AppDeps, input: { roleId: string; requireJoinConfirmation?: boolean }) {
  const skip = (reason: string) => ({ closed: false as const, reason });
  return inTx(deps, async (w) => {
    const role = await w.m.roles.lock(input.roleId);
    if (role.status !== "closing" || !role.hiredMatchId) return skip("not closing on a hire");
    const match = await w.m.matching.require(role.hiredMatchId);
    const days = role.feeTerms?.replacement_guarantee_days;
    // A recorded hire always carries both; without them the role would sit in `closing` unnoticed, so fail loudly.
    if (!match.joinedOn || days === undefined) throw new Error("guaranteeExpiry: the hire has no joining date or the role no guarantee period");
    if (deps.clock.now().getTime() <= guaranteeEndsAt(match.joinedOn, days).getTime()) return skip("guarantee still running");
    if ((input.requireJoinConfirmation ?? JOIN_CONFIRMATION_REQUIRED) && !match.joinConfirmedAt) return skip("joining not confirmed");
    const out = await closeRoleTx(w, { role, note: `${days}-day replacement guarantee ended` });
    return { closed: true as const, role: out.role };
  });
}
