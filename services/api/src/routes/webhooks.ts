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
