import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { z } from "zod";
import { Vars } from "../context";

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
  if (r.purpose === "company_invite") await c.var.deps.identity.acceptCompanyInvite(r.userId, r.payload as any);
  if (r.purpose === "association_admin_invite") await c.var.deps.identity.acceptAssociationInvite(r.userId, r.payload as any);
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
  const [candidate, membership, associations] = await Promise.all([
    identity.getCandidate(c.var.user.id), identity.membershipFor(c.var.user.id), identity.associationsForUser(c.var.user.id)]);
  return c.json({ user: c.var.user, candidate, membership, associations });
});
