import { z } from "zod";
import { AppDeps } from "../context";
import { Forbidden, NotFound } from "@zenhyre/shared";

export const VerificationResolution = z.enum(["approve", "reject", "reject_fraud", "clear_flag"]);
export type VerificationResolution = z.infer<typeof VerificationResolution>;

/**
 * §3.3 resolveVerification: identity + ops + notify in one transaction. Trust (`profile_false`) is attached in Slice 3.
 * Note: notify.send runs inside the transaction here; Plan 1B moves email delivery to a post-commit job.
 */
export async function resolveVerification(deps: AppDeps, input: { reviewId: string; actor: { id: string; isStaff: boolean; associationId?: string }; resolution: VerificationResolution; note?: string }) {
  return deps.db.transaction(async (tx) => {
    const identity = deps.identity.withDb(tx), ops = deps.ops.withDb(tx), notify = deps.notify.withDb(tx);
    const item = await ops.getReview(input.reviewId);
    if (!item || item.kind !== "verification" || item.resolvedAt) throw new NotFound("open verification item");
    if (!input.actor.isStaff && item.associationId !== input.actor.associationId) throw new Forbidden("not your queue");
    const userId = item.refId;
    const by = input.actor.id; // §4.1: verified_by is a user id or "system"
    switch (input.resolution) {
      case "approve":
        await identity.verifyCandidate(userId, { by, source: input.actor.isStaff ? "staff" : "association" });
        await notify.send(userId, "verification_approved", {});
        break;
      case "reject":
      case "reject_fraud":
        await identity.rejectVerification(userId, { by, reason: input.note ?? "" });
        await notify.send(userId, "verification_rejected", { reason: input.note ?? "not verified" });
        break;
      case "clear_flag":
        await identity.clearRollNumberFlag(userId);
        break;
    }
    await ops.resolveReview(item.id, input.actor.isStaff ? `staff:${by}` : `association:${by}`, input.resolution);
    if (input.actor.isStaff) await ops.audit(input.actor.id, `verification.${input.resolution}`, "candidate", userId, input.note);
  });
}
