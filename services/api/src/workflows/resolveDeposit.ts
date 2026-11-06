import type { Actor, Role } from "@zenhyre/roles";
import { Wf } from "./tx";
import { closeRoleTx } from "./closeRole";

/**
 * §9.1 resolveDeposit: runs when a role enters `closing` without a hire, or `withdrawn`.
 * Slice 1 (§15) has no ledger and every deposit is waived, so `depositHeld = 0`: nothing is written, nothing is owed,
 * and the role goes straight to `closeRole` (`closing → closed`; a status no-op on `withdrawn`).
 * Slice 2 puts the §9.1 table here (refund, `deposit_resolution` item, `went_dark`) and reaches `closeRole` only when
 * nothing is held.
 */
export async function resolveDepositTx(w: Wf, input: { role: Role; actor?: Actor; note?: string }) {
  // Nothing in this slice writes `razorpay`. If something ever does, fail here rather than close a role over held money.
  if (input.role.depositMode === "razorpay") throw new Error("resolveDeposit: a Razorpay deposit cannot be resolved before the ledger exists");
  return closeRoleTx(w, input);
}
