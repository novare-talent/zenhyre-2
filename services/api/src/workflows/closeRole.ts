import type { Match } from "@zenhyre/matching";
import { SYSTEM, TERMINAL_STATUSES, type Actor, type Role } from "@zenhyre/roles";
import { AppDeps } from "../context";
import { inTx, notifyCompany, notifyUser, Wf } from "./tx";

/**
 * Every open match on the role becomes `role_closed`; settled ones, `hired` included, are untouched (§4.3). Each
 * applicant whose match moved is told (§11). Candidates who were only scored or nudged never applied and hear nothing.
 * Safe to repeat: a second call finds nothing open.
 */
export async function closeMatchesTx(w: Wf, role: Pick<Role, "id" | "title">): Promise<Match[]> {
  const closed = await w.m.matching.closeOpenMatches(role.id);
  for (const m of closed) {
    if (m.appliedAt) notifyUser(w, m.candidateId, "stage_changed", { roleTitle: role.title, stage: "role_closed" });
  }
  return closed;
}

/**
 * §5 closeRole: the only path into `closed`, and the last step of a withdrawal. A `closing` role moves to `closed`
 * (the lifecycle table refuses any other live status), its open matches close, and the company is told. On a role that
 * is already terminal the status is left alone and the company is not told again: `withdrawRole` has said what there
 * is to say. Callers decide *when* a role may close (`guaranteeExpiry`, `resolveDeposit`); this only does it.
 */
export async function closeRoleTx(w: Wf, input: { role: Role; actor?: Actor; note?: string }) {
  const terminal = TERMINAL_STATUSES.includes(input.role.status);
  const role = terminal ? input.role : await w.m.roles.transition(input.role.id, "closed", input.actor ?? SYSTEM, input.note);
  const closedMatches = await closeMatchesTx(w, role);
  if (!terminal) notifyCompany(w, role.companyId, "role_closed", { roleTitle: role.title });
  return { role, closed: !terminal, closedMatches };
}

export async function closeRole(deps: AppDeps, input: { roleId: string; note?: string }) {
  return inTx(deps, async (w) => closeRoleTx(w, { role: await w.m.roles.lock(input.roleId), note: input.note }));
}
