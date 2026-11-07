import { Hono } from "hono";
import { z } from "zod";
import { Vars } from "../context";
import { requireUser } from "../middleware/auth";
import { signUpCandidate } from "../workflows/signUpCandidate";
import { retryVerification } from "../workflows/retryVerification";
import { saveProfile } from "../workflows/saveProfile";
import { assertCandidateEmail, assertFreeFor, emailKind } from "../oneRole";

export const candidateRoutes = new Hono<{ Variables: Vars }>();
// Prefix-scoped guards: these do not leak onto other route groups mounted on the same parent.
candidateRoutes.use("/candidates", requireUser);
candidateRoutes.use("/me/*", requireUser);
candidateRoutes.use("/campuses", requireUser);

const signUp = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  gradDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), course: z.string().min(1), rollNumber: z.string().nullable().optional(),
  campusShortCode: z.string().optional(),
  claimed: z.object({ batch: z.string(), branch: z.string(), linkedinUrl: z.string() }).optional(),
});

candidateRoutes.post("/candidates", async (c) => {
  const body = signUp.parse(await c.req.json());
  const me = await c.var.deps.identity.getCandidate(c.var.user!.id);
  if (me) return c.json({ error: "already a candidate" }, 409);
  const emailRow = (await c.var.deps.identity.emailsFor(c.var.user!.id)).find((e) => e.isPrimary)!;
  await assertFreeFor(c.var.deps.identity, c.var.user!.id, "candidate");
  assertCandidateEmail(await emailKind(c.var.deps.identity, await c.var.deps.ops.config.get("identity.freemail_domains"), emailRow.email));
  const candidate = await signUpCandidate(c.var.deps, { userId: c.var.user!.id, email: emailRow.email, name: body.name, gradDate: body.gradDate, course: body.course,
    rollNumber: body.rollNumber ?? null, campusShortCode: body.campusShortCode, claimed: body.claimed });
  return c.json({ candidate }, 201);
});

candidateRoutes.get("/me/profile", async (c) => c.json({ candidate: await c.var.deps.identity.getCandidate(c.var.user!.id) }));

const profilePatch = z.object({
  name: z.string().trim().min(1).max(120).optional(), headline: z.string().optional(), skills: z.array(z.string()).optional(), years_experience: z.number().min(0).optional(),
  current_company: z.string().optional(), current_title: z.string().optional(), preferred_roles: z.array(z.string()).optional(),
  preferred_locations: z.array(z.string()).optional(), notice_period_days: z.number().int().min(0).optional(),
  current_ctc: z.number().int().min(0).optional(), linkedin_url: z.string().optional(), cv_url: z.string().optional(),
});
candidateRoutes.put("/me/profile", async (c) => {
  const row = await saveProfile(c.var.deps, c.var.user!.id, profilePatch.parse(await c.req.json()));
  return c.json({ profile: row.profile });
});
candidateRoutes.put("/me/open", async (c) => {
  const { open } = z.object({ open: z.boolean() }).parse(await c.req.json());
  await c.var.deps.identity.setCandidateOpen(c.var.user!.id, open);
  return c.json({ ok: true });
});
candidateRoutes.post("/me/verification/retry", async (c) => {
  return c.json({ candidate: await retryVerification(c.var.deps, c.var.user!.id) });
});
// §4.1: internal_tier is never exposed, so return only the public fields.
candidateRoutes.get("/campuses", async (c) => c.json({ campuses: (await c.var.deps.identity.listCampuses()).map(({ id, name, shortCode }) => ({ id, name, shortCode })) }));
