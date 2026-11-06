import { DomainError } from "@zenhyre/shared";
import type { MatchActor } from "@zenhyre/matching";
import { SYSTEM, type Actor, type Role } from "@zenhyre/roles";
import { AppDeps } from "../context";
import { inTx, roleContext, User, Wf } from "./tx";

/**
 * §9.2 didNotJoin, Slice 1: steps 4–5 only. Requires a `closing` role with a recorded hire whose joining is not yet
 * confirmed. The hired match moves to `did_not_join`; the role reopens to `shortlist_ready` with the hire cleared and
 * the shortlist clock reset, so the company can hire another shortlisted candidate. The ledger reversals that precede
 * these steps arrive in Slice 2.
 */
export async function didNotJoinTx(w: Wf, input: { role: Role; user?: User; matchId?: string }) {
  const { role } = input;
  if (role.status !== "closing" || !role.hiredMatchId) throw new DomainError("not_actionable", "There is no recorded hire on this role to reverse.", 409);
  if (input.matchId && input.matchId !== role.hiredMatchId) throw new DomainError("not_actionable", "Only the hired candidate can be marked as did not join.", 409);
  const matchActor: MatchActor = input.user ? { kind: "company", userId: input.user.id } : { kind: "system" };
  const roleActor: Actor = input.user ? { kind: "company", userId: input.user.id } : SYSTEM;
  const match = await w.m.matching.setStage(role.hiredMatchId, "did_not_join", matchActor, {}, roleContext(role));
  const reopened = await w.m.roles.reopen(role.id, roleActor, "hire did not join");
  return { match, role: reopened };
}

/** Called by the company (with `user`), or with no user as the outcome of a join dispute (`confirmJoin`, Slice 2). */
export async function didNotJoin(deps: AppDeps, input: { roleId: string; user?: User }) {
  return inTx(deps, async (w) => {
    const role = await w.m.roles.lock(input.roleId);
    if (input.user) await w.m.identity.requireActiveMember(input.user.id, role.companyId);
    return didNotJoinTx(w, { role, user: input.user });
  });
}
