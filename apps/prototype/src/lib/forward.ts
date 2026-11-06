import { NextResponse, type NextRequest } from "next/server";
import { apiFetch, COOKIE, sameOrigin } from "./session";

/** Forward a same-origin JSON request to the API with the session cookie, and relay the answer. */
export async function forward(req: NextRequest, method: "POST" | "PUT", path: string, body?: unknown) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sid = req.cookies.get(COOKIE.session)?.value;
  if (!sid) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const payload = body === undefined ? await req.json().catch(() => ({})) : body;
  try {
    const r = await apiFetch(path, { method, session: sid, body: JSON.stringify(payload) });
    const json = await r.json().catch(() => ({}));
    return NextResponse.json(json, { status: r.status });
  } catch {
    return NextResponse.json({ error: "down", message: "The server did not answer. Try again in a minute." }, { status: 502 });
  }
}
