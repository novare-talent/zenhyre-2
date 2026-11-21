import { NextResponse, type NextRequest } from "next/server";
import { API_URL } from "@/lib/session";

/**
 * Cashfree's webhook lands on the public web domain (nginx → this app) and is passed, byte for byte, to the private
 * API, which verifies the signature with the secret key it alone holds. No cookies, no parsing: re-serialising the JSON
 * would break the signature. The API stays unreachable from the internet.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const headers: Record<string, string> = { "content-type": "application/json" };
  for (const h of ["x-webhook-signature", "x-webhook-timestamp", "x-webhook-version", "x-idempotency-key"]) {
    const v = req.headers.get(h);
    if (v) headers[h] = v;
  }
  try {
    const r = await fetch(`${API_URL}/webhooks/cashfree`, { method: "POST", body: raw, headers, cache: "no-store" });
    return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
  } catch {
    // Cashfree retries on a non-2xx, and the API's sweep checks open orders with Cashfree anyway.
    return NextResponse.json({ error: "down" }, { status: 502 });
  }
}
