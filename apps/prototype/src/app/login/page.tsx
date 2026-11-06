import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Bar } from "@/components/Bar";
import { rulesFromConfig } from "@/lib/config";
import { currentSession, heldSeats, isSeat } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to Zenhyre as a candidate, a company or an alumni association. Each email holds one role, and a sign-in link replaces the password.",
};

const ERRORS: Record<string, string> = {
  link: "That link has expired or was already used. Links work once, for 15 minutes. Ask for a new one below.",
  association: "There is no association login for that email. Association logins are created by Novare Talent and given to you: use the address they set up, or ask your Novare contact.",
  expired: "You were logged out. Log in again to carry on.",
  down: "We could not reach the server. Try again in a minute.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ as?: string; error?: string }> }) {
  const sp = await searchParams;
  const s = await currentSession();
  if (s && !sp.error) {
    const held = heldSeats(s.me);
    if (s.seat && held.includes(s.seat)) redirect(`/${s.seat}`);
    if (!held.length) redirect("/welcome");
  }
  return (
    <>
      <Bar />
      <main id="main" tabIndex={-1} className="auth wrap grid12">
        <div className="auth__copy">
          <h1 className="display t-xl post-solid">Log in to your seat.</h1>
          <p className="lede post" style={{ "--i": 3 } as React.CSSProperties}>Each email holds one role. There is no password: we email you a link that works once.</p>
          <ul className="auth__points post" style={{ "--i": 5 } as React.CSSProperties}>
            <li>Candidates use their campus LDAP ID or a personal email.</li>
            <li>Companies use a work email on their own domain, nothing else.</li>
            <li>Associations use the login Novare Talent created for them.</li>
          </ul>
        </div>
        <div className="auth__form post" style={{ "--i": 2 } as React.CSSProperties}>
          <LoginForm initialRole={isSeat(sp.as) ? sp.as : null} error={sp.error ? ERRORS[sp.error] ?? null : null} freemail={rulesFromConfig().freemailDomains} />
        </div>
      </main>
    </>
  );
}
