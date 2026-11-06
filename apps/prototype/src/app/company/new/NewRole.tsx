"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Board } from "@/components/Board";
import { Arrow } from "@/components/Icons";
import { useRules } from "@/components/Rules";
import { CAMPUSES } from "@/data/campuses";
import { defaultFeeTerms, depositFor, describeTerms, evaluateRules, formatPaise, lpa, tierIndexFor, type RoleType } from "@/lib/rules";
import { useCompany } from "@/seats/company";

const EXAMPLE = {
  title: "Platform engineer, bookings",
  type: "experienced" as RoleType,
  min: "30", max: "42", expMin: "2", expMax: "5", locations: "Bengaluru",
  jd: "Own the availability and booking APIs that every Kiln studio depends on. You will work in Go and Postgres, cut p95 latency on the calendar endpoints, and design the waitlist feature from schema to rollout. We expect two or more years running a production service and comfort being on call one week in six.",
  reach: ["IITB", "IITD", "IITM", "IITK", "IITKGP", "IITR"],
};
const toPaise = (type: RoleType, v: string) => { const n = Number(v) || 0; return Math.round(type === "intern" ? n * 12 * 100 : n * 100_000 * 100); };

export function NewRole() {
  const rules = useRules();
  const router = useRouter();
  const { submitRole } = useCompany();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<RoleType>("fresher");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [expMin, setExpMin] = useState("0");
  const [expMax, setExpMax] = useState("1");
  const [locations, setLocations] = useState("");
  const [jd, setJd] = useState("");
  const [reach, setReach] = useState<Set<string>>(new Set());

  const draft = { title, jd, type, ctcMin: toPaise(type, min), ctcMax: toPaise(type, max), locations: locations.split(",").map((s) => s.trim()).filter(Boolean), reach: [...reach] };
  const gate = evaluateRules(rules, draft);
  const hay = `${title} ${jd}`.toLowerCase();
  const blocked = rules.blocklist.find((b) => hay.includes(b));
  const floor = rules.minCtc[type];
  const checks = [
    { ok: !blocked, label: "Role category", detail: blocked ? `"${blocked}" is on the blocklist` : "Not on the blocklist" },
    { ok: jd.trim().length >= 200, label: "Description", detail: `${jd.trim().length} of 200 characters` },
    { ok: draft.ctcMin >= floor && draft.ctcMax >= draft.ctcMin, label: "Pay", detail: `Floor for this type is ${type === "intern" ? `${formatPaise(floor / 12)} a month` : lpa(floor)}` },
    { ok: draft.locations.length > 0, label: "Location", detail: draft.locations.length ? draft.locations.join(", ") : "At least one" },
    { ok: reach.size > 0, label: "Campuses", detail: `${reach.size} switched on` },
  ];
  const tier = tierIndexFor(rules, reach.size);
  const terms = defaultFeeTerms(rules, type, Number(expMin) || 0);

  const fill = () => { setTitle(EXAMPLE.title); setType(EXAMPLE.type); setMin(EXAMPLE.min); setMax(EXAMPLE.max); setExpMin(EXAMPLE.expMin); setExpMax(EXAMPLE.expMax); setLocations(EXAMPLE.locations); setJd(EXAMPLE.jd); setReach(new Set(EXAMPLE.reach)); };
  const toggle = (code: string) => setReach((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { id } = submitRole({ ...draft, yearsExp: [Number(expMin) || 0, Number(expMax) || 0] });
    router.push(`/company/roles/${id}`);
  };

  return (
    <form className="work wrap" onSubmit={submit}>
      <div className="work__main">
        <div className="work__lead">
          <h2 className="display t-m">The role</h2>
          <button type="button" className="btn btn--sm" onClick={fill}>Fill with an example</button>
        </div>
        <div className="form sheet sheet__pad post" style={{ "--i": 2 } as React.CSSProperties}>
          <div className="field">
            <label htmlFor="title">Title</label>
            <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required autoComplete="off" />
          </div>
          <fieldset className="field">
            <legend>Who is it for</legend>
            <div className="seg">
              {(["intern", "fresher", "experienced"] as const).map((t) => (
                <label key={t}><input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} />{t === "intern" ? "Intern" : t === "fresher" ? "Fresher" : "Experienced"}</label>
              ))}
            </div>
          </fieldset>
          <div className="form__pair">
            <div className="field">
              <label htmlFor="min">{type === "intern" ? "Stipend from, rupees a month" : "CTC from, lakhs a year"}</label>
              <input id="min" className="input" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value.replace(/[^\d.]/g, ""))} />
            </div>
            <div className="field">
              <label htmlFor="max">{type === "intern" ? "Stipend up to" : "CTC up to"}</label>
              <input id="max" className="input" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value.replace(/[^\d.]/g, ""))} />
            </div>
          </div>
          {type === "experienced" && (
            <div className="form__pair">
              <div className="field">
                <label htmlFor="expmin">Experience from, years</label>
                <input id="expmin" className="input" inputMode="numeric" value={expMin} onChange={(e) => setExpMin(e.target.value.replace(/\D/g, ""))} />
              </div>
              <div className="field">
                <label htmlFor="expmax">Experience up to</label>
                <input id="expmax" className="input" inputMode="numeric" value={expMax} onChange={(e) => setExpMax(e.target.value.replace(/\D/g, ""))} />
              </div>
            </div>
          )}
          <div className="field">
            <label htmlFor="loc">Locations</label>
            <input id="loc" className="input" value={locations} onChange={(e) => setLocations(e.target.value)} aria-describedby="loc-h" autoComplete="off" />
            <span className="hint" id="loc-h">Separate with commas. Write Remote if it is.</span>
          </div>
          <div className="field">
            <label htmlFor="jd">Description</label>
            <textarea id="jd" className="textarea" value={jd} onChange={(e) => setJd(e.target.value)} aria-describedby="jd-h" />
            <span className="hint num" id="jd-h">{jd.trim().length} of 200 characters minimum.</span>
          </div>
        </div>

        <div className="work__lead" style={{ marginTop: "2.5rem" }}>
          <h2 className="display t-m">Campuses to reach</h2>
          <div className="actions">
            <button type="button" className="btn btn--sm" onClick={() => setReach(new Set(CAMPUSES.map((c) => c.code)))}>All 23</button>
            <button type="button" className="btn btn--sm" onClick={() => setReach(new Set())}>Clear</button>
          </div>
        </div>
        <div className="post" style={{ "--i": 4 } as React.CSSProperties}>
          <Board selected={reach} onToggle={toggle} compact label="Campuses this role reaches. The deposit is priced by how many are switched on." />
        </div>
      </div>

      <aside className="work__side" aria-label="Gate and deposit">
        <div className="sheet post" style={{ "--i": 3 } as React.CSSProperties}>
          <div className="sheet__head"><h3>The gate, rules pass</h3><span className={`tag${gate.outcome === "accept" ? " tag--lit" : " tag--quiet"}`}>{gate.outcome === "accept" ? "Would pass" : "Not yet"}</span></div>
          <ul className="sheet__pad" style={{ display: "grid", gap: "0.7rem" }} aria-live="polite">
            {checks.map((c) => (
              <li key={c.label} className="small" style={{ display: "grid", gridTemplateColumns: "1.1rem 1fr", gap: "0.6rem", alignItems: "start" }}>
                <span aria-hidden="true" style={{ width: "0.7rem", height: "0.7rem", marginTop: "0.3rem", borderRadius: "50%", border: "1px solid var(--ink)", background: c.ok ? "var(--lit)" : "transparent" }} />
                <span><b>{c.label}</b><span className="vh">{c.ok ? ": passes" : ": does not pass yet"}</span><span className="meta" style={{ display: "block" }}>{c.detail}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <div className="sheet post" style={{ "--i": 5 } as React.CSSProperties}>
          <div className="sheet__head"><h3>What it will cost</h3></div>
          <div className="sheet__pad">
            <p className="meta">Refundable deposit</p>
            <p className="big-num num" aria-live="polite">{formatPaise(depositFor(rules, reach.size))}</p>
            <ol className="tiers" aria-label="Deposit tiers" style={{ gridTemplateColumns: "1fr" }}>
              {rules.depositTiers.map((t, i) => (
                <li key={t.maxCampuses} className={`tier${i === tier ? " is-on" : ""}`}>
                  <span>{i === 0 ? "1 to 5" : i === 1 ? "6 to 12" : "13 to 23"} campuses</span><span className="num">{formatPaise(t.amount)}</span>
                </li>
              ))}
            </ol>
            <dl className="kv" style={{ marginTop: "1.1rem" }}>
              <dt>Fee on a hire</dt><dd>{describeTerms(terms)}</dd>
              <dt>Replacement guarantee</dt><dd>{terms.replacementGuaranteeDays} days</dd>
            </dl>
            <p className="meta" style={{ marginTop: "0.9rem" }}>Terms are confirmed by Novare after the gate and you accept them before paying anything.</p>
          </div>
        </div>
        <button type="submit" className="btn btn--ink" style={{ minHeight: "3.25rem" }}>Submit to the gate<Arrow /></button>
      </aside>
    </form>
  );
}
