import { Hono } from "hono";
import { z } from "zod";
import { DomainError } from "@zenhyre/shared";
import { REJECTION_CATEGORIES } from "@zenhyre/matching";
import type { Role } from "@zenhyre/roles";
import { AppDeps, Vars } from "../context";
import { requireUser } from "../middleware/auth";
import { submitRole } from "../workflows/submitRole";
import { appealRole } from "../workflows/appealRole";
import { acceptTerms } from "../workflows/acceptTerms";
import { withdrawRole } from "../workflows/withdrawRole";
import { companyAction, COMPANY_STAGES } from "../workflows/companyAction";
import { companyRoleView, publicCampuses, resolveCampusIds, shortlistRowView, uuidParam } from "./views";

/** The company seat: post a role, follow it through the gate and terms, then work the shortlist. */
export const roleRoutes = new Hono<{ Variables: Vars }>();
// Prefix-scoped guards, as in the other route files: they do not leak onto other groups mounted on the same parent.
roleRoutes.use("/companies/*", requireUser);
roleRoutes.use("/roles/*", requireUser);
roleRoutes.use("/matches/*", requireUser);

const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const content = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.enum(["intern", "fresher", "experienced"]),
  jd: z.string().max(20_000),
  ctcMin: money.nullable(), ctcMax: money.nullable(),
  yearsExpMin: z.number().min(0).max(60), yearsExpMax: z.number().min(0).max(60),
  locations: z.array(z.string().trim().min(1).max(100)).max(20),
  /** Campus ids or short codes. */
  campusReach: z.array(z.string().min(1)).max(100),
});
const createBody = content.partial().required({ title: true, type: true });
const patchBody = content.partial();

type Ctx = { var: Vars };
/** Staff, or an unlocked member of the company. */
async function requireCompanyAccess(c: Ctx, companyId: string) {
  if (!c.var.user!.isStaff) await c.var.deps.identity.requireActiveMember(c.var.user!.id, companyId);
}
async function loadRole(c: Ctx, id: string): Promise<Role> {
  const role = await c.var.deps.roles.require(uuidParam(id, "role"));
  await requireCompanyAccess(c, role.companyId);
  return role;
}
async function view(deps: AppDeps, role: Role) {
  const [gate, counts, events] = await Promise.all([deps.roles.finalGateDecision(role), deps.matching.applicantCounts([role.id]), deps.roles.events(role.id)]);
  return companyRoleView(role, { gate, applicants: counts[role.id] ?? 0, appealed: events.some((e) => e.fromStatus === "rejected" && e.toStatus === "gated") });
}

roleRoutes.post("/companies/:id/roles", async (c) => {
  const companyId = uuidParam(c.req.param("id"), "company");
  await requireCompanyAccess(c, companyId);
  const body = createBody.parse(await c.req.json());
  const { deps } = c.var;
  const role = await deps.roles.create({
    companyId, createdBy: c.var.user!.id,
    content: { ...body, ...(body.campusReach ? { campusReach: await resolveCampusIds(deps, body.campusReach) } : {}) },
    shortlistCap: await deps.ops.config.get("match.shortlist_cap"), nudgeCap: await deps.ops.config.get("match.nudge_cap"),
  });
  return c.json({ role: await view(deps, role) }, 201);
});

roleRoutes.get("/companies/:id/roles", async (c) => {
  const companyId = uuidParam(c.req.param("id"), "company");
  await requireCompanyAccess(c, companyId);
  const { deps } = c.var;
  const roles = await deps.roles.listForCompany(companyId);
  return c.json({ roles: await Promise.all(roles.map((r) => view(deps, r))) });
});

roleRoutes.get("/roles/:id", async (c) => c.json({ role: await view(c.var.deps, await loadRole(c, c.req.param("id"))) }));

