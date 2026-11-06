import type { Match } from "@zenhyre/matching";
import type { Role } from "@zenhyre/roles";
import { notifyCompany, roleContext, roleUrl, User, Wf } from "./tx";

/**
 * §9.2 leftEarly: the company reports that a confirmed hire left inside the replacement guarantee. The fee stands (no
 * ledger entries, in any slice); the match moves to `left_early` and a replacement role is created directly in
 * `broadcast` (§5) and broadcast after commit. The original role stays `closing` and closes through `guaranteeExpiry`.
 * `matching.setStage` refuses the move before the joining is confirmed or after the guarantee has ended.
 */
export async function leftEarlyTx(w: Wf, input: { match: Match; role: Role; user: User }) {
  const actor = { kind: "company" as const, userId: input.user.id };
  const match = await w.m.matching.setStage(input.match.id, "left_early", actor, {}, roleContext(input.role));
  const replacement = await w.m.roles.createReplacement(input.role.id, actor, { broadcastDays: await w.m.ops.config.get("match.broadcast_days") });
  w.after(() => w.deps.jobs.enqueue("role.broadcast", { roleId: replacement.id }));
  notifyCompany(w, input.role.companyId, "replacement_created", { roleTitle: input.role.title, url: roleUrl(w.deps, replacement.id) });
  return { match, role: input.role, replacement };
}
