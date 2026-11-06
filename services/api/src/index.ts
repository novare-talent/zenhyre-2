import { serve } from "@hono/node-server";
import { createDb } from "@zenhyre/db";
import { systemClock } from "@zenhyre/shared";
import { ResendTransport, MemoryTransport, ConsoleTransport } from "@zenhyre/notify";
import { fixtureGateModel } from "@zenhyre/gate";
import { buildApp } from "./app";

const { db } = createDb();
const transport = process.env.RESEND_API_KEY
  ? new ResendTransport(process.env.RESEND_API_KEY, process.env.MAIL_FROM ?? "Zenhyre <no-reply@zenhyre.com>")
  // No key: print emails (sign-in links included) to the log in dev; never log tokens in production.
  : process.env.NODE_ENV === "production" ? new MemoryTransport() : new ConsoleTransport();
// The gate's model pass has no live model in this slice (spec §14: fixtures only). In production none is configured, so every
// role that passes the rules waits for a person. In dev a fixture accepts whatever passed the rules, so the loop can be walked
// locally without staff; set GATE_MODEL=none to get the production behaviour.
const gateModel = process.env.NODE_ENV === "production" || process.env.GATE_MODEL === "none" ? undefined
  : fixtureGateModel((role) => ({ score: 80, suggested_reach: role.campusReach, concerns: [], reason: "Dev fixture: accepted at the model pass." }));
if (gateModel) console.log("gate: dev fixture model in use (accepts every role that passes the rules)");
const app = await buildApp({ db, clock: systemClock, transport, gateModel, baseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000", webhookSecret: process.env.RESEND_WEBHOOK_SECRET });
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4000) }, (i) => console.log(`api on :${i.port}`));
