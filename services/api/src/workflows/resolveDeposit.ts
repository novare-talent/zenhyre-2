import type { Actor, Role } from "@zenhyre/roles";
import { Wf } from "./tx";
import { closeRoleTx } from "./closeRole";
import { resolveHeldDepositTx } from "./payments";

/**
 * §9.1 resolveDeposit: runs when a role enters `closing` without a hire, or `withdrawn`. With nothing held (a waived
 * deposit, or one already settled) the role goes straight to `closeRole` (`closing → closed`; a status no-op on
 * `withdrawn`). With a paid deposit still held, `resolveHeldDepositTx` decides: an automatic refund for a role that
 * ended with no hire, a finance decision for a role withdrawn after going live. A `closing` role then waits for the
 * refund and closes once nothing is held (`payments.ts`); a `withdrawn` one is already terminal and only its matches
 * close.
 */
export async function resolveDepositTx(w: Wf, input: { role: Role; actor?: Actor; note?: string; reason?: string }) {
  const { held } = await resolveHeldDepositTx(w, input.role, input.reason ?? `Role ${input.role.status} with no hire`);
  if (held && input.role.status === "closing") return { role: input.role, closed: false, closedMatches: [] };
  return closeRoleTx(w, input);
}
