import { AppDeps } from "../context";
import { CreateCandidateInput } from "@zenhyre/identity";

/** §3.3 signUpCandidate: identity + ops (roll-number flag / association-scoped verification item). One transaction. */
export async function signUpCandidate(deps: AppDeps, input: CreateCandidateInput) {
  return deps.db.transaction(async (tx) => {
    const identity = deps.identity.withDb(tx);
    const ops = deps.ops.withDb(tx);
    const c = await identity.createCandidate(input);
    if (c.rollNumberFlag) {
      await ops.openReview({ kind: "verification", refType: "candidate", refId: c.userId, associationId: null,
        payload: { reason: "roll_number_mismatch", rollNumber: c.rollNumber } });
    }
    if (c.verificationState === "verification_pending") {
      const assoc = await identity.associationForCampus(c.campusId);
      await ops.openReview({ kind: "verification", refType: "candidate", refId: c.userId, associationId: assoc?.id ?? null,
        payload: { claimed: c.profile.claimed ?? {}, attempt: c.verificationAttempts } });
    }
    return c;
  });
}
