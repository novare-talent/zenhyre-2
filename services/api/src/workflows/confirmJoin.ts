import { DomainError, NotFound } from "@zenhyre/shared";
import { AppDeps } from "../context";
import { DAY_MS, inTx, notifyCompany, notifyUser, requireStaff, User } from "./tx";
import { didNotJoinTx, openJoinDispute } from "./didNotJoin";

// §9.2 Joining. A recorded hire is asked "did you join?" once its joining date has come. Yes confirms it; silence for
// `fee.join_grace_days` confirms it; no opens a `join_dispute` the company has `fee.join_dispute_days` to contest, after
// which the hire is reversed. A contested dispute waits for staff. The `candidate.joined` trust event arrives in Slice 3.

const notOpen = (msg: string) => new DomainError("not_actionable", msg, 409);

/** `role.join_prompt`: sends `did_you_join` on `max(joined_on, hired_at)`, once per hire. */
export async function joinPrompt(deps: AppDeps, input: { roleId: string }) {
  return inTx(deps, async (w) => {
    const role = await w.m.roles.lock(input.roleId);
    if (role.status !== "closing" || !role.hiredMatchId || !role.hiredAt) return { sent: false as const };
    const match = await w.m.matching.require(role.hiredMatchId);
    if (match.stage !== "hired" || match.joinPromptSentAt || match.joinConfirmedAt || !match.joinedOn) return { sent: false as const };
    const due = Math.max(new Date(match.joinedOn + "T00:00:00Z").getTime(), role.hiredAt.getTime());
    if (deps.clock.now().getTime() < due || !(await w.m.matching.markJoinPromptSent(match.id))) return { sent: false as const };
    const company = await w.m.identity.getCompany(role.companyId);
    notifyUser(w, match.candidateId, "did_you_join", { roleTitle: role.title, companyName: company?.name ?? "the company", url: `${deps.baseUrl}/candidate` });
    return { sent: true as const };
  });
}

/** The hired candidate answers the prompt. Yes confirms the joining; no opens a dispute and the company is told. */
export async function answerJoin(deps: AppDeps, input: { matchId: string; userId: string; joined: boolean }) {
  return inTx(deps, async (w) => {
    const seen = await w.m.matching.get(input.matchId);
    // Someone else's application is indistinguishable from one that does not exist.
    if (!seen || seen.candidateId !== input.userId || !seen.appliedAt) throw new NotFound("application");
    const role = await w.m.roles.lock(seen.roleId);
    const match = await w.m.matching.require(seen.id);
    if (match.stage !== "hired" || !match.joinPromptSentAt) throw notOpen("There is no joining question to answer on this application.");
    if (match.joinConfirmedAt) throw notOpen("Your joining is already confirmed.");
    if (await openJoinDispute(w, match.id)) throw notOpen("You have already answered; the company has been asked to respond.");
    if (input.joined) return w.m.matching.confirmJoin(match.id, "candidate", { kind: "candidate", userId: input.userId });
    // The grace period is a deadline, not just the hour the nightly job happens to run: a late "no" cannot reopen it.
    if (deps.clock.now().getTime() >= match.joinPromptSentAt.getTime() + (await w.m.ops.config.get("fee.join_grace_days")) * DAY_MS) {
      throw notOpen("The time to answer has passed, so your joining is taken as confirmed.");
    }
    await w.m.ops.openReview({ kind: "join_dispute", refType: "match", refId: match.id, associationId: null,
      payload: { roleId: role.id, roleTitle: role.title, companyId: role.companyId, candidateId: match.candidateId,
        disputedAt: deps.clock.now().toISOString(), companyConfirmedAt: null } });
    // Candidates have no name on record yet, so the hire is named by its role.
    notifyCompany(w, role.companyId, "join_disputed", { candidateName: `the hire for ${role.title}`, roleTitle: role.title });
    return match;
  });
}

/**
 * The company's reply to a dispute when it stands by the hire: the dispute then waits for staff instead of running
 * out. (Agreeing is the ordinary "did not join" action, which closes the dispute itself.)
 */
