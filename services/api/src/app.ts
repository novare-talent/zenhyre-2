import { Hono } from "hono";
import { DomainError } from "@zenhyre/shared";
import { ZodError } from "zod";
import { AppConfig, AppDeps, Vars, buildDeps } from "./context";
import { sessionUser } from "./middleware/auth";
import { authRoutes } from "./routes/auth";
import { candidateRoutes } from "./routes/candidate";
import { companyRoutes } from "./routes/company";
import { adminRoutes } from "./routes/admin";
import { roleRoutes } from "./routes/roles";
import { applicationRoutes } from "./routes/applications";
import { adminRoleRoutes } from "./routes/adminRoles";
import { webhookRoutes } from "./routes/webhooks";

export async function buildApp(cfg: AppConfig, built?: AppDeps) {
  const deps = built ?? await buildDeps(cfg);
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
  app.route("/", webhookRoutes);
  app.route("/", candidateRoutes);
  app.route("/", companyRoutes);
  app.route("/", adminRoutes);
  app.route("/", roleRoutes);
  app.route("/", applicationRoutes);
  app.route("/", adminRoleRoutes);
  // Task 12 mounts: webhookRoutes (unauthenticated) and the guarded route groups.
  // Guards are applied per path prefix inside each route file, never as `use("*")` on a
  // sub-app, because sub-app middleware registered on "*" leaks onto every later route.
  return app;
}
