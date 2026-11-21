import { createHmac } from "node:crypto";
import type { Paise } from "@zenhyre/shared";
import { GatewayError, type OrderState, type PaymentGateway, type RefundState } from "./types";

interface FakeOrder { orderId: string; amount: Paise; state: OrderState; refunds: Map<string, RefundState & { amount: Paise }> }

/**
 * An in-memory gateway for tests and offline dev (`PAYMENT_PROVIDER=fake`). Checkout is simulated by `pay`, which the
 * dev-only route behind the web app's fake checkout page calls. Refunds succeed at once unless `refunds = "pending"`.
 */
export function fakeGateway(opts: { secret?: string; refunds?: "succeed" | "pending" | "fail"; chargeRate?: number } = {}) {
  const orders = new Map<string, FakeOrder>();
  const secret = opts.secret ?? "fake-secret";
  let seq = 0;
  const must = (id: string) => {
    const o = orders.get(id);
    if (!o) throw new GatewayError(`fake: no order ${id}`, 404);
    return o;
  };
  const gateway = {
    provider: "fake" as const,
    mode: "fake" as const,
    refundMode: opts.refunds ?? "succeed",
    async createOrder(o) {
      const existing = orders.get(o.orderId);
      if (!existing) orders.set(o.orderId, { orderId: o.orderId, amount: o.amount, state: { status: "active", raw: {} }, refunds: new Map() });
      return { cfOrderId: `cf_${o.orderId}`, paymentSessionId: `fake_session_${o.orderId}`, raw: { fake: true } };
    },
    async getOrder(orderId) { return must(orderId).state; },
    async createRefund(r) {
      const o = must(r.orderId);
      const prior = o.refunds.get(r.refundId);
      if (prior) return prior;
      const refunded = [...o.refunds.values()].filter((x) => x.status !== "failed").reduce((s, x) => s + x.amount, 0);
      if (o.state.status !== "paid") throw new GatewayError("fake: order not paid", 400);
      if (refunded + r.amount > o.amount) throw new GatewayError("fake: refund exceeds the order amount", 400);
      const mode = gateway.refundMode;
      const state = { cfRefundId: `cfr_${++seq}`, amount: r.amount, raw: { fake: true },
        status: mode === "succeed" ? "succeeded" : mode === "fail" ? "failed" : "pending",
        failureReason: mode === "fail" ? "fake refund failure" : undefined } as RefundState & { amount: Paise };
      o.refunds.set(r.refundId, state);
      return state;
    },
    async getRefund(orderId, refundId) { return orders.get(orderId)?.refunds.get(refundId) ?? null; },
    async charges(orderId) {
      const o = orders.get(orderId);
      return o && opts.chargeRate !== undefined ? Math.round(o.amount * opts.chargeRate) : null;
    },
    verifyWebhook(rawBody, timestamp, signature) {
      return createHmac("sha256", secret).update(timestamp + rawBody).digest("base64") === signature;
    },
    // ---- test and dev controls ----
    /** Simulates the company completing (or failing) checkout. */
    pay(orderId: string, outcome: "success" | "failed" = "success", at = new Date()) {
      const o = must(orderId);
      if (outcome === "failed") { o.state = { ...o.state, lastFailure: "Payment declined (simulated)" }; return o.state; }
      o.state = { status: "paid", raw: { fake: true }, payment: { cfPaymentId: `cfp_${orderId}`, amount: o.amount, method: "upi", paidAt: at } };
      return o.state;
    },
    expire(orderId: string) { must(orderId).state = { status: "expired", raw: {} }; },
    /** Settles a pending refund, as Cashfree's REFUND_STATUS_WEBHOOK would report. */
    settleRefund(orderId: string, refundId: string, status: "succeeded" | "failed" = "succeeded") {
      const r = must(orderId).refunds.get(refundId);
      if (!r) throw new GatewayError("fake: no such refund", 404);
      r.status = status;
      if (status === "failed") r.failureReason = "fake refund failure";
      return r;
    },
    /** Signs a webhook body as the real gateway would. */
    sign(rawBody: string, timestamp = String(Math.floor(Date.now() / 1000))) {
      return { timestamp, signature: createHmac("sha256", secret).update(timestamp + rawBody).digest("base64") };
    },
    orders,
  } satisfies PaymentGateway & Record<string, unknown>;
  return gateway;
}
export type FakeGateway = ReturnType<typeof fakeGateway>;
