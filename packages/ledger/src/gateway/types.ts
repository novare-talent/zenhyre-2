import type { Paise } from "@zenhyre/shared";

/**
 * The payment gateway as Zenhyre needs it. Cashfree in production (`cashfree.ts`), an in-memory fake for tests and
 * offline dev (`fake.ts`). Amounts are paise here; adapters convert to the gateway's units.
 */
export interface PaymentGateway {
  readonly provider: "cashfree" | "fake";
  /** For the browser SDK: `sandbox` or `production` (the fake reports `fake`). */
  readonly mode: "sandbox" | "production" | "fake";
  createOrder(input: CreateOrder): Promise<{ cfOrderId: string; paymentSessionId: string; raw: Record<string, unknown> }>;
  /** The gateway's view of an order and its successful payment, if any. The source of truth: never trust a redirect. */
  getOrder(orderId: string): Promise<OrderState>;
  /** Idempotent on `refundId`. */
  createRefund(input: { orderId: string; refundId: string; amount: Paise; note: string }): Promise<RefundState>;
  /** Null when the gateway has no refund with this id. */
  getRefund(orderId: string, refundId: string): Promise<RefundState | null>;
  /** The gateway's actual charge on the order (its fee plus GST), once known; null until settled. */
  charges(orderId: string): Promise<Paise | null>;
  /** Checks a webhook's signature over the raw body. */
  verifyWebhook(rawBody: string, timestamp: string, signature: string): boolean;
}

export interface CreateOrder {
  orderId: string; amount: Paise; note: string; returnUrl: string; notifyUrl: string; expiresAt: Date;
  customer: { id: string; email: string; phone: string; name: string };
}

export type OrderStatus = "active" | "paid" | "expired" | "cancelled";
export interface OrderState {
  status: OrderStatus;
  /** Present when paid. */
  payment?: { cfPaymentId: string; amount: Paise; method: string | null; paidAt: Date };
  /** The latest failed attempt, for the company's message. */
  lastFailure?: string;
  raw: Record<string, unknown>;
}

export type RefundStatus = "pending" | "succeeded" | "failed";
export interface RefundState { cfRefundId: string | null; status: RefundStatus; failureReason?: string; raw: Record<string, unknown> }

export class GatewayError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: unknown) { super(message); }
}
