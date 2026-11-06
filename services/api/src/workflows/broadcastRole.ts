import { candidateFilters, type MatchingCandidate } from "@zenhyre/matching";
import { AppDeps } from "../context";
import { inTx, notifyUser } from "./tx";

/**
 * §3.3 broadcastRole (job, on entry to `broadcast`): filter the matchable candidates (§8 step 2), score them, write the
 * `scored` matches and nudge the top `nudge_cap`. A no-op if the role has left `broadcast`. Safe to retry.
 */
export async function broadcastRole(deps: AppDeps, input: { roleId: string }) {
  return inTx(deps, async (w) => {
    const role = await w.m.roles.get(input.roleId);
    if (!role || role.status !== "broadcast") return { scored: 0, nudged: 0 };
    const byId = new Map<string, MatchingCandidate>();
    for (const f of candidateFilters(role)) for (const c of await w.m.identity.listMatchableCandidates(f)) byId.set(c.userId, c);
    const out = await w.m.matching.broadcast(role, [...byId.values()], { pool: await w.m.ops.config.get("match.rerank_pool") });
    const company = await w.m.identity.getCompany(role.companyId);
    for (const userId of out.nudged) {
      notifyUser(w, userId, "role_nudge", { roleTitle: role.title, companyName: company?.name ?? "A company", url: `${deps.baseUrl}/candidate` });
    }
    return { scored: out.scored, nudged: out.nudged.length };
  });
}