roleRoutes.patch("/roles/:id", async (c) => {
  const role = await loadRole(c, c.req.param("id"));
  const body = patchBody.parse(await c.req.json());
  const { deps } = c.var;
  // A company edits its role only while it is a draft; roles.update allows a gated reach change, which is for staff.
  if (role.status !== "draft") throw new DomainError("not_editable", `A ${role.status} role can no longer be edited.`, 409);
  const updated = await deps.roles.update(role.id, { ...body, ...(body.campusReach ? { campusReach: await resolveCampusIds(deps, body.campusReach) } : {}) });
  return c.json({ role: await view(deps, updated) });
});

roleRoutes.post("/roles/:id/submit", async (c) => {
  const { deps } = c.var;
  const role = await submitRole(deps, { roleId: uuidParam(c.req.param("id"), "role"), user: c.var.user! });
  // The gate job has usually run by now (it is instant on a rules reject), so return the role as it stands.
  return c.json({ role: await view(deps, (await deps.roles.get(role.id))!) });
});

roleRoutes.post("/roles/:id/appeal", async (c) => {
  const body = z.object({ note: z.string().max(2000).optional() }).parse(await c.req.json().catch(() => ({})));
  const role = await appealRole(c.var.deps, { roleId: uuidParam(c.req.param("id"), "role"), user: c.var.user!, note: body.note });
  return c.json({ role: await view(c.var.deps, role) });
});

roleRoutes.post("/roles/:id/terms/accept", async (c) => {
  const role = await acceptTerms(c.var.deps, { roleId: uuidParam(c.req.param("id"), "role"), user: c.var.user! });
  return c.json({ role: await view(c.var.deps, role) });
});

/** §5: a company (or staff) withdraws a role from any open state. `closing` and terminal roles refuse with a 409. */
roleRoutes.post("/roles/:id/withdraw", async (c) => {
  const body = z.object({ note: z.string().max(2000).optional() }).parse(await c.req.json().catch(() => ({})));
  const role = await withdrawRole(c.var.deps, { roleId: uuidParam(c.req.param("id"), "role"), user: c.var.user!, note: body.note });
  return c.json({ role: await view(c.var.deps, role) });
});

/** §8: the shortlist is not visible to the company before `shortlist_ready`. The longlist below the line is staff-only. */
roleRoutes.get("/roles/:id/shortlist", async (c) => {
  const role = await loadRole(c, c.req.param("id"));
  if (!["shortlist_ready", "closing", "closed"].includes(role.status)) {
    throw new DomainError("shortlist_not_ready", "The shortlist is shown once the broadcast window closes.", 409);
  }
  const { deps } = c.var;
  const matches = await deps.matching.listShortlist(role.id);
  const [candidates, campuses] = await Promise.all([deps.identity.listCandidatesByIds(matches.map((m) => m.candidateId)), publicCampuses(deps)]);
  const byId = new Map(candidates.map((x) => [x.userId, x]));
  return c.json({
    role: await view(deps, role),
    shortlist: matches.map((m) => shortlistRowView(m, byId.get(m.candidateId), campuses.get(byId.get(m.candidateId)?.campusId ?? ""))),
  });
});

const actionBody = z.object({
  stage: z.enum(COMPANY_STAGES),
  offeredCtc: money.positive().optional(), hiredCtc: money.positive().optional(),
  joinedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  rejectionCategory: z.enum(REJECTION_CATEGORIES).optional(), rejectionNote: z.string().max(2000).optional(),
});
/** Every company stage action (§8 company view) goes through `companyAction`. */
roleRoutes.post("/matches/:id/actions", async (c) => {
  const { stage, ...data } = actionBody.parse(await c.req.json());
  const { deps } = c.var;
  const out = await companyAction(deps, { matchId: uuidParam(c.req.param("id"), "match"), user: c.var.user!, stage, data });
  const [candidate] = await deps.identity.listCandidatesByIds([out.match.candidateId]);
  const campuses = await publicCampuses(deps);
  return c.json({ match: shortlistRowView(out.match, candidate, campuses.get(candidate?.campusId ?? "")), role: await view(deps, out.role) });
});
