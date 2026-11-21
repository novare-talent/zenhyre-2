import { NextResponse, type NextRequest } from "next/server";
import { apiFetch, COOKIE } from "@/lib/session";

const SAFE = /^[0-9a-f-]{36}$/i;

/** Streams an invoice PDF from the API with the session cookie (the zh proxy is JSON-only). */
export async function streamPdf(req: NextRequest, apiPath: string, ...ids: string[]) {
  if (!ids.every((id) => SAFE.test(id))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const sid = req.cookies.get(COOKIE.session)?.value;
  if (!sid) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const r = await apiFetch(apiPath, { session: sid });
    if (!r.ok) return NextResponse.json({ error: "not_found" }, { status: r.status === 403 ? 403 : 404 });
    return new NextResponse(await r.arrayBuffer(), { headers: {
      "content-type": "application/pdf", "content-disposition": r.headers.get("content-disposition") ?? "inline", "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "down" }, { status: 502 });
  }
}
