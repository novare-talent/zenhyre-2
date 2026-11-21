import { cashfreeGateway, fakeGateway, type PaymentGateway } from "@zenhyre/ledger";

/**
 * `PAYMENT_PROVIDER=cashfree` uses Cashfree with `CASHFREE_ENV`, `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY` and
 * `CASHFREE_API_VERSION`. Anything else is the in-memory fake (checkout simulated by the web app's dev page), which
 * production refuses, as it refuses the fake sign-in.
 */
export function gatewayFromEnv(env: NodeJS.ProcessEnv): PaymentGateway {
  const production = env.NODE_ENV === "production";
  if (env.PAYMENT_PROVIDER !== "cashfree") {
    if (production) throw new Error("PAYMENT_PROVIDER=cashfree is required in production: the fake gateway takes no real money");
    console.log("payments: fake gateway (offline dev). Set PAYMENT_PROVIDER=cashfree with sandbox keys to use Cashfree.");
    return fakeGateway();
  }
  const cfEnv = env.CASHFREE_ENV === "production" ? "production" : "sandbox";
  if (!env.CASHFREE_APP_ID || !env.CASHFREE_SECRET_KEY) throw new Error("PAYMENT_PROVIDER=cashfree needs CASHFREE_APP_ID and CASHFREE_SECRET_KEY");
  if (production && cfEnv !== "production") console.warn("payments: NODE_ENV=production with CASHFREE_ENV=sandbox: no real money moves");
  console.log(`payments: Cashfree ${cfEnv}`);
  return cashfreeGateway({ env: cfEnv, appId: env.CASHFREE_APP_ID, secretKey: env.CASHFREE_SECRET_KEY, apiVersion: env.CASHFREE_API_VERSION || "2026-01-01" });
}