export async function companyConfirmJoin(deps: AppDeps, input: { matchId: string; user: User }) {
  return inTx(deps, async (w) => {
    const seen = await w.m.matching.require(input.matchId);
    const role = await w.m.roles.lock(seen.roleId);
    await w.m.identity.requireActiveMember(input.user.id, role.companyId);
    const dispute = await openJoinDispute(w, seen.id);
    if (!dispute) throw notOpen("There is no open joining dispute on this hire.");
    // Likewise the company's window: once it has run out, silence has already decided (§9.2) and `role.join_grace` reverses the hire.
    const disputedAt = (dispute.payload as { disputedAt?: string }).disputedAt;
    if (disputedAt && deps.clock.now().getTime() >= new Date(disputedAt).getTime() + (await w.m.ops.config.get("fee.join_dispute_days")) * DAY_MS) {
      throw notOpen("The time to contest this has passed.");
    }
    await w.m.ops.amendReview(dispute.id, { companyConfirmedAt: deps.clock.now().toISOString(), companyConfirmedBy: input.user.id });
    return { ok: true as const };
  });
}

/** Staff settle a dispute: the hire joined (`join_confirmed_by = staff`), or did not (`didNotJoin`). */
export async function resolveJoinDispute(deps: AppDeps, input: { reviewId: string; user: User; resolution: "joined" | "did_not_join"; note?: string }) {
  requireStaff(input.user);
  return inTx(deps, async (w) => {
    const item = await w.m.ops.getReview(input.reviewId);
    if (!item || item.kind !== "join_dispute") throw new NotFound("join dispute");
    const role = await w.m.roles.lock((await w.m.matching.require(item.refId)).roleId);
    const match = await w.m.matching.require(item.refId);
    const by = `staff:${input.user.id}`;
    // The hire may have been reversed or confirmed since the item was opened: then there is nothing left to settle.
    if (item.resolvedAt || match.stage !== "hired" || match.joinConfirmedAt || role.hiredMatchId !== match.id) {
      await w.m.ops.resolveReview(item.id, by, "noop");
      return { outcome: "noop" as const };
    }
    if (input.resolution === "joined") {
      await w.m.matching.confirmJoin(match.id, "staff", { kind: "staff", userId: input.user.id });
      await w.m.ops.resolveReview(item.id, by, "joined");
    } else {
      await didNotJoinTx(w, { role, user: input.user, asStaff: true });
    }
    await w.m.ops.audit(input.user.id, `join_dispute.${input.resolution}`, "match", match.id, input.note?.trim() || undefined);
    return { outcome: input.resolution };
  });
}

/**
 * `role.join_grace`: what time settles. No answer for `fee.join_grace_days` after the prompt confirms the joining
 * (`by = grace`). A dispute the company has neither contested nor agreed to for `fee.join_dispute_days` reverses the
 * hire. A contested dispute is left for staff.
 */
export async function joinGrace(deps: AppDeps, input: { roleId: string }) {
  const none = { outcome: "none" as const };
  return inTx(deps, async (w) => {
    const role = await w.m.roles.lock(input.roleId);
    if (role.status !== "closing" || !role.hiredMatchId) return none;
    const match = await w.m.matching.require(role.hiredMatchId);
    if (match.stage !== "hired" || !match.joinPromptSentAt || match.joinConfirmedAt) return none;
    const now = deps.clock.now().getTime();
    const dispute = await openJoinDispute(w, match.id);
    if (dispute) {
      const p = dispute.payload as { disputedAt?: string; companyConfirmedAt?: string | null };
      if (p.companyConfirmedAt || !p.disputedAt) return none;
      if (now < new Date(p.disputedAt).getTime() + (await w.m.ops.config.get("fee.join_dispute_days")) * DAY_MS) return none;
      await didNotJoinTx(w, { role });
      return { outcome: "did_not_join" as const };
    }
    if (now < match.joinPromptSentAt.getTime() + (await w.m.ops.config.get("fee.join_grace_days")) * DAY_MS) return none;
    await w.m.matching.confirmJoin(match.id, "grace", { kind: "system" });
    return { outcome: "confirmed" as const };
  });
}
