import { IllegalTransition, NotFound } from "@zenhyre/shared";
import { withdrawTarget } from "@zenhyre/matching";
import { AppDeps } from "../context";
import { inTx, notifyCompany, notifyUser } from "./tx";

/**
 * §3.3 candidateWithdraw: `withdrawn` from most stages, `offer_reneged` once an offer was accepted (§4.3). During
 * broadcast the freed seat is refilled by the next-best applicant. The company is told only when the candidate was on
 * a shortlist it can see. The `offer_reneged` trust event arrives in Slice 3.
 */
export async function candidateWithdraw(deps: AppDeps, input: { matchId: string; userId: string }) {
  return inTx(deps, async (w) => {
    const match = await w.m.matching.get(input.matchId);
    // Someone else's application is indistinguishable from one that does not exist.
    if (!match || match.candidateId !== input.userId || !match.appliedAt) throw new NotFound("application");
    const role = await w.m.roles.lock(match.roleId);
    const target = withdrawTarget(match.stage);
    if (!target) throw new IllegalTransition(match.stage, "withdrawn");
    const moved = await w.m.matching.setStage(match.id, target, { kind: "candidate", userId: input.userId });
    const { promoted } = await w.m.matching.rerank(role);
    for (const m of promoted) notifyUser(w, m.candidateId, "stage_changed", { roleTitle: role.title, stage: "shortlisted" });
    const visibleToCompany = match.rank !== null && (role.status === "shortlist_ready" || role.status === "closing");
    if (visibleToCompany) notifyCompany(w, role.companyId, "stage_changed", { roleTitle: role.title, stage: target });
    return moved;
  });
}
