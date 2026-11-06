import { NextResponse, type NextRequest } from "next/server";
import { apiFetch, clearAuthCookies, COOKIE, here, sameOrigin } from "@/lib/session";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sid = req.cookies.get(COOKIE.session)?.value;
  if (sid) await apiFetch("/auth/signout", { method: "POST", session: sid }).catch(() => {});
  const res = NextResponse.redirect(here(req, "/"), 303);
  clearAuthCookies(res);
  return res;
}
