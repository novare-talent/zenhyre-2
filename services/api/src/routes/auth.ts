import { Hono } from "hono";
import { z } from "zod";
import { Vars } from "../context";
import { roleOf } from "../oneRole";
import { AuthError, AuthSession } from "../auth/provider";
import { accessTokenOf } from "../middleware/auth";

export const authRoutes = new Hono<{ Variables: Vars }>();

const sessionJson = (s: AuthSession) => ({ accessToken: s.accessToken, refreshToken: s.refreshToken, expiresAt: s.expiresAt });

authRoutes.post("/auth/magic-link", async (c) => {
  const { email: raw } = z.object({ email: z.string().email().max(254) }).parse(await c.req.json());
  const email = raw.toLowerCase();
  const { auth, notify, baseUrl, limits } = c.var.deps;
  // The web app forwards the browser's address; a direct caller is limited by its own.
  const ip = c.req.header("x-zh-client-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await limits.linkPerEmail.take(email)) || !(await limits.linkPerIp.take(ip))) {
    return c.json({ error: "rate_limited", message: "Too many sign-in links requested. Wait a few minutes and try again." }, 429);
  }
  const token = await auth.issueLinkToken(email);
  // The user may not exist yet, so address by email rather than by userId.
  await notify.sendToEmail(email, "magic_link", { url: `${baseUrl}/auth/redeem?t=${encodeURIComponent(token)}` });
  return c.json({ ok: true });
});

/**
 * Exchanges an emailed link token for a session, makes sure the Zenhyre user exists, and accepts any invites waiting
 * for this address. One email, one role: an invite is only accepted by someone with no role yet, or already in that role.
 */
authRoutes.post("/auth/redeem", async (c) => {
  const { t } = z.object({ t: z.string().min(1).max(512) }).parse(await c.req.json());
  const { auth, identity } = c.var.deps;
  let session: AuthSession;
  try { session = await auth.redeemLinkToken(t); } catch (e) {
    if (e instanceof AuthError) return c.json({ error: "invalid", message: "That link is not valid any more. Ask for a new one." }, 400);
    throw e;
  }
  const { user, created } = await identity.ensureUser({ id: session.claims.sub, email: session.claims.email });
  const emails = (await identity.emailsFor(user.id)).map((e) => e.email);
  let purpose: "signin" | "company_invite" | "association_admin_invite" = "signin";
  for (const inv of await identity.pendingInvitesFor(emails)) {
    const held = await roleOf(identity, user.id);
    if (inv.purpose === "company_invite" && (!held || held === "company")) {
      await identity.acceptCompanyInvite(user.id, inv.payload as any);
    } else if (inv.purpose === "association_admin_invite" && (!held || held === "association")) {
      await identity.acceptAssociationInvite(user.id, inv.payload as any);
    } else continue;
    await identity.markInviteAccepted(inv.id);
    if (purpose === "signin") purpose = inv.purpose as typeof purpose;
  }
  return c.json({ userId: user.id, created, purpose, session: sessionJson(session) });
});

authRoutes.post("/auth/refresh", async (c) => {
  const { refreshToken } = z.object({ refreshToken: z.string().min(1).max(2048) }).parse(await c.req.json());
  try {
    return c.json({ session: sessionJson(await c.var.deps.auth.refresh(refreshToken)) });
  } catch (e) {
    if (e instanceof AuthError) return c.json({ error: "unauthenticated" }, 401);
    throw e;
  }
});

authRoutes.post("/auth/signout", async (c) => {
  const token = accessTokenOf(c);
  if (token) await c.var.deps.auth.signOut(token);
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
