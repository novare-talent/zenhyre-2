import { NextResponse, type NextRequest } from "next/server";

// Fast path only: no session cookie means no seat. The seat layouts re-check with the API.
const SEATS = ["candidate", "company", "association"];

export function proxy(req: NextRequest) {
  const first = req.nextUrl.pathname.split("/")[1] ?? "";
  const sid = req.cookies.get("zh_session")?.value;
  const seat = req.cookies.get("zh_seat")?.value;
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url));
  if (!sid) return to(SEATS.includes(first) ? `/login?as=${first}` : "/login");
  if (SEATS.includes(first) && seat !== first) return to(seat && SEATS.includes(seat) ? `/${seat}` : "/welcome");
  return NextResponse.next();
}

export const config = { matcher: ["/candidate/:path*", "/company/:path*", "/association/:path*", "/welcome"] };
