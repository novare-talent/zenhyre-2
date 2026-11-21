import { createDb } from "@zenhyre/db";
import { systemClock } from "@zenhyre/shared";
import { ResendTransport, ConsoleTransport } from "@zenhyre/notify";
import { fixtureGateModel } from "@zenhyre/gate";
import type { AppConfig } from "./context";
import { authFromEnv } from "./auth/fromEnv";
import { gatewayFromEnv } from "./payments/fromEnv";

/** The API's configuration from environment variables, shared by the long-running server and the Vercel function. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const production = env.NODE_ENV === "production";
  const { db } = createDb(env.DATABASE_URL);
  // Without a key, dev prints emails (sign-in links included) to the log. Production refuses to start rather than
  // silently dropping every email, which would make sign-in fail with no error.
  if (production && !env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is required in production: without it no sign-in email is sent");
  const transport = env.RESEND_API_KEY
    ? new ResendTransport(env.RESEND_API_KEY, env.MAIL_FROM ?? "Zenhyre <no-reply@zenhyre.com>")
    : new ConsoleTransport();
  // The gate's model pass has no live model in this slice (spec §14: fixtures only). In production none is configured, so every
  // role that passes the rules waits for a person. In dev a fixture accepts whatever passed the rules, so the loop can be walked
  // locally without staff; set GATE_MODEL=none to get the production behaviour.
  const gateModel = production || env.GATE_MODEL === "none" ? undefined
    : fixtureGateModel((role) => ({ score: 80, suggested_reach: role.campusReach, concerns: [], reason: "Dev fixture: accepted at the model pass." }));
  if (gateModel) console.log("gate: dev fixture model in use (accepts every role that passes the rules)");
  return {
    db, clock: systemClock, transport, gateModel, auth: authFromEnv(env),
    baseUrl: env.APP_BASE_URL ?? "http://localhost:3000",
    webhookSecret: env.RESEND_WEBHOOK_SECRET,
    cronSecret: env.CRON_SECRET || undefined,
    gateway: gatewayFromEnv(env),
    paymentWebhookUrl: env.PAYMENT_WEBHOOK_URL || undefined,
    orderExpiryMinutes: Number(env.CASHFREE_ORDER_EXPIRY_MINUTES || 60),
  };
}
