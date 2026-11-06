import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, heldSeats, here, loadMe, sameOrigin, setAuthCookie } from "@/lib/session";

/** For a signed-in person with no role yet who opened their link on another device: pick candidate or company. */
export async function POST(req: NextRequest) {
  const go = (path: string) => NextResponse.redirect(here(req, path), 303);
  if (!sameOrigin(req)) return go("/login");
  const sid = req.cookies.get(COOKIE.session)?.value;
  const seat = String((await req.formData().catch(() => null))?.get("seat") ?? "");
  if (!sid || (seat !== "candidate" && seat !== "company")) return go("/welcome");
  const loaded = await loadMe(sid);
  if (loaded.status !== "ok") return go("/auth/expired");
  const held = heldSeats(loaded.me);
  const res = go(held.length ? `/${held[0]}` : "/welcome");
  setAuthCookie(res, req, COOKIE.seat, held[0] ?? seat);
  return res;
}
