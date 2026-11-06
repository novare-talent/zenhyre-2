import type { Match, MatchActor } from "@zenhyre/matching";
import type { Role } from "@zenhyre/roles";
import { AppDeps } from "../context";
import { inTx, notifyCompany, roleContext, User, Wf } from "./tx";

export interface HireData { hiredCtc?: number; joinedOn?: string }

/**
 * §9.2 recordHire, Slice 1: step 1 only. The match moves to `hired` (one hire per role, §4.3), the role records it
 * (`hired_match_id`, `hired_at`) and moves to `closing`. Ledger (fee, deposit) and trust steps arrive in Slices 2 and 3.
 * Other open matches stay open; the company may still reject them.
 */
export async function recordHireTx(w: Wf, input: { match: Match; role: Role; user: User; data: HireData }) {
  const actor: MatchActor = { kind: "company", userId: input.user.id };
  const match = await w.m.matching.setStage(input.match.id, "hired", actor, input.data, roleContext(input.role));
  const role = await w.m.roles.recordHire(input.role.id, match.id, { kind: "company", userId: input.user.id });
  notifyCompany(w, role.companyId, "hire_recorded", { roleTitle: role.title });
  return { match, role };
}

export async function recordHire(deps: AppDeps, input: { matchId: string; user: User } & HireData) {
  return inTx(deps, async (w) => {
    const match = await w.m.matching.require(input.matchId);
    const role = await w.m.roles.lock(match.roleId);
    await w.m.identity.requireActiveMember(input.user.id, role.companyId);
    return recordHireTx(w, { match, role, user: input.user, data: { hiredCtc: input.hiredCtc, joinedOn: input.joinedOn } });
  });
}
