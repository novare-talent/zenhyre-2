import { Hono } from "hono";
import { z } from "zod";
import { Webhook } from "svix";
import { Vars } from "../context";

export const webhookRoutes = new Hono<{ Variables: Vars }>();

const bounceEvent = z.object({ type: z.string(), data: z.object({ to: z.array(z.string()), bounce: z.object({ message: z.string() }).optional() }) });

webhookRoutes.post("/webhooks/resend", async (c) => {
  const raw = await c.req.text();
  const secret = c.var.deps.webhookSecret;
  let payload: unknown;
  if (secret) {
    try {
      payload = new Webhook(secret).verify(raw, {
        "svix-id": c.req.header("svix-id") ?? "", "svix-timestamp": c.req.header("svix-timestamp") ?? "", "svix-signature": c.req.header("svix-signature") ?? "" });
    } catch { return c.json({ error: "bad signature" }, 401); }
  } else {
    payload = JSON.parse(raw); // tests and local dev run without a secret
  }
  if ((payload as { type?: string })?.type !== "email.bounced") return c.json({ ok: true }); // other subscribed events: ack, don't validate
  const body = bounceEvent.parse(payload);
  const { notify, identity, ops } = c.var.deps;
  for (const email of body.data.to) {
    const userId = await identity.userIdForEmail(email);
    if (!userId) continue; // invites to not-yet-users: nothing to record
    await notify.recordBounce(email, body.data.bounce?.message ?? "bounce");
    if (!(await notify.hasDeliverableEmail(userId))) {
      await ops.openReview({ kind: "alert", refType: "user", refId: userId, associationId: null, payload: { reason: "all emails bouncing" } });
    }
  }
  return c.json({ ok: true });
});

/**
 * Cashfree payment and refund webhooks. Verified by signature over the raw body, stored once (a replay is a no-op), and
 * treated as a hint: the order or refund is then re-read from Cashfree, which is the source of truth. Always 200 once
 * stored, so Cashfree does not retry an event we have; processing errors are kept on the event and alerted.
 */
webhookRoutes.post("/webhooks/cashfree", async (c) => {
  const { deps } = c.var;
  const raw = await c.req.text();
  const ok = deps.gateway.verifyWebhook(raw, c.req.header("x-webhook-timestamp") ?? "", c.req.header("x-webhook-signature") ?? "");
  if (!ok) return c.json({ error: "bad signature" }, 401);
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return c.json({ error: "invalid" }, 400); }
  const type = String(payload?.type ?? "UNKNOWN");
  const data = payload?.data ?? {};
  const orderId: string | undefined = data.order?.order_id ?? data.refund?.order_id;
  const refundId: string | undefined = data.refund?.refund_id;
  const dedupeKey = [type, data.payment?.cf_payment_id ?? data.refund?.cf_refund_id ?? orderId ?? "", data.payment?.payment_status ?? data.refund?.refund_status ?? ""].join(":");
  const stored = await deps.ledger.storeWebhook({ provider: deps.gateway.provider, eventType: type, dedupeKey, payload });
  if (!stored) return c.json({ ok: true, duplicate: true });
  let error: string | null = null;
  try {
    if (type.startsWith("REFUND") && refundId) {
      const { syncSettlement } = await import("../workflows/payments");
      await syncSettlement(deps, refundId);
    } else if (type.startsWith("PAYMENT") && orderId && await deps.ledger.order(orderId)) {
      const { syncOrder } = await import("../workflows/payments");
      await syncOrder(deps, orderId);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error("[webhooks] cashfree event failed:", err);
    await deps.ops.openReview({ kind: "alert", refType: "payment_webhook", refId: stored.id, associationId: null, payload: { reason: `webhook ${type}: ${error}`.slice(0, 500) } }).catch(() => {});
  }
  await deps.ledger.markWebhook(stored.id, error);
  return c.json({ ok: true });
});
