import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { Vars } from "../context";
import { runCadence } from "../scheduler";

/**
 * Scheduled jobs for serverless hosting (§18): Vercel Cron calls GET /cron/hourly and /cron/nightly with
 * `Authorization: Bearer $CRON_SECRET`. Without a configured secret the routes do not exist.
 */
export const cronRoutes = new Hono<{ Variables: Vars }>();

cronRoutes.get("/cron/:cadence", async (c) => {
  const secret = c.var.deps.cronSecret;
  if (!secret) return c.json({ error: "not_found" }, 404);
  const given = Buffer.from(c.req.header("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return c.json({ error: "unauthenticated" }, 401);
  const cadence = c.req.param("cadence");
  if (cadence !== "hourly" && cadence !== "nightly") return c.json({ error: "not_found" }, 404);
  const ran = await runCadence(c.var.deps, cadence);
  return c.json({ cadence, ran });
});
