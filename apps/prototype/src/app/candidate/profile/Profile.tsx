"use client";
import { useState, type FormEvent } from "react";
import { campus } from "@/data/campuses";
import { STATUS_LABEL, useCandidate } from "@/seats/candidate";

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
const month = (iso: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(new Date(`${iso}T00:00:00`));
const SOURCE = { campus_email: "Campus email", referral: "Your alumni association", association: "Your alumni association", staff: "Novare staff" } as const;
const STATE = { verified: "Verified", referral_pending: "Waiting", verification_pending: "Waiting", rejected: "Not verified" } as const;

export function Profile() {
  const { me, verificationState, profile, saveProfile, open, setOpen } = useCandidate();
  const [headline, setHeadline] = useState(profile.headline);
  const [skills, setSkills] = useState(profile.skills.join(", "));
  const [roles, setRoles] = useState(profile.preferredRoles.join(", "));
  const [locations, setLocations] = useState(profile.preferredLocations.join(", "));
  const [years, setYears] = useState(String(profile.yearsExperience));
  const [notice, setNotice] = useState(String(profile.noticePeriodDays));
  const [linkedin, setLinkedin] = useState(profile.linkedin);
  const [busy, setBusy] = useState(false);
  const c = campus(me.campusCode);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await saveProfile({ headline: headline.trim(), skills: list(skills), preferredRoles: list(roles), preferredLocations: list(locations),
      yearsExperience: Number(years) || 0, noticePeriodDays: Math.round(Number(notice) || 0), linkedin: linkedin.trim() });
    setBusy(false);
  };

  return (
    <div className="work wrap">
      <div className="work__main">
        <div className="work__lead">
          <h2 className="display t-m">What companies see</h2>
          <p className="meta">Shown only to companies whose shortlist you are on.</p>
        </div>
        <form className="form sheet sheet__pad post" style={{ "--i": 2 } as React.CSSProperties} onSubmit={submit}>
          <div className="field">
            <label htmlFor="headline">Headline</label>
            <input id="headline" className="input" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="One line on what you do best" maxLength={140} />
          </div>
          <div className="field">
            <label htmlFor="skills">Skills</label>
            <input id="skills" className="input" value={skills} onChange={(e) => setSkills(e.target.value)} aria-describedby="skills-h" />
            <span className="hint" id="skills-h">Separate with commas.</span>
            <span className="chips" aria-hidden="true">{list(skills).map((s) => <span key={s} className="tag tag--quiet">{s}</span>)}</span>
          </div>
          <div className="form__pair">
            <div className="field">
              <label htmlFor="roles">Roles you want</label>
              <input id="roles" className="input" value={roles} onChange={(e) => setRoles(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="locations">Where you want to work</label>
              <input id="locations" className="input" value={locations} onChange={(e) => setLocations(e.target.value)} />
            </div>
          </div>
          <div className="form__pair">
            <div className="field">
              <label htmlFor="years">Years of experience</label>
              <input id="years" className="input" inputMode="decimal" value={years} onChange={(e) => setYears(e.target.value.replace(/[^\d.]/g, ""))} />
            </div>
            <div className="field">
              <label htmlFor="notice">Notice period, in days</label>
              <input id="notice" className="input" inputMode="numeric" value={notice} onChange={(e) => setNotice(e.target.value.replace(/\D/g, ""))} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="linkedin">LinkedIn profile</label>
            <input id="linkedin" className="input" type="url" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://www.linkedin.com/in/you" />
          </div>
          <div className="actions">
            <button type="submit" className="btn btn--ink" disabled={busy}>{busy ? "Saving" : "Save profile"}</button>
            <span className="meta">Saving matches you again against every open role.</span>
          </div>
        </form>
      </div>
      <aside className="work__side" aria-label="Verification and nudges">
        <div className="sheet post" style={{ "--i": 3 } as React.CSSProperties}>
          <div className="sheet__pad">
            <label className="switch">
              <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
              <span><b style={{ display: "block" }}>Open to opportunities</b><span className="meta">Nudges go only to candidates who are open and verified.</span></span>
            </label>
          </div>
        </div>
        <div className="sheet post" style={{ "--i": 5 } as React.CSSProperties}>
          <div className="sheet__head"><h3>Verification</h3><span className={`tag${verificationState === "verified" ? " tag--lit" : verificationState === "rejected" ? " tag--stop" : ""}`}>{STATE[verificationState]}</span></div>
          <div className="sheet__pad">
            <dl className="kv">
              <dt>Campus</dt><dd>{c.name}</dd>
              <dt>You are</dt><dd>{STATUS_LABEL[me.status]}</dd>
              <dt>{me.status === "alumnus" ? "Graduated" : "Graduating"}</dt><dd>{month(me.gradDate)}</dd>
              <dt>{verificationState === "verified" ? "Verified by" : "Checked by"}</dt><dd>{SOURCE[me.verificationSource]}</dd>
              {me.verifiedAt && verificationState === "verified" ? <><dt>Verified on</dt><dd>{day(me.verifiedAt)}</dd></> : null}
              {me.rollNumber ? <><dt>Roll number</dt><dd className="mono">{me.rollNumber}</dd></> : null}
              {me.emails.map((e) => (
                <div key={e.email} style={{ display: "contents" }}><dt>{e.isPrimary ? "Login email" : "Other email"}</dt><dd className="mono" style={{ overflowWrap: "anywhere" }}>{e.email}</dd></div>
              ))}
            </dl>
            {me.rollNumberFlag && <p className="meta" style={{ marginTop: "1rem" }}>Your roll number did not match the usual format for your campus, so a person at Novare is checking it. You can carry on meanwhile.</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}
