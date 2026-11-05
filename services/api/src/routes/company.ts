import { Hono } from "hono";
import { z } from "zod";
import { Vars } from "../context";
import { requireUser } from "../middleware/auth";

export const companyRoutes = new Hono<{ Variables: Vars }>();
companyRoutes.use("/companies", requireUser);
companyRoutes.use("/companies/*", requireUser);

companyRoutes.post("/companies", async (c) => {
  const { name } = z.object({ name: z.string().min(1) }).parse(await c.req.json());
  const { identity } = c.var.deps;
  if (await identity.membershipFor(c.var.user!.id)) return c.json({ error: "already in a company" }, 409);
  const email = (await identity.emailsFor(c.var.user!.id)).find((e) => e.isPrimary)!.email;
  const r = await identity.createCompany({ userId: c.var.user!.id, email, name });
  return c.json(r, 201);
});

companyRoutes.post("/companies/:id/invites", async (c) => {
  const { email } = z.object({ email: z.string().email() }).parse(await c.req.json());
  const { identity, notify, baseUrl } = c.var.deps;
  const companyId = c.req.param("id");
  const isStaff = c.var.user!.isStaff;
  if (!isStaff) {
    const m = await identity.requireActiveMember(c.var.user!.id, companyId);
    if (m.role !== "owner") return c.json({ error: "owner only" }, 403);
  }
  const company = await identity.getCompany(companyId);
  if (!company) return c.json({ error: "not found" }, 404);
  const { token } = await identity.inviteCompanyUser({ companyId, invitedBy: c.var.user!.id, email, staffOverride: isStaff });
  await notify.sendToEmail(email, "company_invite", { companyName: company.name, inviterName: "A teammate", url: `${baseUrl}/auth/redeem?t=${token}` });
  return c.json({ ok: true });
});

companyRoutes.get("/companies/:id", async (c) => {
  const { identity } = c.var.deps;
  await identity.requireActiveMember(c.var.user!.id, c.req.param("id"));
  return c.json({ company: await identity.getCompany(c.req.param("id")), users: await identity.listCompanyUsers(c.req.param("id")) });
});
