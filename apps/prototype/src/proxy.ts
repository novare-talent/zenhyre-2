import { NextResponse, type NextRequest } from "next/server";

// Runs before pages and route handlers. Two jobs:
// 1. Keep the sign-in alive: the access token in zh_session lasts an hour, so shortly before it expires (or once it
//    has) we swap the refresh token for a new pair through the API and hand the fresh cookies both to the browser and
//    to this same request, so the page or handler that runs next already sees them.
// 2. Fast path for the seats: no session cookie means no seat. The seat layouts re-check with the API.
const SEATS = ["candidate", "company", "association"];
const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const REFRESH_EARLY_S = 60;

type Fresh = { accessToken: string; refreshToken: string; expiresAt: number };

async function refreshed(req: NextRequest): Promise<Fresh | "gone" | null> {
  const refresh = req.cookies.get("zh_refresh")?.value;
  if (!refresh) return null;
  const exp = Number(req.cookies.get("zh_exp")?.value ?? 0);
  const hasAccess = !!req.cookies.get("zh_session")?.value;
  if (hasAccess && exp - Date.now() / 1000 > REFRESH_EARLY_S) return null;
  try {
    const r = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(5000),
      headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: refresh }),
    });
    if (r.status === 401) return "gone";
    if (!r.ok) return null; // API trouble: keep what we have; the page will report it
    return ((await r.json()) as { session: Fresh }).session;
  } catch { return null; }
}

const secure = (req: NextRequest) => process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "1"
  : req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";

export async function proxy(req: NextRequest) {
  const fresh = await refreshed(req);
  if (fresh === "gone") {
    req.cookies.delete("zh_session"); req.cookies.delete("zh_refresh"); req.cookies.delete("zh_exp");
  } else if (fresh) {
    req.cookies.set("zh_session", fresh.accessToken);
    req.cookies.set("zh_refresh", fresh.refreshToken);
    req.cookies.set("zh_exp", String(fresh.expiresAt));
  }

  const first = req.nextUrl.pathname.split("/")[1] ?? "";
  const gated = SEATS.includes(first) || first === "welcome";
  const sid = req.cookies.get("zh_session")?.value;
  const seat = req.cookies.get("zh_seat")?.value;
  let res: NextResponse;
  if (gated && !sid) res = NextResponse.redirect(new URL(SEATS.includes(first) ? `/login?as=${first}` : "/login", req.url));
  else if (SEATS.includes(first) && seat !== first) res = NextResponse.redirect(new URL(seat && SEATS.includes(seat) ? `/${seat}` : "/welcome", req.url));
  else res = NextResponse.next({ request: { headers: req.headers } });

  const opts = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 30 * 24 * 3600, secure: secure(req) };
  if (fresh === "gone") for (const n of ["zh_session", "zh_refresh", "zh_exp"]) res.cookies.set(n, "", { path: "/", maxAge: 0 });
  else if (fresh) {
    res.cookies.set("zh_session", fresh.accessToken, opts);
    res.cookies.set("zh_refresh", fresh.refreshToken, opts);
    res.cookies.set("zh_exp", String(fresh.expiresAt), opts);
  }
  return res;
}

// Everything except static assets and the sign-in steps themselves (they set the cookies).
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml|api/auth/start|api/auth/redeem|.*\\.(?:png|jpg|jpeg|svg|webp|woff2?)$).*)"] };
