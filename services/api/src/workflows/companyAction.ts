import { DomainError, Invalid } from "@zenhyre/shared";
import type { MatchStage, StageData } from "@zenhyre/matching";
import { AppDeps } from "../context";
import { inTx, notifyUser, roleContext, User } from "./tx";
import { recordHireTx } from "./recordHire";
import { didNotJoinTx } from "./didNotJoin";

/** The stages a company can move a match to (§8 company view). */
export const COMPANY_STAGES = ["viewed", "interviewed", "offered", "offer_accepted", "offer_reneged", "hired", "rejected", "did_not_join", "left_early"] as const;
export type CompanyStage = (typeof COMPANY_STAGES)[number];
/** §11: the candidate hears about these company moves. `viewed` is silent. */
const TELL_CANDIDATE: readonly MatchStage[] = ["interviewed", "offered", "rejected"];

/**
 * §3.3 companyAction: every company stage action, in one transaction. `matching.setStage` enforces the §4.3 table,
 * the role precondition and the one-hire rule; `hired` and `did_not_join` are delegated to their workflows.
 * Trust writes (`interview_no_show`, `offer_reneged`) arrive in Slice 3.
 */
export async function companyAction(deps: AppDeps, input: { matchId: string; user: User; stage: CompanyStage; data?: StageData }) {
  if (!COMPANY_STAGES.includes(input.stage)) throw new Invalid(`a company cannot move a candidate to ${input.stage}`);
  return inTx(deps, async (w) => {
    const match = await w.m.matching.require(input.matchId);
    const role = await w.m.roles.lock(match.roleId);
    // Staff do not act on a company's shortlist: only an unlocked member of the role's company may.
    await w.m.identity.requireActiveMember(input.user.id, role.companyId);
    const data = input.data ?? {};
    if (input.stage === "hired") return recordHireTx(w, { match, role, user: input.user, data });
    if (input.stage === "did_not_join") return didNotJoinTx(w, { role, user: input.user, matchId: match.id });
    if (input.stage === "left_early") {
      // leftEarly creates a replacement role (§9.2); moving the stage without it would strand the guarantee.
      throw new DomainError("not_supported", "Marking a hire as left early is not available yet.", 409);
    }
    const moved = await w.m.matching.setStage(match.id, input.stage, { kind: "company", userId: input.user.id }, data, roleContext(role));
    if (TELL_CANDIDATE.includes(input.stage)) notifyUser(w, moved.candidateId, "stage_changed", { roleTitle: role.title, stage: input.stage });
    return { match: moved, role };
  });
}
