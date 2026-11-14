import { Hono } from "hono";
import { z } from "zod";
import { Vars } from "../context";
import { requireUser } from "../middleware/auth";

/** §11 in-app notifications: the feed and read marks. Every seat uses these. */
export const notificationRoutes = new Hono<{ Variables: Vars }>();
notificationRoutes.use("/me/notifications", requireUser);
notificationRoutes.use("/me/notifications/*", requireUser);

notificationRoutes.get("/me/notifications", async (c) => {
  const q = z.object({ unread: z.enum(["0", "1"]).optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).parse(c.req.query());
  return c.json(await c.var.deps.notify.listInApp(c.var.user!.id, { unreadOnly: q.unread === "1", limit: q.limit }));
});

notificationRoutes.post("/me/notifications/read", async (c) => {
  const { ids } = z.object({ ids: z.array(z.string().uuid()).max(200).optional() }).parse(await c.req.json().catch(() => ({})));
  return c.json({ marked: await c.var.deps.notify.markRead(c.var.user!.id, ids) });
});
