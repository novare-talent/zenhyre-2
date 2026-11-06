"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Seat = "candidate" | "company" | "association";
const LABEL: Record<Seat, string> = { candidate: "Candidate", company: "Company", association: "Association" };

/**
 * The top bar. Signed out: the wordmark and Log in. Signed in: the one seat this login sits in,
 * the address it belongs to, and Log out. There is no way to hop between seats.
 */
export function Bar({ session }: { session?: { email: string; seat: Seat } }) {
  const path = usePathname();
  return (
    <header className="bar">
      <div className="wrap bar__in">
        <Link href={session ? `/${session.seat}` : "/"} className="wordmark" aria-label={session ? `Zenhyre, ${LABEL[session.seat]} home` : "Zenhyre, home"}>
          <span className="wordmark__lamp" aria-hidden="true" />Zenhyre
        </Link>
        {session ? (
          <>
            <nav className="bar__seats bar__seat" aria-label="Your seat">
              <Link href={`/${session.seat}`} className="lamp" aria-current="page">{LABEL[session.seat]} seat</Link>
            </nav>
            <p className="bar__who"><b className="mono">{session.email}</b><span>Signed in</span></p>
            <form className="bar__out" action="/api/auth/logout" method="post">
              <button type="submit" className="btn btn--sm">Log out</button>
            </form>
          </>
        ) : path === "/login" || path.startsWith("/auth") || path === "/welcome" ? (
          <Link href="/" className="lamp bar__login">Back to the board</Link>
        ) : (
          <Link href="/login" className="btn btn--ink btn--sm bar__login">Log in</Link>
        )}
      </div>
    </header>
  );
}

/** Tabs inside a seat. On phones this becomes the bottom bar. */
export function Tabs({ label, items }: { label: string; items: { href: string; label: string; count?: number }[] }) {
  const path = usePathname();
  const current = [...items].sort((a, b) => b.href.length - a.href.length).find((t) => path === t.href || path.startsWith(t.href + "/"))?.href ?? items[0]?.href;
  return (
    <nav className="tabs wrap" aria-label={label}>
      {items.map((t) => (
        <Link key={t.href} href={t.href} className="lamp" aria-current={t.href === current ? "page" : undefined}>
          {t.label}{t.count ? <span className="count" aria-label={`${t.count} open`}>{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
