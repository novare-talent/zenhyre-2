import { Hono } from "hono";
import { Forbidden, NotFound } from "@zenhyre/shared";
import { fitsType, listOpenRolesFor } from "@zenhyre/matching";
import { Vars } from "../context";
import { requireUser } from "../middleware/auth";
import { applyToRole } from "../workflows/applyToRole";
import { candidateWithdraw } from "../workflows/candidateWithdraw";
import { applicationView, candidateRoleView, uuidParam } from "./views";

/** The candidate seat: the roles open to me, applying, my applications, withdrawing. */
export const applicationRoutes = new Hono<{ Variables: Vars }>();
applicationRoutes.use("/me/*", requireUser);

type Ctx = { var: Vars };
async function me(c: Ctx) {
  const candidate = await c.var.deps.identity.getCandidate(c.var.user!.id);
  if (!candidate) throw new Forbidden("candidates only");
  return candidate;
}
async function companyNames(c: Ctx, companyIds: string[]) {
  const names = new Map<string, string>();
  for (const id of new Set(companyIds)) names.set(id, (await c.var.deps.identity.getCompany(id))?.name ?? "");
  return names;
}

/** §8 step 5: roles in broadcast whose reach includes my campus and whose type fits my status. */
applicationRoutes.get("/me/roles", async (c) => {
  const candidate = await me(c);
  const { deps } = c.var;
  const roles = listOpenRolesFor(candidate, await deps.roles.listByStatus("broadcast"));
  const [matches, names] = await Promise.all([deps.matching.listForCandidateOnRoles(candidate.userId, roles.map((r) => r.id)), companyNames(c, roles.map((r) => r.companyId))]);
  const byRole = new Map(matches.map((m) => [m.roleId, m]));
  const views = roles.map((r) => candidateRoleView(r, { companyName: names.get(r.companyId)!, match: byRole.get(r.id) ?? null }));
  // Nudged roles first, then the ones closing soonest.
  views.sort((a, b) => Number(b.nudged) - Number(a.nudged) || (a.broadcastClosesAt?.getTime() ?? 0) - (b.broadcastClosesAt?.getTime() ?? 0));
  return c.json({ roles: views });
});

/** One role: visible while it is open to me, and afterwards if I applied to it. */
applicationRoutes.get("/me/roles/:id", async (c) => {
  const candidate = await me(c);
  const { deps } = c.var;
  const role = await deps.roles.get(uuidParam(c.req.param("id"), "role"));
  const match = role ? await deps.matching.getFor(role.id, candidate.userId) : null;
  const openToMe = !!role && role.status === "broadcast" && role.campusReach.includes(candidate.campusId) && fitsType(role, candidate);
  if (!role || !(openToMe || match?.appliedAt)) throw new NotFound("role");
  return c.json({ role: candidateRoleView(role, { companyName: (await deps.identity.getCompany(role.companyId))?.name ?? "", match }) });
});

applicationRoutes.post("/me/roles/:id/apply", async (c) => {
  const candidate = await me(c);
  const { deps } = c.var;
  const match = await applyToRole(deps, { roleId: uuidParam(c.req.param("id"), "role"), userId: candidate.userId });
  const role = (await deps.roles.get(match.roleId))!;
  return c.json({ application: applicationView(match, role, (await deps.identity.getCompany(role.companyId))?.name ?? "") }, 201);
});

applicationRoutes.get("/me/applications", async (c) => {
  const candidate = await me(c);
  const { deps } = c.var;
  const matches = await deps.matching.listForCandidate(candidate.userId);
  const roles = new Map((await deps.roles.listByIds([...new Set(matches.map((m) => m.roleId))])).map((r) => [r.id, r]));
  const names = await companyNames(c, [...roles.values()].map((r) => r.companyId));
  return c.json({ applications: matches.map((m) => applicationView(m, roles.get(m.roleId)!, names.get(roles.get(m.roleId)!.companyId)!)) });
});

applicationRoutes.post("/me/applications/:id/withdraw", async (c) => {
  const candidate = await me(c);
  const { deps } = c.var;
  const match = await candidateWithdraw(deps, { matchId: uuidParam(c.req.param("id"), "application"), userId: candidate.userId });
  const role = (await deps.roles.get(match.roleId))!;
  return c.json({ application: applicationView(match, role, (await deps.identity.getCompany(role.companyId))?.name ?? "") });
});
