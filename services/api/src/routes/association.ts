import { Hono } from "hono";
import { z } from "zod";
import { Forbidden, NotFound } from "@zenhyre/shared";
import { Vars } from "../context";
import { requireUser } from "../middleware/auth";
import { resolveVerification } from "../workflows/resolveVerification";

/**
 * The association seat (§6.1, §12): an association admin works the verification queue scoped to their association.
 * The queue shows name, claimed batch, branch and LinkedIn URL (§6.1). Staff use /admin/reviews instead.
 */
export const associationRoutes = new Hono<{ Variables: Vars }>();
associationRoutes.use("/association/*", requireUser);

async function myAssociationIds(c: { var: Vars }) {
  const mine = await c.var.deps.identity.associationsForUser(c.var.user!.id);
  if (!mine.length) throw new Forbidden("association admins only");
  return mine;
}

associationRoutes.get("/association/reviews", async (c) => {
  const { identity, ops } = c.var.deps;
  const mine = await myAssociationIds(c);
  const campuses = await identity.listCampuses();
  const items = [];
  for (const a of mine) {
    for (const it of await ops.listReviews({ kind: "verification", open: true, associationId: a.id })) {
      const cand = await identity.getCandidate(it.refId);
      const claimed = (cand?.profile.claimed ?? (it.payload as any).claimed ?? {}) as { batch?: string; branch?: string; linkedinUrl?: string };
      items.push({
        id: it.id, associationId: a.id, openedAt: it.openedAt,
        candidate: cand ? {
          name: cand.profile.name ?? null,
          campus: campuses.find((k) => k.id === cand.campusId)?.name ?? null,
          course: cand.course, gradDate: cand.gradDate,
          claimedBatch: claimed.batch ?? null, claimedBranch: claimed.branch ?? null,
          linkedinUrl: claimed.linkedinUrl ?? cand.profile.linkedin_url ?? null,
          attempt: cand.verificationAttempts, source: cand.verificationSource,
        } : null,
      });
    }
  }
  items.sort((x, y) => new Date(x.openedAt).getTime() - new Date(y.openedAt).getTime());
  return c.json({ items });
});

associationRoutes.post("/association/reviews/:id/resolve", async (c) => {
  // Associations approve or reject; clearing a roll-number flag is a staff call.
  const body = z.object({ resolution: z.enum(["approve", "reject", "reject_fraud"]), note: z.string().max(1000).optional() }).parse(await c.req.json());
  if (body.resolution !== "approve" && !body.note?.trim()) return c.json({ error: "invalid", message: "Give the candidate a reason." }, 400);
  const mine = await myAssociationIds(c);
  const item = await c.var.deps.ops.getReview(c.req.param("id"));
  if (!item || item.kind !== "verification") throw new NotFound("verification item");
  const assoc = mine.find((a) => a.id === item.associationId);
  if (!assoc) throw new Forbidden("not your queue");
  await resolveVerification(c.var.deps, { reviewId: item.id, actor: { id: c.var.user!.id, isStaff: false, associationId: assoc.id }, resolution: body.resolution, note: body.note });
  return c.json({ ok: true });
});
