import { NextResponse, type NextRequest } from "next/server";
import { decideSeat } from "@/lib/seat-decision";
import { apiFetch, clearAuthCookies, COOKIE, heldSeats, here, isSeat, loadMe, sameOrigin, setAuthCookie, type Seat } from "@/lib/session";

/**
 * Step 2 of login: redeem the single-use link, then seat the session in exactly one role.
 * It is a POST from the confirm page, so mail scanners that pre-open links cannot burn the token.
 */
export async function POST(req: NextRequest) {
  const go = (path: string) => NextResponse.redirect(here(req, path), 303);
  if (!sameOrigin(req)) return go("/login?error=link");
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("t") ?? "");
  if (!token) return go("/login?error=link");

  let redeemed: Response;
  try { redeemed = await apiFetch(`/auth/redeem?t=${encodeURIComponent(token)}`); } catch { return go("/login?error=down"); }
  if (!redeemed.ok) return go("/login?error=link");
  const { purpose } = (await redeemed.json()) as { purpose: string };
  const sid = redeemed.headers.getSetCookie().map((c) => c.match(/^zh_session=([^;]+)/)?.[1]).find(Boolean);
  if (!sid) return go("/login?error=link");
  const loaded = await loadMe(sid);
  if (loaded.status !== "ok") return go("/login?error=down");

  const cookieIntent = req.cookies.get(COOKIE.intent)?.value;
  const intent: Seat | null = purpose === "association_admin_invite" ? "association" : purpose === "company_invite" ? "company" : isSeat(cookieIntent) ? cookieIntent : null;
  const decision = decideSeat(intent, heldSeats(loaded.me));
  if (decision.kind === "refuse") {
    // Association logins are created by Novare (§6.5). An address without one gets no session at all.
    await apiFetch("/auth/signout", { method: "POST", session: sid }).catch(() => {});
    const res = go("/login?as=association&error=association");
    clearAuthCookies(res);
    return res;
  }
  const seat = decision.seat;
  const dest = decision.kind === "setup" ? "/welcome" : `/${decision.seat}${decision.notice ? "?notice=role" : ""}`;

  const res = go(dest);
  setAuthCookie(res, req, COOKIE.session, sid);
  if (seat) setAuthCookie(res, req, COOKIE.seat, seat);
  res.cookies.set(COOKIE.intent, "", { path: "/", maxAge: 0 });
  return res;
}
