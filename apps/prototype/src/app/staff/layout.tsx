import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Tabs } from "@/components/Bar";
import { requireStaffSession } from "./guard";

export const metadata: Metadata = { title: { template: "%s · Staff", default: "Staff console" }, robots: { index: false } };

/** §12 staff console. Staff is a flag on the user, not a seat: any signed-in staff member can open it. */
export default async function Layout({ children }: { children: ReactNode }) {
  const s = await requireStaffSession();
  return (
    <>
      <header className="bar">
        <div className="wrap bar__in">
          <Link href="/staff" className="wordmark" aria-label="Zenhyre staff console"><span className="wordmark__lamp" aria-hidden="true" />Zenhyre</Link>
          <nav className="bar__seats bar__seat" aria-label="Console"><Link href="/staff" className="lamp" aria-current="page">Staff console</Link></nav>
          <p className="bar__who"><b className="mono">{s.email}</b><span>Novare staff</span></p>
          <form className="bar__out" action="/api/auth/logout" method="post"><button type="submit" className="btn btn--sm">Log out</button></form>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="seat-main">
        <Tabs label="Staff console" items={[
          { href: "/staff", label: "Queues" },
          { href: "/staff/roles", label: "Roles" },
          { href: "/staff/config", label: "Config" },
          ...(s.me.user.isFinance ? [{ href: "/staff/payments", label: "Payments" }] : []),
        ]} />
        {children}
      </main>
    </>
  );
}
