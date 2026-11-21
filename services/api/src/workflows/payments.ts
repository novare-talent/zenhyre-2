// Deposits and fees through the payment gateway (docs/superpowers/plans/2026-11-21-cashfree-deposits.md).
//
// Money in:  checkout → gateway checkout → webhook or status check → paymentCaptured (deposit: role goes live; fee: paid).
// Money out: every refund or forfeit is a `deposit_settlement` row (rules, finance console, or SQL), carried out by
//            processSettlement. Gateway calls never run inside a database transaction.
import type { BillingDetails, SupplierDetails } from "@zenhyre/db/schema";
import { DomainError, Invalid, NotFound } from "@zenhyre/shared";
import { feeFor, type Role } from "@zenhyre/roles";
import type { Match } from "@zenhyre/matching";
import {
  addGst, splitGross, estimateGatewayFee, renderInvoicePdf, GatewayError,
  type Invoice, type OrderState, type PaymentOrder, type Purpose, type RefundState, type Settlement,
} from "@zenhyre/ledger";
import { AppDeps } from "../context";
import { DAY_MS, inTx, roleUrl, sendToCompany, User, Wf } from "./tx";
import { closeRoleTx } from "./closeRole";

/** "₹23,600.00": payments show paise, unlike the rounded prices elsewhere. */
export const money = (p: number) => "₹" + (p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function taxConfig(w: { m: { ops: AppDeps["ops"] } } | AppDeps) {
  const ops = "m" in w ? w.m.ops : w.ops;
  return { rate: await ops.config.get("gst.rate"), supplier: (await ops.config.get("invoice.supplier")) as SupplierDetails };
}

// ---------------------------------------------------------------- billing

export function cleanBilling(b: BillingDetails): BillingDetails {
  const phone = b.phone.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  if (!/^[6-9]\d{9}$/.test(phone)) throw new Invalid("Enter a 10-digit Indian mobile number.");
  const gstin = b.gstin?.trim().toUpperCase() || null;
  if (gstin && gstin.slice(0, 2) !== b.stateCode) throw new Invalid("The GSTIN's first two digits must match the billing state.");
  return { legalName: b.legalName.trim(), gstin, address: b.address.trim(), state: b.state.trim(), stateCode: b.stateCode, phone, email: b.email.trim().toLowerCase() };
}

// ---------------------------------------------------------------- what a company owes

/** The deposit a role owes before it goes live, with GST, for the role page and the checkout. */
export async function depositQuote(deps: AppDeps, role: Role, billing: BillingDetails | null) {
  const { rate, supplier } = await taxConfig(deps);
  const taxable = role.depositAmount ?? 0;
  return addGst(taxable, rate, supplier.stateCode, billing?.stateCode ?? supplier.stateCode);
}

/** Everything the company sees about money on one role. */
export async function rolePayments(deps: AppDeps, role: Role) {
  const [balances, orders, settlements, invoices, billing] = await Promise.all([
    deps.ledger.balances(role.id), deps.ledger.orders(role.id), deps.ledger.settlements({ roleId: role.id }),
    deps.ledger.invoices(role.id), deps.ledger.billing(role.companyId)]);
  const quote = await depositQuote(deps, role, billing);
  const canPayDeposit = role.status === "deposit_pending" && !role.depositMode && quote.total > 0;
  const hired = !!role.hiredMatchId || ["closing", "closed"].includes(role.status);
  return {
    mode: deps.gateway.mode,
    gstRate: await deps.ops.config.get("gst.rate"),
    deposit: { ...quote, mode: role.depositMode },
    balances,
    canPayDeposit,
    canPayFee: hired && balances.feeOutstanding > 0,
    billing,
    orders: orders.map((o) => ({ orderId: o.orderId, purpose: o.purpose, status: o.status, taxable: o.taxable, gst: o.gst, total: o.total,
      paidAt: o.paidAt, cfPaymentId: o.cfPaymentId, paymentMethod: o.paymentMethod, createdAt: o.createdAt, expiresAt: o.expiresAt })),
    settlements: settlements.map((s) => ({ id: s.id, kind: s.kind, amount: s.amount, gatewayFee: s.gatewayFee, refunded: s.kind === "refund" ? s.amount - s.gatewayFee : 0,
      status: s.status, requestedAt: s.requestedAt, succeededAt: s.succeededAt })),
    invoices: invoices.map((i) => ({ id: i.id, number: i.number, kind: i.kind, total: i.total, issuedAt: i.issuedAt })),
  };
}

// ---------------------------------------------------------------- checkout

/**
 * Starts (or resumes) a checkout for the deposit or the outstanding fee. Reuses a live order for the same amount;
 * otherwise creates one with the gateway first, then records it. Returns what the browser SDK needs.
 */
export async function checkout(deps: AppDeps, input: { roleId: string; user: User; purpose: Purpose; billing?: BillingDetails }) {
  const role = await deps.roles.require(input.roleId);
  await deps.identity.requireActiveMember(input.user.id, role.companyId);
  if (input.billing) await deps.ledger.saveBilling(role.companyId, cleanBilling(input.billing), input.user.id);
  const billing = await deps.ledger.billing(role.companyId);
  if (!billing) throw new DomainError("billing_required", "Add your billing details and phone number to pay.", 400);
  const { rate, supplier } = await taxConfig(deps);

  let amounts;
  if (input.purpose === "deposit") {
    if (role.status !== "deposit_pending" || role.depositMode) throw new DomainError("not_payable", "This role has no deposit waiting to be paid.", 409);
    if (!role.depositAmount) throw new DomainError("not_payable", "No deposit is set for this role yet. Novare will set it.", 409);
    amounts = addGst(role.depositAmount, rate, supplier.stateCode, billing.stateCode);
  } else {
    const b = await deps.ledger.balances(role.id);
    if (b.feeOutstanding <= 0) throw new DomainError("not_payable", "Nothing is owed on this role.", 409);
    amounts = splitGross(b.feeOutstanding, rate, supplier.stateCode, billing.stateCode);
  }

  const now = deps.clock.now();
  const live = await deps.ledger.activeOrder(role.id, input.purpose);
  if (live) {
    const usable = live.total === amounts.total && live.expiresAt.getTime() > now.getTime() + 5 * 60_000 && live.paymentSessionId;
    if (usable) return checkoutView(deps, live);
    // A stale or re-priced order: check it was not paid in the meantime, then retire it.
    const synced = await syncOrder(deps, live.orderId);
    if (synced.status === "paid") throw new DomainError("already_paid", "This payment has just been received.", 409);
    if (synced.status === "active") await deps.ledger.updateOrder(live.id, { status: "cancelled" });
  }

  const n = (await deps.ledger.ordersCount(role.id, input.purpose)) + 1;
  const orderId = `${input.purpose === "deposit" ? "dep" : "fee"}_${role.id.replace(/-/g, "")}_${n}`;
  const expiresAt = new Date(now.getTime() + deps.orderExpiryMinutes * 60_000);
  const company = await deps.identity.getCompany(role.companyId);
  const created = await deps.gateway.createOrder({
    orderId, amount: amounts.total, expiresAt,
    note: `${input.purpose === "deposit" ? "Hiring deposit" : "Success fee"}: ${role.title}`,
    returnUrl: `${roleUrl(deps, role.id)}?order_id=${orderId}`,
    notifyUrl: deps.paymentWebhookUrl,
    customer: { id: role.companyId.replace(/-/g, ""), email: billing.email, phone: billing.phone, name: billing.legalName || company?.name || "Company" },
  });
  const order = await inTx(deps, async (w) => {
    const locked = await w.m.roles.lock(role.id);
    if (input.purpose === "deposit" && (locked.status !== "deposit_pending" || locked.depositMode))
      throw new DomainError("not_payable", "This role has no deposit waiting to be paid.", 409);
    const again = await w.m.ledger.activeOrder(role.id, input.purpose);
    if (again) return again;
    return w.m.ledger.insertOrder({
      orderId, purpose: input.purpose, roleId: role.id, matchId: input.purpose === "fee" ? locked.hiredMatchId : null,
      taxable: amounts.taxable, gst: amounts.gst, total: amounts.total, provider: deps.gateway.provider,
      cfOrderId: created.cfOrderId, paymentSessionId: created.paymentSessionId, expiresAt, billing, createdBy: input.user.id, raw: created.raw });
  });
  return checkoutView(deps, order);
}

const checkoutView = (deps: AppDeps, o: PaymentOrder) => ({
  orderId: o.orderId, paymentSessionId: o.paymentSessionId, mode: deps.gateway.mode, purpose: o.purpose,
  taxable: o.taxable, gst: o.gst, total: o.total, expiresAt: o.expiresAt });

// ---------------------------------------------------------------- money in

/** Asks the gateway about an order and applies what it says. Safe to call any number of times. */
export async function syncOrder(deps: AppDeps, orderId: string): Promise<PaymentOrder> {
  const order = await deps.ledger.order(orderId);
  if (!order) throw new NotFound(`payment order ${orderId}`);
  if (order.status !== "active" && order.status !== "cancelled") return order;
  const state = await deps.gateway.getOrder(orderId);
  if (state.status === "paid") return paymentCaptured(deps, orderId, state);
  if (order.status === "active" && (state.status === "expired" || state.status === "cancelled"))
    return deps.ledger.updateOrder(order.id, { status: state.status, raw: state.raw });
  return order;
}

/**
 * The gateway confirmed a payment. Deposit: `deposit_received`, the role goes live (`broadcast`), the invoice is
 * emailed. Paid on a role that can no longer go live (withdrawn meanwhile): received, then refunded by rule. Fee:
 * `fee_paid`, and the fee invoice is emailed again marked paid.
 */
export async function paymentCaptured(deps: AppDeps, orderId: string, state: OrderState): Promise<PaymentOrder> {
  const pay = state.payment;
  if (!pay) throw new Error("paymentCaptured: no payment on the order state");
  let followUp: (() => Promise<unknown>) | null = null;
  const out = await inTx(deps, async (w) => {
    const order = await w.m.ledger.lockOrder(orderId);
    if (order.status === "paid") return order;
    const role = await w.m.roles.lock(order.roleId);
    const paid = await w.m.ledger.updateOrder(order.id, {
      status: "paid", cfPaymentId: pay.cfPaymentId, paymentMethod: pay.method, paidAt: pay.paidAt, raw: state.raw });
    if (pay.amount !== order.total) {
      await w.m.ops.openReview({ kind: "alert", refType: "payment_order", refId: order.orderId, associationId: null,
        payload: { reason: `paid ${pay.amount} paise, expected ${order.total}`, roleId: role.id } });
    }
    const base = { roleId: role.id, paymentOrderId: order.id, externalRef: pay.cfPaymentId, createdBy: "gateway" };
    if (order.purpose === "deposit") {
      await w.m.ledger.record({ ...base, type: "deposit_received", amount: pay.amount, tax: order.gst, note: `Cashfree payment ${pay.cfPaymentId}` });
      const { supplier } = await taxConfig(w);
      const inv = await w.m.ledger.issueInvoice({
        kind: "tax_invoice", roleId: role.id, paymentOrderId: order.id,
        lines: [{ description: `Refundable hiring deposit for the role "${role.title}"`, sac: supplier.sac, taxable: order.taxable }],
        ...taxSplit(order.taxable, order.gst, supplier.stateCode, order.billing.stateCode), total: order.total, billing: order.billing, supplier });
      if (role.status === "deposit_pending" && !role.depositMode) {
        await w.m.roles.depositPaid(role.id, { broadcastDays: await w.m.ops.config.get("match.broadcast_days"), note: `deposit paid: ${pay.cfPaymentId}` });
        w.after(() => deps.jobs.enqueue("role.broadcast", { roleId: role.id }));
      } else {
        // Nothing to go live any more (withdrawn while the company was paying): give the money back.
        const s = await w.m.ledger.requestSettlement({ roleId: role.id, paymentOrderId: order.id, kind: "refund", amount: pay.amount, deductGatewayFee: true,
          reason: `Deposit paid after the role was ${role.status}`, source: "rule:paid_after_withdraw", requestedBy: "system" });
        w.after(() => processSettlement(deps, s.id));
      }
      followUp = () => emailInvoice(deps, inv, "deposit_paid", {
        roleTitle: role.title, total: money(order.total), taxable: money(order.taxable), gst: money(order.gst), invoiceNumber: inv.number, url: roleUrl(deps, role.id) });
    } else {
      await w.m.ledger.record({ ...base, type: "fee_paid", amount: pay.amount, tax: order.gst, matchId: order.matchId, note: `Cashfree payment ${pay.cfPaymentId}` });
      const inv = await ensureFeeInvoice(w, role);
      if (inv) {
        followUp = () => emailInvoice(deps, inv, "fee_paid", { roleTitle: role.title, total: money(pay.amount), invoiceNumber: inv.number },
          { status: `PAID: ${money(pay.amount)} received on ${pay.paidAt.toISOString().slice(0, 10)} (Cashfree ${pay.cfPaymentId})` });
      }
    }
    return paid;
  });
  if (followUp) await (followUp as () => Promise<unknown>)().catch((err) => console.error("[payments] invoice email failed:", err));
  return out;
}

function taxSplit(taxable: number, gst: number, supplierState: string, buyerState: string) {
  const intra = supplierState === buyerState;
  const cgst = intra ? Math.floor(gst / 2) : 0;
  return { taxable, cgst, sgst: intra ? gst - cgst : 0, igst: intra ? 0 : gst };
}

// ---------------------------------------------------------------- the fee on a hire

/**
 * §9.2 steps 2–4, inside recordHire's transaction. The fee from the accepted terms on the hired CTC, plus GST, is
 * raised (`fee_due`); the held deposit is applied to it; any deposit beyond the fee is refunded by rule. The company is
 * emailed the balance and a link to pay. Replacement roles and zero fees raise nothing.
 */
export async function raiseFeeTx(w: Wf, role: Role, match: Match) {
  if (role.replacementOfRoleId || !role.feeTerms || !match.hiredCtc) return null;
  const feeTaxable = feeFor(role.feeTerms, match.hiredCtc);
  if (feeTaxable <= 0) return null;
  const { rate } = await taxConfig(w);
  const gst = Math.round(feeTaxable * rate);
  const feeTotal = feeTaxable + gst;
  await w.m.ledger.record({ type: "fee_due", roleId: role.id, matchId: match.id, amount: feeTotal, tax: gst,
    note: `${role.feeTerms.kind === "flat" ? "Flat fee" : `${(role.feeTerms.amount * 100).toFixed(1)}% of CTC ${money(match.hiredCtc)}`}`, createdBy: "system" });
  const b = await w.m.ledger.balances(role.id);
  const applied = Math.min(b.depositAvailable, feeTotal);
  if (applied > 0) {
    await w.m.ledger.record({ type: "deposit_applied_to_fee", roleId: role.id, matchId: match.id, amount: applied, createdBy: "system",
      note: "Deposit applied to the success fee" });
  }
  const excess = b.depositAvailable - applied;
  if (excess > 0) {
    const order = await w.m.ledger.paidDepositOrder(role.id);
    if (order) {
      const s = await w.m.ledger.requestSettlement({ roleId: role.id, paymentOrderId: order.id, kind: "refund", amount: excess, deductGatewayFee: true,
        reason: "Deposit beyond the success fee", source: "rule:excess_over_fee", requestedBy: "system" });
      w.after(() => processSettlement(w.deps, s.id));
    }
  }
  const inv = await ensureFeeInvoice(w, role, { feeTaxable, gst, hiredCtc: match.hiredCtc });
  const outstanding = feeTotal - applied;
  const data = { roleTitle: role.title, feeTotal: money(feeTotal), feeTaxable: money(feeTaxable), feeGst: money(gst), applied: money(applied),
    outstanding: money(outstanding), guaranteeDays: role.feeTerms.replacement_guarantee_days, url: `${roleUrl(w.deps, role.id)}?pay=fee`, invoiceNumber: inv?.number ?? "to follow" };
  w.after(() => inv ? emailInvoice(w.deps, inv, "fee_raised", data) : sendToCompany(w.deps, role.companyId, "fee_raised", data));
  return { feeTotal, applied, outstanding };
}

/**
 * The tax invoice for a role's success fee, issued once. Needs the company's billing details (place of supply), so a
 * company that never checked out gets its invoice at its first fee checkout instead.
 */
async function ensureFeeInvoice(w: Wf, role: Role, fee?: { feeTaxable: number; gst: number; hiredCtc: number }): Promise<Invoice | null> {
  const existing = (await w.m.ledger.invoices(role.id)).find((i) => i.kind === "tax_invoice" && i.lines[0]?.description.startsWith("Success fee"));
  if (existing) return existing;
  const billing = await w.m.ledger.billing(role.companyId);
  if (!billing) return null;
  const { supplier } = await taxConfig(w);
  let f = fee;
  if (!f) {
    const due = (await w.m.ledger.entries(role.id)).filter((e) => e.type === "fee_due").at(-1);
    if (!due) return null;
    f = { feeTaxable: due.amount - due.tax, gst: due.tax, hiredCtc: 0 };
  }
  return w.m.ledger.issueInvoice({
    kind: "tax_invoice", roleId: role.id,
    lines: [{ description: `Success fee for the hire on the role "${role.title}"`, sac: supplier.sac, taxable: f.feeTaxable }],
    ...taxSplit(f.feeTaxable, f.gst, supplier.stateCode, billing.stateCode), total: f.feeTaxable + f.gst, billing, supplier });
}

/**
 * §9.2 didNotJoin steps 1–3, inside its transaction, before the match moves: the applied deposit goes back to held,
 * the unpaid fee is voided, and any fee already paid opens an alert for finance to refund by hand.
 */
export async function reverseFeeTx(w: Wf, role: Role, matchId: string) {
  const b = await w.m.ledger.balances(role.id);
  if (b.depositApplied > 0) {
    await w.m.ledger.record({ type: "deposit_application_reversed", roleId: role.id, matchId, amount: b.depositApplied,
      createdBy: "system", note: "Hire did not join: deposit held again" });
  }
  const after = await w.m.ledger.balances(role.id);
  if (after.feeOutstanding > 0) {
    await w.m.ledger.record({ type: "fee_voided", roleId: role.id, matchId, amount: after.feeOutstanding,
      createdBy: "system", note: "Hire did not join: fee voided" });
  }
  if (b.feePaid > 0) {
    await w.m.ops.openReview({ kind: "alert", refType: "role", refId: role.id, associationId: null,
      payload: { reason: `the hire did not join but ${money(b.feePaid)} of the fee was already paid: refund it by bank transfer` } });
  }
}

// ---------------------------------------------------------------- resolving a deposit when a role ends

/**
 * §9.1, with the owner's rules (2026-11-21): once a role is live there is no refund on request. A role that ends with
 * no hire (`closing` from the dark check) is refunded on its own, less gateway charges (`deposit.auto_refund_no_hire`);
 * a role withdrawn after going live keeps its deposit until finance decide (a `deposit_resolution` item). The role
 * reaches `closed` once nothing is held.
 */
export async function resolveHeldDepositTx(w: Wf, role: Role, reason: string): Promise<{ held: boolean }> {
  if (role.depositMode !== "cashfree") return { held: false };
  const b = await w.m.ledger.balances(role.id);
  if (b.depositHeld <= 0) return { held: false };
  const order = await w.m.ledger.paidDepositOrder(role.id);
  const auto = role.status === "closing" && !role.hiredMatchId && await w.m.ops.config.get("deposit.auto_refund_no_hire");
  if (auto && order && b.depositAvailable > 0) {
    const s = await w.m.ledger.requestSettlement({ roleId: role.id, paymentOrderId: order.id, kind: "refund", amount: b.depositAvailable, deductGatewayFee: true,
      reason, source: "rule:no_hire", requestedBy: "system" });
    w.after(() => processSettlement(w.deps, s.id));
  } else if (b.depositAvailable > 0) {
    await w.m.ops.openReview({ kind: "deposit_resolution", refType: "role", refId: role.id, associationId: null,
      payload: { reason, held: b.depositHeld, status: role.status } });
  }
  return { held: true };
}

// ---------------------------------------------------------------- money out

/** Queues a settlement on behalf of finance (console). Forfeits and refunds alike need a reason. */
export async function requestSettlement(deps: AppDeps, input: { roleId: string; user: User; kind: Settlement["kind"]; amount?: number;
  deductGatewayFee?: boolean; reason: string; source?: string }) {
  const s = await inTx(deps, async (w) => {
    const role = await w.m.roles.lock(input.roleId);
    const order = await w.m.ledger.paidDepositOrder(role.id);
    if (!order) throw new DomainError("not_available", "This role has no paid deposit.", 409);
    const b = await w.m.ledger.balances(role.id);
    const s = await w.m.ledger.requestSettlement({ roleId: role.id, paymentOrderId: order.id, kind: input.kind, amount: input.amount ?? b.depositAvailable,
      deductGatewayFee: input.deductGatewayFee ?? true, reason: input.reason, source: input.source ?? "staff", requestedBy: input.user.id });
    await w.m.ops.audit(input.user.id, `deposit.${input.kind}.request`, "role", role.id, `${money(s.amount)}: ${input.reason}`);
    // The finance console settles the open deposit_resolution item, if there is one.
    for (const i of (await w.m.ops.listReviews({ kind: "deposit_resolution", open: true })).filter((i) => i.refId === role.id))
      await w.m.ops.resolveReview(i.id, `staff:${input.user.id}`, input.kind);
    return s;
  });
  await processSettlement(deps, s.id);
  return (await deps.ledger.settlement(s.id))!;
}

/** Finance cancels a settlement still waiting to be processed. */
export async function cancelSettlement(deps: AppDeps, input: { settlementId: string; user: User }) {
  return inTx(deps, async (w) => {
    const s = await w.m.ledger.claimSettlement(input.settlementId, "requested");
    if (!s) throw new DomainError("not_cancellable", "Only a settlement still waiting can be cancelled.", 409);
    await w.m.ops.audit(input.user.id, "deposit.settlement.cancel", "role", s.roleId, s.id);
    return w.m.ledger.updateSettlement(s.id, { status: "cancelled", processedAt: w.deps.clock.now() });
  });
}

/** The gateway's charge on the deposit payment still to be retained, for a refund that deducts it. */
async function gatewayFeeFor(deps: AppDeps, s: Settlement, order: PaymentOrder): Promise<number> {
  if (s.kind !== "refund" || !s.deductGatewayFee) return 0;
  const charge = await deps.gateway.charges(order.orderId)
    ?? estimateGatewayFee(order.total, await deps.ops.config.get("payment.gateway_fee_rate"), await deps.ops.config.get("gst.rate"));
  const already = (await deps.ledger.settlements({ roleId: s.roleId, status: ["processing", "succeeded"] }))
    .filter((x) => x.paymentOrderId === order.id && x.id !== s.id).reduce((t, x) => t + x.gatewayFee, 0);
  return Math.max(0, Math.min(charge - already, s.amount - 1));
}

/**
 * Carries out one `requested` settlement. A forfeit is booked at once. A refund is claimed (→ processing), sent to the
 * gateway with the settlement id as its idempotent refund id, and finished when the gateway reports success (here,
 * from the webhook, or from the reconcile job). Never throws: failures are recorded on the row and alerted.
 */
export async function processSettlement(deps: AppDeps, id: string): Promise<Settlement | null> {
  try {
    const s0 = await deps.ledger.settlement(id);
    if (!s0 || s0.status !== "requested") return s0;
    const order = (await deps.ledger.orderById(s0.paymentOrderId))!;
    const fee = await gatewayFeeFor(deps, s0, order);
    const claimed = await inTx(deps, async (w) => {
      const s = await w.m.ledger.claimSettlement(id, "requested");
      if (!s) return null;
      const role = await w.m.roles.lock(s.roleId);
      if (s.kind === "forfeit") {
        // Out of "in flight" first, then booked: the ledger's check counts in-flight settlements against what is held.
        const done = await w.m.ledger.updateSettlement(s.id, { status: "succeeded", processedAt: deps.clock.now(), succeededAt: deps.clock.now() });
        await w.m.ledger.record({ type: "deposit_forfeited", roleId: role.id, paymentOrderId: order.id, settlementId: s.id,
          amount: s.amount, externalRef: `settle:${s.id}`, note: s.reason, createdBy: s.requestedBy });
        await closeIfSettledTx(w, role);
        w.after(() => sendToCompany(deps, role.companyId, "deposit_forfeited", { roleTitle: role.title, amount: money(s.amount), reason: s.reason }));
        return { done };
      }
      return { s: await w.m.ledger.updateSettlement(s.id, { status: "processing", gatewayFee: fee, attempts: s.attempts + 1, processedAt: deps.clock.now() }) };
    });
    if (!claimed) return deps.ledger.settlement(id);
    if ("done" in claimed) return claimed.done ?? null;
    return sendRefund(deps, claimed.s!, order);
  } catch (err) {
    console.error(`[payments] settlement ${id} failed:`, err);
    return markFailed(deps, id, err instanceof Error ? err.message : String(err)).catch(() => null);
  }
}

async function sendRefund(deps: AppDeps, s: Settlement, order: PaymentOrder): Promise<Settlement | null> {
  let state: RefundState;
  try {
    state = await deps.gateway.createRefund({ orderId: order.orderId, refundId: s.id, amount: s.amount - s.gatewayFee, note: s.reason });
  } catch (err) {
    // A network failure may still have reached the gateway: leave it processing for the reconcile job to check,
    // unless the gateway clearly refused.
    if (err instanceof GatewayError && err.status && err.status >= 400 && err.status < 500) return markFailed(deps, s.id, err.message);
    console.error(`[payments] refund ${s.id} not confirmed, the reconcile job will check it:`, err);
    return deps.ledger.settlement(s.id);
  }
  if (state.cfRefundId) await deps.ledger.updateSettlement(s.id, { cfRefundId: state.cfRefundId });
  return applyRefundState(deps, s.id, state);
}

/** Applies what the gateway says about a refund: success books it, failure marks it, pending waits. */
export async function applyRefundState(deps: AppDeps, id: string, state: RefundState): Promise<Settlement | null> {
  if (state.status === "failed") return markFailed(deps, id, state.failureReason ?? "refund failed at the gateway");
  if (state.status !== "succeeded") return deps.ledger.settlement(id);
  let mail: (() => Promise<unknown>) | null = null;
  const out = await inTx(deps, async (w) => {
    const s = await w.m.ledger.claimSettlement(id, "processing");
    if (!s) return w.m.ledger.settlement(id);
    const role = await w.m.roles.lock(s.roleId);
    const order = (await w.m.ledger.orderById(s.paymentOrderId))!;
    const refunded = s.amount - s.gatewayFee;
    const ref = state.cfRefundId ?? s.cfRefundId ?? `settle:${s.id}`;
    const base = { roleId: role.id, paymentOrderId: order.id, settlementId: s.id, createdBy: "gateway" };
    const { rate, supplier } = await taxConfig(w);
    const split = splitGross(refunded, rate, supplier.stateCode, order.billing.stateCode);
    // Out of "in flight" first, then booked (see processSettlement).
    const done = await w.m.ledger.updateSettlement(s.id, { status: "succeeded", succeededAt: deps.clock.now(), cfRefundId: state.cfRefundId ?? s.cfRefundId });
    await w.m.ledger.record({ ...base, type: "deposit_refunded", amount: refunded, tax: split.gst, externalRef: ref, note: s.reason });
    if (s.gatewayFee > 0) await w.m.ledger.record({ ...base, type: "deposit_gateway_fee_retained", amount: s.gatewayFee, externalRef: `gwfee:${s.id}`, note: "Payment gateway charges" });
    const inv = await w.m.ledger.issueInvoice({
      kind: "credit_note", roleId: role.id, paymentOrderId: order.id, settlementId: s.id,
      lines: [{ description: `Refund of the hiring deposit for the role "${role.title}"`, sac: supplier.sac, taxable: split.taxable }],
      taxable: split.taxable, cgst: split.cgst, sgst: split.sgst, igst: split.igst, total: refunded, billing: order.billing, supplier });
    await closeIfSettledTx(w, role);
    mail = () => emailInvoice(deps, inv, "deposit_refunded", {
      roleTitle: role.title, refunded: money(refunded), amount: money(s.amount), gatewayFee: s.gatewayFee ? money(s.gatewayFee) : "", invoiceNumber: inv.number },
      { reference: `Refund ${ref}` });
    return done;
  });
  if (mail) await (mail as () => Promise<unknown>)().catch((err) => console.error("[payments] refund email failed:", err));
  return out;
}

async function markFailed(deps: AppDeps, id: string, reason: string) {
  return inTx(deps, async (w) => {
    const s = await w.m.ledger.settlement(id);
    if (!s || s.status === "succeeded" || s.status === "cancelled") return s;
    const out = await w.m.ledger.updateSettlement(id, { status: "failed", failureReason: reason.slice(0, 500), processedAt: deps.clock.now() });
    await w.m.ops.openReview({ kind: "alert", refType: "deposit_settlement", refId: id, associationId: null,
      payload: { reason: `refund failed: ${reason}`.slice(0, 500), roleId: s.roleId } });
    return out;
  });
}

/** A role that ended with no hire closes once nothing is held and nothing is in flight. */
async function closeIfSettledTx(w: Wf, role: Role) {
  if (role.status !== "closing" || role.hiredMatchId) return;
  const b = await w.m.ledger.balances(role.id);
  if (b.depositHeld === 0 && b.settlementsPending === 0) await closeRoleTx(w, { role, note: "deposit settled" });
}

/** Re-checks a refund in flight with the gateway (webhook, reconcile job, or the finance console). */
export async function syncSettlement(deps: AppDeps, id: string): Promise<Settlement | null> {
  const s = await deps.ledger.settlement(id);
  if (!s) return null;
  if (s.status === "requested") return processSettlement(deps, id);
  if (s.status !== "processing") return s;
  const order = (await deps.ledger.orderById(s.paymentOrderId))!;
  const state = await deps.gateway.getRefund(order.orderId, s.id);
  if (!state) {
    // The gateway never got it (the call failed before reaching it): send it again, same refund id.
    if (s.processedAt && s.processedAt.getTime() < deps.clock.now().getTime() - 10 * 60_000) return sendRefund(deps, s, order);
    return s;
  }
  return applyRefundState(deps, id, state);
}

/** Retry a failed refund: a new settlement for the same amount (the failed one stays as history). */
export async function retrySettlement(deps: AppDeps, input: { settlementId: string; user: User }) {
  const s = await deps.ledger.settlement(input.settlementId);
  if (!s || s.status !== "failed") throw new DomainError("not_retryable", "Only a failed settlement can be retried.", 409);
  return requestSettlement(deps, { roleId: s.roleId, user: input.user, kind: s.kind, amount: s.amount, deductGatewayFee: s.deductGatewayFee,
    reason: `Retry of ${s.id}: ${s.reason}`.slice(0, 500) });
}

/**
 * The payments sweep (scheduled, and every minute in the long-running server): check active orders with the gateway
 * (a missed webhook), retire expired ones, carry out queued settlements (including ones inserted by SQL), and re-check
 * refunds in flight.
 */
export async function reconcilePayments(deps: AppDeps, opts: { orderAgeMinutes?: number } = {}) {
  const out = { ordersChecked: 0, ordersPaid: 0, settlementsProcessed: 0, refundsChecked: 0 };
  const before = new Date(deps.clock.now().getTime() - (opts.orderAgeMinutes ?? 10) * 60_000);
  for (const o of await deps.ledger.staleActiveOrders(before)) {
    try {
      const synced = await syncOrder(deps, o.orderId);
      out.ordersChecked++;
      if (synced.status === "paid") out.ordersPaid++;
      else if (synced.status === "active" && synced.expiresAt.getTime() < deps.clock.now().getTime() - DAY_MS) await deps.ledger.updateOrder(synced.id, { status: "expired" });
    } catch (err) { console.error(`[payments] could not check order ${o.orderId}:`, err); }
  }
  for (const s of await deps.ledger.settlements({ status: ["requested"] })) { await processSettlement(deps, s.id); out.settlementsProcessed++; }
  for (const s of await deps.ledger.settlements({ status: ["processing"] })) {
    try { await syncSettlement(deps, s.id); out.refundsChecked++; } catch (err) { console.error(`[payments] could not check refund ${s.id}:`, err); }
  }
  return out;
}

// ---------------------------------------------------------------- invoices

export async function invoicePdf(deps: AppDeps, inv: Invoice, extras: { status?: string; reference?: string } = {}) {
  const role = await deps.roles.require(inv.roleId);
  const adjustments: Array<{ label: string; amount: number }> = [];
  if (inv.kind === "tax_invoice" && !inv.paymentOrderId) {
    const b = await deps.ledger.balances(inv.roleId);
    if (b.depositApplied) adjustments.push({ label: "Less: deposit adjusted", amount: b.depositApplied });
    if (b.feePaid) adjustments.push({ label: "Less: paid", amount: b.feePaid });
    adjustments.push({ label: "Balance payable", amount: Math.max(0, b.feeOutstanding) });
  }
  return renderInvoicePdf(inv, { roleTitle: role.title, adjustments, ...extras });
}

async function emailInvoice(deps: AppDeps, inv: Invoice, template: "deposit_paid" | "fee_raised" | "fee_paid" | "deposit_refunded",
  data: Record<string, unknown>, extras: { status?: string; reference?: string } = {}) {
  const pdf = await invoicePdf(deps, inv, extras);
  const { companyId } = await deps.roles.require(inv.roleId);
  await sendToCompany(deps, companyId, template, { ...data, invoiceId: inv.id }, {
    attachments: [{ filename: `${inv.number.replace(/\//g, "-")}.pdf`, content: pdf }], billingEmail: inv.billing.email });
}
