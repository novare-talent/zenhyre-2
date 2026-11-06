import { Hono } from "hono";
import { z } from "zod";
import { ROLE_STATUSES, type RoleStatus } from "@zenhyre/roles";
import { Vars } from "../context";
import { requireUser, requireStaff } from "../middleware/auth";
import { editFeeTerms, releaseTerms } from "../workflows/releaseTerms";
import { waiveDeposit } from "../workflows/waiveDeposit";
import { freezeShortlist } from "../workflows/freezeShortlist";
import { extendBroadcast } from "../workflows/extendBroadcast";
import { ROLE_JOBS, SCHEDULED_JOBS, runRoleJob, type RoleJobName, type ScheduledJobName } from "../jobs";
import { uuidParam } from "./views";

/** Staff actions on roles (§12): fee terms, deposit waiver, closing a broadcast, and running jobs by hand until a scheduler is wired. */
export const adminRoleRoutes = new Hono<{ Variables: Vars }>();
adminRoleRoutes.use("/admin/*", requireUser, requireStaff);

adminRoleRoutes.get("/admin/roles", async (c) => {
  const status = z.enum(ROLE_STATUSES).optional().parse(c.req.query("status"));
  const { deps } = c.var;
  const roles = await deps.roles.listByStatus(status ?? ([...ROLE_STATUSES] as RoleStatus[]));
  const counts = await deps.matching.applicantCounts(roles.map((r) => r.id));
  return c.json({ roles: roles.map((r) => ({ ...r, applicants: counts[r.id] ?? 0 })) });
});

/** Everything about one role: the row, its history, its gate decisions and the full longlist (§8: staff see displaced applicants). */
adminRoleRoutes.get("/admin/roles/:id", async (c) => {
  const { deps } = c.var;
  const role = await deps.roles.require(uuidParam(c.req.param("id"), "role"));
  const [events, gateDecisions, applicants] = await Promise.all([deps.roles.events(role.id), deps.roles.gateDecisions(role.id), deps.matching.listApplicants(role.id)]);
  return c.json({ role, events, gateDecisions, applicants });
});

const feeTerms = z.object({
  kind: z.enum(["flat", "percent"]), amount: z.number().nonnegative(),
  replacement_guarantee_days: z.number().int().nonnegative(), notes: z.string().max(2000).optional(),
});
adminRoleRoutes.put("/admin/roles/:id/fee-terms", async (c) => {
  const terms = feeTerms.parse(await c.req.json());
  return c.json({ role: await editFeeTerms(c.var.deps, { roleId: uuidParam(c.req.param("id"), "role"), user: c.var.user!, terms }) });
});
adminRoleRoutes.post("/admin/roles/:id/release-terms", async (c) => {
  return c.json({ role: await releaseTerms(c.var.deps, { roleId: uuidParam(c.req.param("id"), "role"), user: c.var.user! }) });
});
adminRoleRoutes.post("/admin/roles/:id/waive-deposit", async (c) => {
  const { note } = z.object({ note: z.string().trim().min(1).max(2000) }).parse(await c.req.json());
  return c.json({ role: await waiveDeposit(c.var.deps, { roleId: uuidParam(c.req.param("id"), "role"), user: c.var.user!, note }) });
});
/** Once per role, while it has too few applicants: the broadcast closes `match.extension_days` later. */
adminRoleRoutes.post("/admin/roles/:id/extend-broadcast", async (c) => {
  const { note } = z.object({ note: z.string().max(2000).optional() }).parse(await c.req.json().catch(() => ({})));
  return c.json({ role: await extendBroadcast(c.var.deps, { roleId: uuidParam(c.req.param("id"), "role"), user: c.var.user!, note }) });
});
/** Freezes the shortlist now, whether or not the window has run its course. */
adminRoleRoutes.post("/admin/roles/:id/close-broadcast", async (c) => {
  const { note } = z.object({ note: z.string().trim().min(1).max(2000) }).parse(await c.req.json());
  const out = await freezeShortlist(c.var.deps, { roleId: uuidParam(c.req.param("id"), "role"), user: c.var.user!, note });
  return c.json(out, out.frozen ? 200 : 409);
});

/** Runs a scheduled job once (any name in `SCHEDULED_JOBS`), or re-runs a role job (`role.gate`, `role.broadcast`) for one role. */
adminRoleRoutes.post("/admin/jobs/:name/run", async (c) => {
  const name = c.req.param("name");
  const { deps } = c.var;
  if (name in SCHEDULED_JOBS) {
    const result = await SCHEDULED_JOBS[name as ScheduledJobName](deps);
    await deps.ops.audit(c.var.user!.id, "job.run", "job", name);
    return c.json({ job: name, ...result });
  }
  if (name in ROLE_JOBS) {
    const { roleId } = z.object({ roleId: z.string().uuid() }).parse(await c.req.json());
    const ok = await runRoleJob(deps, name, roleId, () => ROLE_JOBS[name as RoleJobName](deps, { roleId }));
    await deps.ops.audit(c.var.user!.id, "job.run", "role", roleId, name);
    return c.json({ job: name, roleId, ok }, ok ? 200 : 500);
  }
  return c.json({ error: "unknown job" }, 404);
});
