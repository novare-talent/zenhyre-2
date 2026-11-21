import type { Match, MatchActor } from "@zenhyre/matching";
import type { Role } from "@zenhyre/roles";
import { AppDeps } from "../context";
import { inTx, notifyCompany, roleContext, User, Wf } from "./tx";
import { raiseFeeTx } from "./payments";

export interface HireData { hiredCtc?: number; joinedOn?: string }

/**
 * §9.2 recordHire. The match moves to `hired` (one hire per role, §4.3), the role records it (`hired_match_id`,
 * `hired_at`) and moves to `closing`, and the fee is raised with the deposit applied to it (`raiseFeeTx`); the company
 * is emailed the balance and a link to pay. The replacement guarantee runs from the joining date. Trust arrives in
 * Slice 3. Other open matches stay open; the company may still reject them.
 */
export async function recordHireTx(w: Wf, input: { match: Match; role: Role; user: User; data: HireData }) {
  const actor: MatchActor = { kind: "company", userId: input.user.id };
  const match = await w.m.matching.setStage(input.match.id, "hired", actor, input.data, roleContext(input.role));
  const role = await w.m.roles.recordHire(input.role.id, match.id, { kind: "company", userId: input.user.id });
  notifyCompany(w, role.companyId, "hire_recorded", { roleTitle: role.title });
  const fee = await raiseFeeTx(w, role, match);
  return { match, role, fee };
}

export async function recordHire(deps: AppDeps, input: { matchId: string; user: User } & HireData) {
  return inTx(deps, async (w) => {
    const match = await w.m.matching.require(input.matchId);
    const role = await w.m.roles.lock(match.roleId);
    await w.m.identity.requireActiveMember(input.user.id, role.companyId);
    return recordHireTx(w, { match, role, user: input.user, data: { hiredCtc: input.hiredCtc, joinedOn: input.joinedOn } });
  });
}
