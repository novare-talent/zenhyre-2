import { NextResponse, type NextRequest } from "next/server";
import { campusForEmail } from "@/data/campuses";
import { rulesFromConfig } from "@/lib/config";
import { apiFetch, clientIp, COOKIE, isSeat, sameOrigin, setAuthCookie } from "@/lib/session";

/** Step 1 of login: remember the one role chosen, ask the API to email a sign-in link (§3.2). */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { email?: unknown; role?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return NextResponse.json({ error: "email", message: "Enter a valid email address." }, { status: 400 });
  if (!isSeat(body?.role)) return NextResponse.json({ error: "role", message: "Choose who you are logging in as." }, { status: 400 });
  // Who may log in as what. The API enforces the same rule when the account is created; this answers sooner.
  const kind = campusForEmail(email) ? "campus" : rulesFromConfig().freemailDomains.includes(email.split("@")[1]!) ? "personal" : "work";
  if (body.role === "candidate" && kind === "work") {
    return NextResponse.json({ error: "email", message: "Candidates log in with their campus LDAP ID or a personal email such as Gmail, Outlook or Yahoo. A work address will not do." }, { status: 400 });
  }
  if (body.role === "company" && kind !== "work") {
    return NextResponse.json({ error: "email", message: kind === "campus" ? "That is a campus address. Companies log in with a work email on the company's own domain." : "Companies log in with a work email on the company's own domain. Personal mailboxes such as Gmail, Outlook and Yahoo are not accepted." }, { status: 400 });
  }
  try {
    const r = await apiFetch("/auth/magic-link", { method: "POST", body: JSON.stringify({ email }), headers: { "x-zh-client-ip": clientIp(req) } });
    if (r.status === 429) return NextResponse.json({ error: "slow", message: "Too many sign-in links asked for. Wait a few minutes and try again." }, { status: 429 });
    if (!r.ok) throw new Error(String(r.status));
  } catch {
    return NextResponse.json({ error: "down", message: "We could not send the link just now. Try again in a minute." }, { status: 502 });
  }
  // The same answer whether or not the address is known, so the form cannot be used to probe for accounts.
  const res = NextResponse.json({ ok: true });
  setAuthCookie(res, req, COOKIE.intent, body.role, 20 * 60);
  return res;
}
