import { Hono } from "hono";
import { z } from "zod";
import { DomainError, NotFound } from "@zenhyre/shared";
import { GST_STATES, type FakeGateway } from "@zenhyre/ledger";
import type { Role } from "@zenhyre/roles";
import { Vars } from "../context";
import { requireUser } from "../middleware/auth";
import { checkout, cleanBilling, invoicePdf, rolePayments, syncOrder } from "../workflows/payments";
import { uuidParam } from "./views";

/** The company seat's money: what a role owes, checkout, payment status, billing details and invoice PDFs. */
export const paymentRoutes = new Hono<{ Variables: Vars }>();
paymentRoutes.use("/roles/*", requireUser);
paymentRoutes.use("/companies/*", requireUser);

type Ctx = { var: Vars };
async function loadRole(c: Ctx, id: string): Promise<Role> {
  const role = await c.var.deps.roles.require(uuidParam(id, "role"));
  if (!c.var.user!.isStaff) await c.var.deps.identity.requireActiveMember(c.var.user!.id, role.companyId);
  return role;
}

export const billingBody = z.object({
  legalName: z.string().trim().min(2).max(200),
  gstin: z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Not a valid GSTIN").nullable().optional()
    .or(z.literal("").transform(() => null)),
  address: z.string().trim().min(5).max(500),
  stateCode: z.string().refine((s) => s in GST_STATES, "Pick a state"),
  phone: z.string().trim().min(10).max(16),
  email: z.string().trim().email().max(200),
}).transform((b) => ({ ...b, gstin: b.gstin ?? null, state: GST_STATES[b.stateCode]! }));

paymentRoutes.get("/roles/:id/payments", async (c) => {
  const role = await loadRole(c, c.req.param("id"));
  return c.json({ payments: await rolePayments(c.var.deps, role) });
});

paymentRoutes.post("/roles/:id/payments/checkout", async (c) => {
  const body = z.object({ purpose: z.enum(["deposit", "fee"]), billing: billingBody.optional() }).parse(await c.req.json());
  const role = await loadRole(c, c.req.param("id"));
  if (c.var.user!.isStaff) throw new DomainError("forbidden", "Staff cannot pay on a company's behalf.", 403);
  return c.json({ checkout: await checkout(c.var.deps, { roleId: role.id, user: c.var.user!, purpose: body.purpose, billing: body.billing }) });
});

/** The browser lands back from checkout: ask the gateway, never trust the redirect. */
paymentRoutes.post("/roles/:id/payments/orders/:orderId/sync", async (c) => {
  const role = await loadRole(c, c.req.param("id"));
  const order = await c.var.deps.ledger.order(c.req.param("orderId"));
  if (!order || order.roleId !== role.id) throw new NotFound("payment order");
  const synced = await syncOrder(c.var.deps, order.orderId);
  const fresh = await c.var.deps.roles.require(role.id);
  return c.json({ order: { orderId: synced.orderId, status: synced.status, total: synced.total, paidAt: synced.paidAt }, roleStatus: fresh.status });
});

/** Dev and tests only: completes (or fails) a checkout on the fake gateway, as the real hosted checkout would. */
paymentRoutes.post("/roles/:id/payments/orders/:orderId/fake-pay", async (c) => {
  const { deps } = c.var;
  if (deps.gateway.provider !== "fake" || process.env.NODE_ENV === "production") throw new NotFound("route");
  const { outcome } = z.object({ outcome: z.enum(["success", "failed"]).default("success") }).parse(await c.req.json().catch(() => ({})));
  const role = await loadRole(c, c.req.param("id"));
  const order = await deps.ledger.order(c.req.param("orderId"));
  if (!order || order.roleId !== role.id) throw new NotFound("payment order");
  (deps.gateway as FakeGateway).pay(order.orderId, outcome, deps.clock.now());
  const synced = await syncOrder(deps, order.orderId);
  return c.json({ order: { orderId: synced.orderId, status: synced.status } });
});

paymentRoutes.get("/companies/:id/billing", async (c) => {
  const companyId = uuidParam(c.req.param("id"), "company");
  if (!c.var.user!.isStaff) await c.var.deps.identity.requireActiveMember(c.var.user!.id, companyId);
  return c.json({ billing: await c.var.deps.ledger.billing(companyId) });
});
paymentRoutes.put("/companies/:id/billing", async (c) => {
  const companyId = uuidParam(c.req.param("id"), "company");
  await c.var.deps.identity.requireActiveMember(c.var.user!.id, companyId);
  const billing = cleanBilling(billingBody.parse(await c.req.json()));
  await c.var.deps.ledger.saveBilling(companyId, billing, c.var.user!.id);
  return c.json({ billing });
});

paymentRoutes.get("/roles/:id/invoices/:invoiceId/pdf", async (c) => {
  const role = await loadRole(c, c.req.param("id"));
  const inv = await c.var.deps.ledger.invoice(uuidParam(c.req.param("invoiceId"), "invoice"));
  if (!inv || inv.roleId !== role.id) throw new NotFound("invoice");
  const pdf = await invoicePdf(c.var.deps, inv);
  return new Response(new Uint8Array(pdf), { headers: {
    "content-type": "application/pdf", "content-disposition": `inline; filename="${inv.number.replace(/\//g, "-")}.pdf"`, "cache-control": "private, no-store" } });
});
