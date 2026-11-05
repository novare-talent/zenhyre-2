import { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { Forbidden } from "@zenhyre/shared";
import { Vars } from "../context";

export const sessionUser: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
  const sid = getCookie(c, "zh_session");
  const u = sid ? await c.var.deps.identity.userForSession(sid) : null;
  c.set("user", u ? { id: u.id, isStaff: u.isStaff } : null);
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
