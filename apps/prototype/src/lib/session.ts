// Server-only session layer. The browser never talks to the API directly: these helpers and the
// route handlers under /api forward the HTTP-only session cookie to it (spec §3.2: server-backed
// sessions as HTTP-only cookies). One login sits in exactly one seat, held in the zh_seat cookie.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest, NextResponse } from "next/server";

export const SEATS = ["candidate", "company", "association"] as const;
export type Seat = (typeof SEATS)[number];
export const isSeat = (v: unknown): v is Seat => typeof v === "string" && (SEATS as readonly string[]).includes(v);
export const SEAT_LABEL: Record<Seat, string> = { candidate: "Candidate", company: "Company", association: "Association" };

export const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
export const COOKIE = { session: "zh_session", seat: "zh_seat", intent: "zh_intent" } as const;
const THIRTY_DAYS = 30 * 24 * 3600;

export interface Me {
  user: { id: string; isStaff: boolean };
  emails: { email: string; isPrimary: boolean; verified: boolean }[];
  candidate: null | {
    gradDate: string; course: string; rollNumber: string | null; rollNumberFlag: boolean;
    status: "student" | "final_year" | "alumnus";
    verificationState: "verified" | "referral_pending" | "verification_pending" | "rejected";
    verificationSource: "campus_email" | "referral" | "association" | "staff";
    verificationAttempts: number; verifiedAt: string | null; openToOpportunities: boolean;
    profile: { headline?: string; skills?: string[]; years_experience?: number; preferred_roles?: string[]; preferred_locations?: string[]; notice_period_days?: number; linkedin_url?: string };
  };
  campus: null | { id: string; name: string; shortCode: string };
  membership: null | { companyId: string; role: "owner" | "member"; lockedAt: string | null };
  company: null | { id: string; name: string; verifiedDomain: string; status: "active" | "probation" | "banned" };
  associations: { id: string; name: string; shareRate: string; payoutMode: "cash" | "sponsorship_credit"; mouSignedAt: string | null; campus: { name: string; shortCode: string } | null }[];
}

export function apiFetch(path: string, init: RequestInit & { session?: string } = {}) {
  const { session, headers, ...rest } = init;
  return fetch(`${API_URL}${path}`, {
    ...rest, cache: "no-store", signal: AbortSignal.timeout(8000),
    headers: { ...(rest.body ? { "content-type": "application/json" } : {}), ...(session ? { cookie: `${COOKIE.session}=${session}` } : {}), ...headers },
  });
}

export type MeResult = { status: "ok"; me: Me } | { status: "unauth" } | { status: "down" };
export async function loadMe(session: string): Promise<MeResult> {
  try {
    const r = await apiFetch("/me", { session });
    if (r.status === 401) return { status: "unauth" };
    if (!r.ok) return { status: "down" };
    return { status: "ok", me: (await r.json()) as Me };
  } catch { return { status: "down" }; }
}

/** The seats this person actually holds, derived from membership rows (§4.1). */
export const heldSeats = (me: Me): Seat[] => [
  me.candidate ? "candidate" as const : null,
  me.membership && !me.membership.lockedAt ? "company" as const : null,
  me.associations.length ? "association" as const : null,
].filter((s): s is Seat => s !== null);
export const primaryEmail = (me: Me) => me.emails.find((e) => e.isPrimary)?.email ?? me.emails[0]?.email ?? "";

/** For pages that only want to know whether someone is signed in. */
export async function currentSession(): Promise<{ me: Me; seat: Seat | null; email: string } | null> {
  const jar = await cookies();
  const sid = jar.get(COOKIE.session)?.value;
  if (!sid) return null;
  const r = await loadMe(sid);
  if (r.status !== "ok") return null;
  const seat = jar.get(COOKIE.seat)?.value;
  return { me: r.me, seat: isSeat(seat) ? seat : null, email: primaryEmail(r.me) };
}

/** Gate for a seat layout. The API is the authority; the proxy's cookie check is only a fast path. */
export async function requireSeat(seat: Seat): Promise<{ me: Me; email: string }> {
  const jar = await cookies();
  const sid = jar.get(COOKIE.session)?.value;
  if (!sid) redirect(`/login?as=${seat}`);
  const r = await loadMe(sid);
  if (r.status === "down") throw new Error("api_unreachable");
  if (r.status === "unauth") redirect("/auth/expired");
  const chosen = jar.get(COOKIE.seat)?.value;
  if (chosen !== seat) redirect(isSeat(chosen) ? `/${chosen}` : "/welcome");
  if (!heldSeats(r.me).includes(seat)) redirect(seat === "association" ? "/auth/expired?why=association" : "/welcome");
  return { me: r.me, email: primaryEmail(r.me) };
}

const secure = (req: NextRequest) => process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "1"
  : req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
export function setAuthCookie(res: NextResponse, req: NextRequest, name: string, value: string, maxAge = THIRTY_DAYS) {
  res.cookies.set(name, value, { httpOnly: true, sameSite: "lax", path: "/", maxAge, secure: secure(req) });
}
export function clearAuthCookies(res: NextResponse) {
  for (const name of Object.values(COOKIE)) res.cookies.set(name, "", { path: "/", maxAge: 0 });
}
/** Mutating handlers accept same-origin requests only. SameSite=Lax already blocks cross-site POSTs; this is the second lock. */
export function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin navigations and non-browser clients send none
  try { return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host")); } catch { return false; }
}
/** Absolute URL on the public origin, honouring a reverse proxy. */
export function here(req: NextRequest, path: string) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  return new URL(path, `${proto}://${host}`);
}
