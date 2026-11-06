"use client";
import Link from "next/link";
import { useState } from "react";
import { MiniBoard } from "@/components/Board";
import { Countdown } from "@/components/Clock";
import { Arrow, Chevron } from "@/components/Icons";
import { useRules } from "@/components/Rules";
import { BOARD_ROLES, type BoardRole } from "@/data/fixtures";
import { ctcBand, STAGE_LABEL } from "@/lib/rules";
import { useCandidate } from "@/seats/candidate";

const TYPE = { intern: "Internship", fresher: "Fresher role", experienced: "Experienced role" } as const;
const month = (iso: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(new Date(`${iso}T00:00:00`));

export function RolesForYou() {
  const rules = useRules();
  const { me, verificationState, apps, apply, open, profile, retryVerification } = useCandidate();
  const [openId, setOpenId] = useState<string | null>(null);
  // §8 step 2: the role's type must fit where the candidate is in their studies or career.
  const fits = (r: BoardRole) => me.status === "student" ? r.type === "intern"
    : me.status === "final_year" ? r.type !== "experienced"
    : profile.yearsExperience <= 1 ? r.type === "fresher"
    : r.type === "experienced" && profile.yearsExperience >= r.yearsExp[0] && profile.yearsExperience <= r.yearsExp[1];
  const roles = BOARD_ROLES.filter((r) => r.reach.includes(me.campusCode) && fits(r));
  const verified = verificationState === "verified";
  const why = me.status === "student" ? "Internships only, until your final year."
    : me.status === "final_year" ? `Internships and fresher roles, because you graduate in ${month(me.gradDate)}.`
    : `Roles for ${profile.yearsExperience} ${profile.yearsExperience === 1 ? "year" : "years"} of experience. Update it in your profile.`;

  return (
    <div className="work wrap">
      <div className="work__main">
        {verificationState === "verification_pending" || verificationState === "referral_pending" ? (
          <p className="note post" style={{ marginBottom: "1.5rem" }}><b>Your alumni association is checking your details.</b>You can read every role now. Applying opens the moment you are verified, and we will email you.</p>
        ) : verificationState === "rejected" ? (
          <div className="note note--stop post" style={{ marginBottom: "1.5rem" }}>
            <b>Your association could not verify you.</b>The reason was emailed to you.
            {me.verificationAttempts < rules.maxVerificationAttempts
              ? <div className="actions" style={{ marginTop: "0.9rem" }}><button type="button" className="btn btn--sm" onClick={() => retryVerification()}>Ask again</button><span className="meta">You can ask once more.</span></div>
              : <span> You have used both requests. Write to Novare if the decision is wrong.</span>}
          </div>
        ) : null}
        <div className="work__lead">
          <h2 className="display t-m">{roles.length} {roles.length === 1 ? "role reaches" : "roles reach"} your campus</h2>
          <p className="meta">{why}</p>
        </div>
        {roles.length === 0 ? (
          <p className="empty">Nothing on the board fits you today. Leave nudges on and we will email you when something does.</p>
        ) : (
          <ul className="rows">
            {roles.map((r, i) => {
              const app = apps.find((a) => a.id === r.id);
              const isOpen = openId === r.id;
              return (
                <li key={r.id} className={`row post${isOpen ? " is-open" : ""}`} style={{ "--i": i + 2 } as React.CSSProperties}>
                  <h3 style={{ font: "inherit" }}>
                    <button type="button" className="row__hit role-row" aria-expanded={isOpen} aria-controls={`role-${r.id}`} onClick={() => setOpenId(isOpen ? null : r.id)}>
                      <span>
                        <span className="role-row__title">{r.title}</span>
                        <span className="meta" style={{ display: "block", marginTop: "0.2rem" }}>{r.company}. {TYPE[r.type]}, {ctcBand(r.type, r.ctcMin, r.ctcMax)}. {r.locations.join(" or ")}.</span>
                      </span>
                      <span className="role-row__right">
                        <span className="small"><Countdown ms={r.closesInMs} /></span>
                        <span className="chips" style={{ justifyContent: "flex-end", alignItems: "center" }}>
                          {app ? <span className="tag tag--ink">{STAGE_LABEL[app.stage]}</span> : r.nudged && open && verified ? <span className="tag tag--lit">Nudged</span> : null}
                          <Chevron />
                        </span>
                      </span>
                    </button>
                  </h3>
                  {isOpen && (
                    <div className="row__body post" id={`role-${r.id}`}>
                      <p className="measure">{r.jd}</p>
                      <p className="small">Broadcast to {r.reach.length === 23 ? "all 23 campuses" : `${r.reach.length} campuses`}, yours included. <MiniBoard reach={r.reach} /></p>
                      <div className="actions">
                        {app
                          ? <Link href="/candidate/applications" className="btn">Track this application<Arrow /></Link>
                          : <button type="button" className="btn btn--ink" disabled={!verified} onClick={() => apply(r.id)}>Apply with your profile<Arrow /></button>}
                        {!app && <span className="meta">{verified ? "One step. Your saved profile goes with it." : "Opens once you are verified."}</span>}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <aside className="work__side" aria-label="How roles reach you">
        <div className="sheet post" style={{ "--i": 4 } as React.CSSProperties}>
          <div className="sheet__head"><h3>How roles reach you</h3></div>
          <div className="sheet__pad" style={{ display: "grid", gap: "0.9rem" }}>
            <p className="small">Every role here passed the gate before you saw it, and the company has put down a deposit.</p>
            <p className="small">When a window closes, the top {rules.shortlistCap} applicants by fit are shortlisted. Until then a stronger applicant can still move ahead of you.</p>
            <p className="small">A nudge means you were among the {rules.nudgeCap} best fits. You can apply without one.</p>
          </div>
        </div>
        {!profile.headline && (
          <div className="note post" style={{ "--i": 6 } as React.CSSProperties}>
            <b>Your profile is empty.</b>
            Matching reads your skills and what you want. <Link className="link" href="/candidate/profile">Fill it in</Link>
          </div>
        )}
      </aside>
    </div>
  );
}
