import { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { Forbidden } from "@zenhyre/shared";
import { Vars } from "../context";

/** The caller's access token: `Authorization: Bearer …`, or the `zh_session` cookie the web app forwards. */
export function accessTokenOf(c: Context): string | null {
  const h = c.req.header("authorization");
  if (h?.toLowerCase().startsWith("bearer ")) return h.slice(7).trim() || null;
  return getCookie(c, "zh_session") ?? null;
}

export const sessionUser: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
  const token = accessTokenOf(c);
  const claims = token ? await c.var.deps.auth.verifyAccessToken(token) : null;
  let user = null;
  if (claims) {
    const { identity } = c.var.deps;
    // Usually the user exists already (POST /auth/redeem creates it); a token minted elsewhere still works.
    user = await identity.getUser(claims.sub) ?? (await identity.ensureUser({ id: claims.sub, email: claims.email })).user;
  }
  c.set("user", user ? { id: user.id, isStaff: user.isStaff, isFinance: user.isStaff && user.isFinance } : null);
  await next();
};
export const requireUser: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
  if (!c.var.user) return c.json({ error: "unauthenticated" }, 401);
  await next();
};
export const requireStaff: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
  if (!c.var.user?.isStaff) throw new Forbidden("staff only");
  await next();
};
/** Staff with finance access (`user.is_finance`): the payments console. */
export const requireFinance: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
  if (!c.var.user?.isStaff || !c.var.user.isFinance) throw new Forbidden("finance access only");
  await next();
};
