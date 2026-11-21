import { createHmac, timingSafeEqual } from "node:crypto";
import type { Paise } from "@zenhyre/shared";
import { GatewayError, type CreateOrder, type OrderState, type PaymentGateway, type RefundState } from "./types";

export interface CashfreeConfig {
  env: "sandbox" | "production";
  appId: string;
  secretKey: string;
  /** Sent as `x-api-version`. */
  apiVersion: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const BASE = { sandbox: "https://sandbox.cashfree.com/pg", production: "https://api.cashfree.com/pg" } as const;
const toRupees = (p: Paise) => Number((p / 100).toFixed(2));
const toPaise = (r: unknown) => Math.round(Number(r) * 100);

/**
 * Cashfree Payment Gateway (PG API). Orders: POST /orders, GET /orders/{id}, GET /orders/{id}/payments.
 * Refunds: POST /orders/{id}/refunds, GET /orders/{id}/refunds/{refund_id}. Charges: GET /orders/{id}/settlements.
 * Webhooks: base64(HMAC-SHA256(x-webhook-timestamp + raw body, secret key)) in x-webhook-signature.
 */
export function cashfreeGateway(cfg: CashfreeConfig): PaymentGateway {
  const f = cfg.fetch ?? fetch;
  const base = BASE[cfg.env];

  async function call(method: string, path: string, body?: unknown, opts: { allow404?: boolean; idempotencyKey?: string } = {}) {
    const headers: Record<string, string> = {
      "x-client-id": cfg.appId, "x-client-secret": cfg.secretKey, "x-api-version": cfg.apiVersion, accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (opts.idempotencyKey) headers["x-idempotency-key"] = opts.idempotencyKey;
    const res = await f(`${base}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(cfg.timeoutMs ?? 20_000) });
    const text = await res.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (res.status === 404 && opts.allow404) return null;
    if (!res.ok) throw new GatewayError(`cashfree ${method} ${path}: ${res.status} ${json?.message ?? text}`.slice(0, 500), res.status, json);
    return json;
  }

  const refundState = (r: any): RefundState => ({
    cfRefundId: r?.cf_refund_id != null ? String(r.cf_refund_id) : null,
    status: r?.refund_status === "SUCCESS" ? "succeeded" : ["CANCELLED", "FAILED"].includes(r?.refund_status) ? "failed" : "pending",
    failureReason: ["CANCELLED", "FAILED"].includes(r?.refund_status) ? String(r?.status_description ?? r?.refund_status) : undefined,
    raw: r ?? {},
  });

  return {
    provider: "cashfree",
    mode: cfg.env,
    async createOrder(o: CreateOrder) {
      const json = await call("POST", "/orders", {
        order_id: o.orderId,
        order_amount: toRupees(o.amount),
        order_currency: "INR",
        order_note: o.note.slice(0, 200),
        order_expiry_time: o.expiresAt.toISOString(),
        customer_details: { customer_id: o.customer.id, customer_email: o.customer.email, customer_phone: o.customer.phone, customer_name: o.customer.name },
        // Cashfree only posts webhooks to https; on a local http setup the API's sweep confirms payments instead.
        order_meta: { return_url: o.returnUrl, ...(o.notifyUrl.startsWith("https://") ? { notify_url: o.notifyUrl } : {}) },
      }, { idempotencyKey: o.orderId });
      if (!json?.payment_session_id) throw new GatewayError("cashfree: no payment_session_id in the order response", undefined, json);
      return { cfOrderId: String(json.cf_order_id), paymentSessionId: String(json.payment_session_id), raw: json };
    },
    async getOrder(orderId) {
      const order = await call("GET", `/orders/${encodeURIComponent(orderId)}`);
      const payments: any[] = (await call("GET", `/orders/${encodeURIComponent(orderId)}/payments`)) ?? [];
      const ok = payments.find((p) => p.payment_status === "SUCCESS");
      const failed = payments.filter((p) => p.payment_status !== "SUCCESS").at(0);
      const s = order?.order_status;
      const state: OrderState = {
        status: ok || s === "PAID" ? "paid" : s === "EXPIRED" ? "expired" : s === "TERMINATED" ? "cancelled" : "active",
        raw: { order, payments },
        lastFailure: failed ? String(failed.payment_message ?? failed.payment_status) : undefined,
      };
      if (ok) {
        state.payment = { cfPaymentId: String(ok.cf_payment_id), amount: toPaise(ok.payment_amount), method: ok.payment_group ?? null,
          paidAt: new Date(ok.payment_completion_time ?? ok.payment_time ?? Date.now()) };
      }
      return state;
    },
    async createRefund(r) {
      const json = await call("POST", `/orders/${encodeURIComponent(r.orderId)}/refunds`, {
        refund_amount: toRupees(r.amount), refund_id: r.refundId, refund_note: r.note.slice(0, 100), refund_speed: "STANDARD" },
        { idempotencyKey: r.refundId });
      return refundState(json);
    },
    async getRefund(orderId, refundId) {
      const json = await call("GET", `/orders/${encodeURIComponent(orderId)}/refunds/${encodeURIComponent(refundId)}`, undefined, { allow404: true });
      return json ? refundState(json) : null;
    },
    async charges(orderId) {
      try {
        const json = await call("GET", `/orders/${encodeURIComponent(orderId)}/settlements`, undefined, { allow404: true });
        if (!json || json.service_charge == null) return null;
        return toPaise(json.service_charge) + toPaise(json.service_tax ?? 0);
      } catch { return null; }
    },
    verifyWebhook(rawBody, timestamp, signature) {
      if (!timestamp || !signature) return false;
      const expected = createHmac("sha256", cfg.secretKey).update(timestamp + rawBody).digest("base64");
      const a = Buffer.from(expected), b = Buffer.from(signature);
      return a.length === b.length && timingSafeEqual(a, b);
    },
  };
}
