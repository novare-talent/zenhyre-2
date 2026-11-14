import { NextResponse, type NextRequest } from "next/server";
import { apiFetch, COOKIE, sameOrigin } from "@/lib/session";

/**
 * Same-origin proxy for the staff console: /api/staff/<path> forwards to the API's /admin/<path> with the session
 * cookie. The API does the staff check (`requireStaff`); this only limits which admin routes are reachable.
 */
const ALLOWED = [
  /^\/reviews(\/[^/]+\/resolve)?$/,
  /^\/roles(\/[^/]+(\/(fee-terms|release-terms|waive-deposit|extend-broadcast|close-broadcast))?)?$/,
  /^\/config(\/[a-z_.]+)?$/,
  /^\/associations$/,
  /^\/companies\/[^/]+\/merge$/,
  /^\/jobs\/[a-z_.]+\/run$/,
];

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = "/" + path.map(encodeURIComponent).join("/");
  if (!ALLOWED.some((re) => re.test(target))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (req.method !== "GET" && !sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sid = req.cookies.get(COOKIE.session)?.value;
  if (!sid) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = req.method === "GET" ? undefined : await req.text();
  try {
    const r = await apiFetch(`/admin${target}${req.nextUrl.search}`, { method: req.method, session: sid, body: body || undefined, headers: body ? { "content-type": "application/json" } : {} });
    const json = await r.json().catch(() => ({}));
    return NextResponse.json(json, { status: r.status });
  } catch {
    return NextResponse.json({ error: "down", message: "The server did not answer. Try again in a minute." }, { status: 502 });
  }
}
export { proxy as GET, proxy as POST, proxy as PUT };
