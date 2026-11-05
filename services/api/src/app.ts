import { Hono } from "hono";
import { DomainError } from "@zenhyre/shared";
import { ZodError } from "zod";
import { AppConfig, Vars, buildDeps } from "./context";
import { sessionUser } from "./middleware/auth";
import { authRoutes } from "./routes/auth";

export async function buildApp(cfg: AppConfig) {
  const deps = await buildDeps(cfg);
  const app = new Hono<{ Variables: Vars }>();
  app.use("*", async (c, next) => { c.set("deps", deps); await next(); });
  app.use("*", sessionUser);
  app.onError((err, c) => {
    if (err instanceof DomainError) return c.json({ error: err.code, message: err.message }, err.status as any);
    if (err instanceof ZodError) return c.json({ error: "invalid", issues: err.issues }, 400);
    if (err instanceof SyntaxError) return c.json({ error: "invalid", message: "malformed JSON" }, 400);
    console.error(err);
    return c.json({ error: "internal" }, 500);
  });
  app.route("/", authRoutes);
  // Task 12 mounts: webhookRoutes (unauthenticated) and the guarded route groups.
  // Guards are applied per path prefix inside each route file, never as `use("*")` on a
  // sub-app, because sub-app middleware registered on "*" leaks onto every later route.
  return app;
}
