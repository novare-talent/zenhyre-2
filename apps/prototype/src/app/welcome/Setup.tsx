"use client";
import { useState, type FormEvent } from "react";
import { Arrow } from "@/components/Icons";
import { CAMPUSES, campus as campusOf } from "@/data/campuses";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

async function post(path: string, body: unknown): Promise<string | null> {
  try {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) return null;
    const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
    return j.message ?? (r.status === 409 ? "This account is already set up. Reload the page." : "That did not go through. Check the fields and try again.");
  } catch { return "We could not reach the server. Try again in a minute."; }
}

/** §6.1: a campus email is verified at once; anyone else asks their association (direct request). */
export function CandidateSetup({ campusCode, thisYear }: { campusCode: string | null; thisYear: number }) {
  const student = !!campusCode;
  const [name, setName] = useState("");
  const [campus, setCampus] = useState("");
  const [course, setCourse] = useState("");
  const [branch, setBranch] = useState("");
  const [month, setMonth] = useState("05");
  const [year, setYear] = useState(String(student ? thisYear + 1 : thisYear - 3));
  const [roll, setRoll] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const years = student ? Array.from({ length: 8 }, (_, i) => thisYear - 1 + i) : Array.from({ length: 50 }, (_, i) => thisYear - i);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setProblem(null);
    const gradDate = `${year}-${month}-01`;
    const err = await post("/api/onboarding/candidate", student
      ? { name: name.trim(), gradDate, course, rollNumber: roll.trim() }
      : { name: name.trim(), gradDate, course, rollNumber: null, campusShortCode: campus, claimed: { batch: year, branch, linkedinUrl: linkedin.trim() } });
    if (err) { setProblem(err); setBusy(false); return; }
    window.location.assign("/candidate");
  };

  return (
    <form className="form sheet sheet__pad" onSubmit={submit}>
      <div className="field">
        <label htmlFor="name">Full name</label>
        <input id="name" className="input" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} />
      </div>
      {student ? (
        <p className="note"><b>{campusOf(campusCode!).name}</b>Taken from your campus email. You will be verified as soon as you finish.</p>
      ) : (
        <div className="field">
          <label htmlFor="campus">Your IIT</label>
          <select id="campus" className="select" required value={campus} onChange={(e) => setCampus(e.target.value)}>
            <option value="">Choose a campus</option>
            {CAMPUSES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          <span className="hint">Still studying? Log out and log in with your campus LDAP ID instead: you are verified at once.</span>
        </div>
      )}
      <div className="form__pair">
        <div className="field">
          <label htmlFor="course">{student ? "Course" : "Degree"}</label>
          <input id="course" className="input" required value={course} onChange={(e) => setCourse(e.target.value)} placeholder={student ? "B.Tech, Computer Science" : "B.Tech"} autoComplete="off" />
        </div>
        {student ? (
          <div className="field">
            <label htmlFor="roll">Roll number</label>
            <input id="roll" className="input mono" required value={roll} onChange={(e) => setRoll(e.target.value)} autoComplete="off" />
          </div>
        ) : (
          <div className="field">
            <label htmlFor="branch">Branch</label>
            <input id="branch" className="input" required value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Mechanical Engineering" autoComplete="off" />
          </div>
        )}
      </div>
      <fieldset className="field">
        <legend>{student ? "When you graduate" : "When you graduated"}</legend>
        <div className="form__pair">
          <select className="select" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)}>
            {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, "0")}>{m}</option>)}
          </select>
          <select className="select" aria-label="Year" value={year} onChange={(e) => setYear(e.target.value)}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </fieldset>
      {!student && (
        <div className="field">
          <label htmlFor="linkedin">LinkedIn profile</label>
          <input id="linkedin" className="input" type="url" required value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://www.linkedin.com/in/you" />
          <span className="hint">Your association checks this against its records.</span>
        </div>
      )}
      {problem && <p className="field-error" role="alert">{problem}</p>}
      <div className="actions">
        <button type="submit" className="btn btn--ink" disabled={busy}>{busy ? "Saving" : student ? "Finish and see roles" : "Ask to be verified"}<Arrow /></button>
      </div>
    </form>
  );
}

/** §6.4: the first user names the company and becomes its owner; the domain comes from the email. */
export function CompanySetup({ domain }: { domain: string }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setProblem(null);
    const err = await post("/api/onboarding/company", { name: name.trim() });
    if (err) { setProblem(err); setBusy(false); return; }
    window.location.assign("/company");
  };
  return (
    <form className="form sheet sheet__pad" onSubmit={submit}>
      <div className="field">
        <label htmlFor="cname">Company name</label>
        <input id="cname" className="input" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" />
      </div>
      <dl className="kv">
        <dt>Verified domain</dt><dd className="mono">{domain}</dd>
        <dt>Your role</dt><dd>Owner</dd>
      </dl>
      <p className="meta">Teammates you invite later must share this domain.</p>
      {problem && <p className="field-error" role="alert">{problem}</p>}
      <div className="actions">
        <button type="submit" className="btn btn--ink" disabled={busy}>{busy ? "Saving" : "Create the company"}<Arrow /></button>
      </div>
    </form>
  );
}
