import { Forbidden } from "@zenhyre/shared";
import { AppDeps } from "../context";
import { inTx, notifyUser } from "./tx";

/**
 * §3.3 applyToRole: the candidate's match moves to `applied` and the shortlist is re-ranked; a higher score displaces
 * the lowest (§8 step 5). A restricted candidate waits in `pending_approval` behind a `candidate_approval` item.
 * Newly shortlisted candidates are told; displaced ones are not (§11).
 */
export async function applyToRole(deps: AppDeps, input: { roleId: string; userId: string }) {
  return inTx(deps, async (w) => {
    const role = await w.m.roles.lock(input.roleId);
    const candidate = await w.m.identity.getCandidate(input.userId);
    if (!candidate) throw new Forbidden("only candidates can apply");
    const out = await w.m.matching.apply(role, candidate);
    if (out.pendingApproval) {
      await w.m.ops.openReview({ kind: "candidate_approval", refType: "match", refId: out.match.id, associationId: null,
        payload: { roleId: role.id, roleTitle: role.title, candidateId: candidate.userId } });
    }
    notifyUser(w, candidate.userId, "application_received", { roleTitle: role.title });
    for (const m of out.promoted) notifyUser(w, m.candidateId, "stage_changed", { roleTitle: role.title, stage: "shortlisted" });
    return out.match;
  });
}
