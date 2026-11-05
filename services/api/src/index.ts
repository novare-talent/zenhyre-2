import { serve } from "@hono/node-server";
import { createDb } from "@zenhyre/db";
import { systemClock } from "@zenhyre/shared";
import { ResendTransport, MemoryTransport, ConsoleTransport } from "@zenhyre/notify";
import { buildApp } from "./app";

const { db } = createDb();
const transport = process.env.RESEND_API_KEY
  ? new ResendTransport(process.env.RESEND_API_KEY, process.env.MAIL_FROM ?? "Zenhyre <no-reply@zenhyre.com>")
  // No key: print emails (sign-in links included) to the log in dev; never log tokens in production.
  : process.env.NODE_ENV === "production" ? new MemoryTransport() : new ConsoleTransport();
const app = await buildApp({ db, clock: systemClock, transport, baseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000", webhookSecret: process.env.RESEND_WEBHOOK_SECRET });
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4000) }, (i) => console.log(`api on :${i.port}`));
