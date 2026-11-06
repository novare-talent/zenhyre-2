import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Bar } from "@/components/Bar";
import { campusForEmail } from "@/data/campuses";
import { currentSession, heldSeats } from "@/lib/session";
import { CandidateSetup, CompanySetup } from "./Setup";

export const metadata: Metadata = { title: "Set up your seat", description: "First-time setup for a Zenhyre candidate or company account.", robots: { index: false } };

export default async function Page() {
  const s = await currentSession();
  if (!s) redirect("/login");
  const held = heldSeats(s.me);
  if (held.length) redirect(s.seat && held.includes(s.seat) ? `/${s.seat}` : "/auth/expired");
  const locked = !!s.me.membership?.lockedAt;
  const seat = s.seat === "candidate" || s.seat === "company" ? s.seat : null;
  const campus = campusForEmail(s.email);

  return (
    <>
      <Bar session={seat ? { email: s.email, seat } : undefined} />
      <main id="main" tabIndex={-1} className="auth wrap grid12">
        <div className="auth__copy">
          <h1 className="display t-xl post-solid">{seat === "company" ? "Set up your company." : seat === "candidate" ? "Set up your profile." : "Which seat is yours?"}</h1>
          <p className="lede post" style={{ "--i": 3 } as React.CSSProperties}>
            {seat === "company" ? "Your email is confirmed. Name the company and you can post your first role."
              : seat === "candidate" ? (campus ? `Your ${campus.name} email is confirmed, so you are verified the moment you finish.` : "Your personal email is confirmed. Tell us where and when you studied, and your alumni association will verify you.")
              : "Your email is confirmed. Choose the one role this login is for."}
          </p>
          <p className="small post" style={{ "--i": 5 } as React.CSSProperties}>Signed in as <span className="mono">{s.email}</span></p>
        </div>
        <div className="auth__form post" style={{ "--i": 2 } as React.CSSProperties}>
          {locked ? (
            <p className="note note--stop"><b>This company account is locked.</b>Contact Novare Talent to find out why and what happens next.</p>
          ) : seat === "candidate" ? (
            <CandidateSetup campusCode={campus?.code ?? null} thisYear={new Date().getFullYear()} />
          ) : seat === "company" ? (
            <CompanySetup domain={s.email.split("@")[1] ?? ""} />
          ) : (
            <form action="/api/auth/seat" method="post" className="form">
              <fieldset className="field">
                <legend>I am here as</legend>
                <div className="roles" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                  <label className="role"><input type="radio" name="seat" value="candidate" required /><span className="role__who">IIT student or alum</span><span className="role__name">Candidate</span></label>
                  <label className="role"><input type="radio" name="seat" value="company" required /><span className="role__who">Hiring from the IITs</span><span className="role__name">Company</span></label>
                </div>
              </fieldset>
              <div className="actions"><button type="submit" className="btn btn--ink">Continue</button></div>
            </form>
          )}
        </div>
      </main>
    </>
  );
}
