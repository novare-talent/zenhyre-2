import { Hono } from "hono";
import { z } from "zod";
import { NotFound } from "@zenhyre/shared";
import { Vars } from "../context";
import { requireFinance, requireStaff, requireUser } from "../middleware/auth";
import {
  cancelSettlement, invoicePdf, reconcilePayments, requestSettlement, retrySettlement, rolePayments, syncOrder, syncSettlement,
} from "../workflows/payments";
import { uuidParam } from "./views";

/**
 * The finance console (/staff/payments): staff with `user.is_finance`. Every refund and forfeit a person makes goes
 * through here (or through `request_deposit_settlement()` in SQL); both are audited.
 */
export const adminPaymentRoutes = new Hono<{ Variables: Vars }>();
adminPaymentRoutes.use("/admin/payments/*", requireUser, requireStaff, requireFinance);
adminPaymentRoutes.use("/admin/payments", requireUser, requireStaff, requireFinance);

/** Every role with money on it, with balances; the settlement queue; open deposit decisions and payment alerts. */
adminPaymentRoutes.get("/admin/payments", async (c) => {
  const { deps } = c.var;
  const rows = await deps.ledger.rolesWithMoney();
  const roles = await Promise.all(rows.map(async (r) => {
    const role = await deps.roles.get(r.roleId);
    const company = role ? await deps.identity.getCompany(role.companyId) : null;
    return { ...r, title: role?.title ?? "(unknown)", status: role?.status, depositMode: role?.depositMode, companyName: company?.name ?? "" };
  }));
  const settlements = await deps.ledger.settlements({ status: ["requested", "processing", "failed"] });
  const decisions = await deps.ops.listReviews({ kind: "deposit_resolution", open: true });
  const alerts = (await deps.ops.listReviews({ kind: "alert", open: true }))
    .filter((i) => ["payment_order", "deposit_settlement"].includes(i.refType) || String((i.payload as any)?.reason ?? "").includes("fee"));
  return c.json({ roles, settlements, decisions, alerts, mode: deps.gateway.mode });
});

adminPaymentRoutes.get("/admin/payments/roles/:id", async (c) => {
  const { deps } = c.var;
  const role = await deps.roles.require(uuidParam(c.req.param("id"), "role"));
  const [summary, entries, settlements, company] = await Promise.all([
    rolePayments(deps, role), deps.ledger.entries(role.id), deps.ledger.settlements({ roleId: role.id }), deps.identity.getCompany(role.companyId)]);
  return c.json({ role: { id: role.id, title: role.title, status: role.status, depositMode: role.depositMode, depositAmount: role.depositAmount,
    hiredMatchId: role.hiredMatchId, companyId: role.companyId, companyName: company?.name ?? "" }, summary, entries, settlements });
});

const settleBody = z.object({
  kind: z.enum(["refund", "forfeit"]),
  /** Paise; omitted = everything still available. */
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  deductGatewayFee: z.boolean().default(true),
  reason: z.string().trim().min(3).max(500),
});
adminPaymentRoutes.post("/admin/payments/roles/:id/settlements", async (c) => {
  const body = settleBody.parse(await c.req.json());
  const settlement = await requestSettlement(c.var.deps, { roleId: uuidParam(c.req.param("id"), "role"), user: c.var.user!, ...body });
  return c.json({ settlement }, 201);
});
adminPaymentRoutes.post("/admin/payments/settlements/:id/cancel", async (c) =>
  c.json({ settlement: await cancelSettlement(c.var.deps, { settlementId: uuidParam(c.req.param("id"), "settlement"), user: c.var.user! }) }));
adminPaymentRoutes.post("/admin/payments/settlements/:id/retry", async (c) =>
  c.json({ settlement: await retrySettlement(c.var.deps, { settlementId: uuidParam(c.req.param("id"), "settlement"), user: c.var.user! }) }, 201));
adminPaymentRoutes.post("/admin/payments/settlements/:id/sync", async (c) =>
  c.json({ settlement: await syncSettlement(c.var.deps, uuidParam(c.req.param("id"), "settlement")) }));
adminPaymentRoutes.post("/admin/payments/orders/:orderId/sync", async (c) => {
  const order = await syncOrder(c.var.deps, c.req.param("orderId"));
  return c.json({ order });
});
/** Runs the payments sweep now: checks open orders, processes queued settlements, re-checks refunds in flight. */
adminPaymentRoutes.post("/admin/payments/reconcile", async (c) => c.json({ result: await reconcilePayments(c.var.deps, { orderAgeMinutes: 0 }) }));

adminPaymentRoutes.get("/admin/payments/invoices/:id/pdf", async (c) => {
  const inv = await c.var.deps.ledger.invoice(uuidParam(c.req.param("id"), "invoice"));
  if (!inv) throw new NotFound("invoice");
  const pdf = await invoicePdf(c.var.deps, inv);
  return new Response(new Uint8Array(pdf), { headers: {
    "content-type": "application/pdf", "content-disposition": `inline; filename="${inv.number.replace(/\//g, "-")}.pdf"`, "cache-control": "private, no-store" } });
});
