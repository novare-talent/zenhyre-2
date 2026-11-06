"use client";
import { useState, type FormEvent } from "react";
import { Arrow } from "@/components/Icons";
import { CAMPUSES, campusForEmail } from "@/data/campuses";

type Seat = "candidate" | "company" | "association";
const ROLES: { id: Seat; who: string; name: string; how: string; note: string }[] = [
  { id: "candidate", who: "IIT student or alum", name: "Candidate", how: "LDAP ID or personal email",
    note: "Students: use your campus LDAP ID and you are verified straight away. Alumni: use a personal email, and your alumni association confirms you." },
  { id: "company", who: "Hiring from the IITs", name: "Company", how: "Work email only",
    note: "Use a work email on your company's own domain. Personal mailboxes such as Gmail, Outlook and Yahoo are not accepted." },
  { id: "association", who: "IIT alumni body", name: "Association", how: "Login created by Novare",
    note: "Association logins are created by Novare Talent and given to you. Use that email here. There is no sign-up for this seat." },
];
// Every campus mail domain, as seeded: an LDAP ID is the part before the @.
const LDAP_DOMAINS = CAMPUSES.flatMap((c) => (c.domains ?? [c.domain]).map((d) => ({ domain: d, campus: c.name })));

export function LoginForm({ initialRole, error, freemail }: { initialRole: Seat | null; error: string | null; freemail: string[] }) {
  const [role, setRole] = useState<Seat | null>(initialRole);
  const [how, setHow] = useState<"ldap" | "personal">("ldap");
  const [ldap, setLdap] = useState("");
  const [domain, setDomain] = useState("");
  const [typed, setTyped] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [problem, setProblem] = useState<string | null>(null);

  const usingLdap = role === "candidate" && how === "ldap";
  // An LDAP field accepts the bare ID plus a campus, or a full campus address pasted in.
  const email = (usingLdap ? (ldap.includes("@") ? ldap : ldap && domain ? `${ldap}@${domain}` : "") : typed).trim().toLowerCase();
  const emailDomain = email.split("@")[1] ?? "";
  const kind = !emailDomain.includes(".") ? null : campusForEmail(email) ? "campus" : freemail.includes(emailDomain) ? "personal" : "work";
  const active = ROLES.find((r) => r.id === role);

  // What the address means for the role picked. `block` stops the form; the server applies the same rule.
  const check: { text: string; block: boolean } | null = !role || !kind ? null
    : role === "candidate" ? (
        kind === "campus" ? { text: `${campusForEmail(email)!.name} recognised. The link goes to ${email} and you are verified straight away.`, block: false }
        : usingLdap ? { text: "That is not an IIT campus address. Pick your campus, or switch to personal email.", block: true }
        : kind === "personal" ? { text: "Personal email. Your alumni association will confirm you after you sign up.", block: false }
        : { text: "That looks like a work address. Candidates use a campus LDAP ID or a personal email such as Gmail, Outlook or Yahoo.", block: true })
    : role === "company" ? (
        kind === "work" ? null
        : { text: kind === "campus" ? "That is a campus address. Companies use a work email on the company's own domain." : "That is a personal mailbox. Companies use a work email on the company's own domain.", block: true })
    : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!role) { setProblem("Choose who you are logging in as."); return; }
    if (usingLdap && !email) { setProblem("Enter your LDAP ID and pick your campus."); return; }
    if (check?.block) { setProblem(check.text); return; }
    setProblem(null);
    setState("sending");
    try {
      const r = await fetch("/api/auth/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, role }) });
      const j = (await r.json().catch(() => ({}))) as { message?: string };
      if (!r.ok) { setProblem(j.message ?? "Something went wrong. Try again."); setState("idle"); return; }
      setState("sent");
    } catch { setProblem("We could not reach the server. Check your connection and try again."); setState("idle"); }
  };

  if (state === "sent") {
    return (
      <div className="sheet sheet__pad sent" role="status">
        <h2 className="display t-l">Check your inbox.</h2>
        <p>We sent a sign-in link to <span className="mono">{email}</span>. It works once, for 15 minutes, and logs you in as {role === "association" ? "an association" : `a ${role}`}.</p>
        {role === "association" && <p className="small">If Novare has not created a login for this address, the link will not open a seat.</p>}
        <button type="button" className="btn" onClick={() => { setState("idle"); setTyped(""); setLdap(""); }}>Use a different email</button>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={submit}>
      {error && <p className="note note--stop" role="alert">{error}</p>}
      <fieldset className="field">
        <legend>I am logging in as</legend>
        <div className="roles">
          {ROLES.map((r) => (
            <label key={r.id} className="role">
              <input type="radio" name="role" value={r.id} checked={role === r.id} onChange={() => { setRole(r.id); setProblem(null); }} required />
              <span className="role__who">{r.who}</span>
              <span><span className="role__name" style={{ display: "block" }}>{r.name}</span><span className="role__how" style={{ display: "block", marginTop: "0.4rem" }}>{r.how}</span></span>
            </label>
          ))}
        </div>
        <p className="small" aria-live="polite" style={{ minHeight: "2.9em", marginTop: "0.4rem" }}>{active ? active.note : "Pick one. Each email holds a single role."}</p>
      </fieldset>

      {role === "candidate" && (
        <fieldset className="field">
          <legend>Log in with</legend>
          <div className="seg">
            <label><input type="radio" name="how" checked={how === "ldap"} onChange={() => { setHow("ldap"); setProblem(null); }} />Campus LDAP ID</label>
            <label><input type="radio" name="how" checked={how === "personal"} onChange={() => { setHow("personal"); setProblem(null); }} />Personal email</label>
          </div>
        </fieldset>
      )}

      {usingLdap ? (
        <div className="field">
          <label htmlFor="ldap">LDAP ID</label>
          <div className="ldap">
            <input id="ldap" className="input mono" name="ldap" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={ldap}
              onChange={(e) => { setLdap(e.target.value.trim()); setProblem(null); }} aria-describedby="email-hint" />
            {!ldap.includes("@") && (
              <select className="select mono" aria-label="Campus mail domain" required value={domain} onChange={(e) => { setDomain(e.target.value); setProblem(null); }}>
                <option value="">@ your campus</option>
                {LDAP_DOMAINS.map((d) => <option key={d.domain} value={d.domain}>@{d.domain}</option>)}
              </select>
            )}
          </div>
          <span className={`hint${check?.block ? " stop" : ""}`} id="email-hint" aria-live="polite" style={{ minHeight: "1.3em" }}>{check?.text ?? "The ID you use for campus mail and SSO. The sign-in link goes to your campus inbox."}</span>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="email">{role === "company" ? "Work email" : role === "candidate" ? "Personal email" : "Email"}</label>
          <input id="email" className="input" type="email" name="email" autoComplete="email" inputMode="email" required value={typed}
            onChange={(e) => { setTyped(e.target.value); setProblem(null); }} aria-describedby="email-hint" />
          <span className={`hint${check?.block ? " stop" : ""}`} id="email-hint" aria-live="polite" style={{ minHeight: "1.3em" }}>{check?.text ?? ""}</span>
        </div>
      )}
      {problem && problem !== check?.text && <p className="field-error" role="alert">{problem}</p>}
      <div className="actions">
        <button type="submit" className="btn btn--ink" style={{ minHeight: "3.25rem" }} disabled={state === "sending"}>{state === "sending" ? "Sending the link" : "Email me a sign-in link"}<Arrow /></button>
      </div>
    </form>
  );
}
