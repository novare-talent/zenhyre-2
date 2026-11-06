import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { z } from "zod";
import { Vars } from "../context";
import { roleOf } from "../oneRole";

export const authRoutes = new Hono<{ Variables: Vars }>();

authRoutes.post("/auth/magic-link", async (c) => {
  const { email } = z.object({ email: z.string().email() }).parse(await c.req.json());
  const { identity, notify, baseUrl } = c.var.deps;
  const { token } = await identity.issueMagicLink(email, "signin", {});
  // The user may not exist yet, so address by email rather than by userId.
  await notify.sendToEmail(email, "magic_link", { url: `${baseUrl}/auth/redeem?t=${token}` });
  return c.json({ ok: true });
});

authRoutes.get("/auth/redeem", async (c) => {
  const t = c.req.query("t") ?? "";
  const r = await c.var.deps.identity.redeemMagicLink(t);
  // One email, one role: an invite is only accepted by someone with no role yet, or already in that role.
  const held = await roleOf(c.var.deps.identity, r.userId);
  if (r.purpose === "company_invite" && (!held || held === "company")) await c.var.deps.identity.acceptCompanyInvite(r.userId, r.payload as any);
  if (r.purpose === "association_admin_invite" && (!held || held === "association")) await c.var.deps.identity.acceptAssociationInvite(r.userId, r.payload as any);
  setCookie(c, "zh_session", r.sessionId, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 30 * 24 * 3600 });
  return c.json({ userId: r.userId, created: r.created, purpose: r.purpose });
});

authRoutes.post("/auth/signout", async (c) => {
  const sid = getCookie(c, "zh_session");
  if (sid) await c.var.deps.identity.endSession(sid);
  deleteCookie(c, "zh_session", { path: "/" });
  return c.json({ ok: true });
});

authRoutes.get("/me", async (c) => {
  if (!c.var.user) return c.json({ error: "unauthenticated" }, 401);
  const { identity } = c.var.deps;
  const [candidate, membership, associations, emailRows] = await Promise.all([
    identity.getCandidate(c.var.user.id), identity.membershipFor(c.var.user.id), identity.associationsForUser(c.var.user.id), identity.emailsFor(c.var.user.id)]);
  // The apps need the signed-in address and, for candidates, the public campus fields. internal_tier stays out (§4.1).
  const emails = emailRows.map(({ email, isPrimary, verifiedAt }) => ({ email, isPrimary, verified: !!verifiedAt }));
  const campuses = candidate || associations.length ? await identity.listCampuses() : [];
  const publicCampus = (id: string) => { const x = campuses.find((k) => k.id === id); return x ? { id: x.id, name: x.name, shortCode: x.shortCode } : null; };
  const campus = candidate ? publicCampus(candidate.campusId) : null;
  const company = membership ? await identity.getCompany(membership.companyId) : null;
  return c.json({ user: c.var.user, emails, candidate, campus, membership, company,
    associations: associations.map((a) => ({ ...a, campus: publicCampus(a.campusId) })) });
});
