import { NextResponse, type NextRequest } from "next/server";
import { clearAuthCookies, here } from "@/lib/session";

/** A session the API no longer recognises: clear the cookies (a page render cannot) and send them to log in. */
export function GET(req: NextRequest) {
  const why = req.nextUrl.searchParams.get("why") === "association" ? "association" : "expired";
  const res = NextResponse.redirect(here(req, why === "association" ? "/login?as=association&error=association" : "/login?error=expired"), 303);
  clearAuthCookies(res);
  return res;
}
