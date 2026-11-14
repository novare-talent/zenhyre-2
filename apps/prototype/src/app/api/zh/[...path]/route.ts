import { NextResponse, type NextRequest } from "next/server";
import { apiFetch, COOKIE, sameOrigin } from "@/lib/session";

/**
 * Same-origin proxy for the seat APIs: the browser calls /api/zh/<path> and this forwards it to the API with the
 * HTTP-only session cookie. Only the seat-facing route groups are reachable; auth, admin and webhooks are not.
 */
const ALLOWED = [/^\/companies\/[^/]+\/roles(\/|$)/, /^\/roles\//, /^\/matches\//, /^\/me\/(roles|applications|notifications)(\/|$)/, /^\/association\/reviews(\/|$)/];

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = "/" + path.map(encodeURIComponent).join("/");
  if (!ALLOWED.some((re) => re.test(target))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (req.method !== "GET" && !sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sid = req.cookies.get(COOKIE.session)?.value;
  if (!sid) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = req.method === "GET" ? undefined : await req.text();
  try {
    const r = await apiFetch(target + req.nextUrl.search, { method: req.method, session: sid, body: body || undefined, headers: body ? { "content-type": "application/json" } : {} });
    const json = await r.json().catch(() => ({}));
    return NextResponse.json(json, { status: r.status });
  } catch {
    return NextResponse.json({ error: "down", message: "The server did not answer. Try again in a minute." }, { status: 502 });
  }
}
export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH };
