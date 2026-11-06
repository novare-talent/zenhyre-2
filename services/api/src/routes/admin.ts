import { Hono } from "hono";
import { z } from "zod";
import { Vars } from "../context";
import { requireUser, requireStaff } from "../middleware/auth";
import { resolveVerification, VerificationResolution } from "../workflows/resolveVerification";
import { gateDecision } from "../workflows/gateDecision";
import { resolveCampusIds } from "./views";
import { ConfigKey, CONFIG } from "@zenhyre/ops";
import { assertFreeFor } from "../oneRole";

export const adminRoutes = new Hono<{ Variables: Vars }>();
adminRoutes.use("/admin/*", requireUser, requireStaff);

adminRoutes.get("/admin/reviews", async (c) => {
  const kind = c.req.query("kind") as any;
  const escapeHatchDays = c.req.query("escapeHatchDays") !== undefined ? Number(c.req.query("escapeHatchDays")) : await c.var.deps.ops.config.get("identity.escape_hatch_days");
  const adminlessAssociationIds = kind === "verification" ? await c.var.deps.identity.associationIdsWithoutAdmins() : undefined;
  const items = await c.var.deps.ops.listReviews({ kind, open: true, staffQueue: kind === "verification", escapeHatchDays, adminlessAssociationIds });
  return c.json({ items });
});

adminRoutes.post("/admin/reviews/:id/resolve", async (c) => {
  const body = z.object({ resolution: z.string(), note: z.string().optional(), campusReach: z.array(z.string().min(1)).optional() }).parse(await c.req.json());
  const item = await c.var.deps.ops.getReview(c.req.param("id"));
  if (!item) return c.json({ error: "not found" }, 404);
  if (item.kind === "verification") {
    const resolution = VerificationResolution.parse(body.resolution);
    await resolveVerification(c.var.deps, { reviewId: item.id, actor: { id: c.var.user!.id, isStaff: true }, resolution, note: body.note });
  } else if (item.kind === "gate") {
    // §7 stage 3: staff accept (optionally adjusting the reach) or reject with a reason. The workflow closes the item.
    const outcome = z.enum(["accept", "reject"]).parse(body.resolution);
    const campusReach = body.campusReach ? await resolveCampusIds(c.var.deps, body.campusReach) : undefined;
    const result = await gateDecision(c.var.deps, { trigger: "staff", roleId: item.refId, user: c.var.user!, outcome, reason: body.note, campusReach });
    return c.json({ ok: true, outcome: result.outcome });
  } else {
    await c.var.deps.ops.resolveReview(item.id, `staff:${c.var.user!.id}`, body.resolution);
    await c.var.deps.ops.audit(c.var.user!.id, `review.${item.kind}.${body.resolution}`, item.refType, item.refId, body.note);
  }
  return c.json({ ok: true });
});

adminRoutes.get("/admin/config", async (c) => {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(CONFIG) as ConfigKey[]) out[k] = await c.var.deps.ops.config.get(k);
  return c.json(out);
});
adminRoutes.put("/admin/config/:key", async (c) => {
  const key = c.req.param("key") as ConfigKey;
  if (!(key in CONFIG)) return c.json({ error: "unknown key" }, 404);
  const { value } = z.object({ value: z.unknown() }).parse(await c.req.json());
  await c.var.deps.ops.config.set(key, value as any, `staff:${c.var.user!.id}`);
  await c.var.deps.ops.audit(c.var.user!.id, "config.set", "config", key);
  return c.json({ ok: true });
});

adminRoutes.post("/admin/associations", async (c) => {
  const body = z.object({ campusShortCode: z.string(), name: z.string(), shareRate: z.number().min(0).max(1).default(0.15), payoutMode: z.enum(["cash", "sponsorship_credit"]), adminEmails: z.array(z.string().email()).default([]) }).parse(await c.req.json());
  const { identity, notify, baseUrl } = c.var.deps;
  const campus = await identity.campusByShortCode(body.campusShortCode);
  if (!campus) return c.json({ error: "unknown campus" }, 404);
  if (await identity.associationForCampus(campus.id)) return c.json({ error: "campus already has an association" }, 409);
  for (const email of body.adminEmails) { // check every address before creating anything
    const existing = await identity.userIdForEmail(email);
    if (existing) await assertFreeFor(identity, existing, "association");
  }
  const assoc = await identity.createAssociation({ campusId: campus.id, name: body.name, shareRate: body.shareRate, payoutMode: body.payoutMode });
  for (const email of body.adminEmails) {
    await identity.grantAssociationAdmin({ associationId: assoc.id, invitedBy: c.var.user!.id, email });
    await notify.sendToEmail(email, "association_admin_invite", { associationName: assoc.name, url: `${baseUrl}/login?as=association` });
  }
  await c.var.deps.ops.audit(c.var.user!.id, "association.create", "association", assoc.id);
  return c.json({ association: assoc }, 201);
});
