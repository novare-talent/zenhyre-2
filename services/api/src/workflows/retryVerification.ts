import { AppDeps } from "../context";
/** Candidate re-requests verification after a rejection (§6.1, at most one retry). identity + ops in one transaction. */
export async function retryVerification(deps: AppDeps, userId: string) {
  return deps.db.transaction(async (tx) => {
    const identity = deps.identity.withDb(tx), ops = deps.ops.withDb(tx);
    const row = await identity.requestVerificationAgain(userId);
    const assoc = await identity.associationForCampus(row.campusId);
    await ops.openReview({ kind: "verification", refType: "candidate", refId: row.userId, associationId: assoc?.id ?? null,
      payload: { claimed: row.profile.claimed ?? {}, attempt: row.verificationAttempts } });
    return row;
  });
}
