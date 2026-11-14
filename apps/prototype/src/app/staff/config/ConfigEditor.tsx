"use client";
import { useState } from "react";
import { useStaffAction } from "../act";

/** §17: every tunable number, as JSON. Saving validates on the API against the key's schema and is audited. */
export function ConfigEditor({ values }: { values: Record<string, unknown> }) {
  const groups = Object.keys(values).reduce<Record<string, string[]>>((g, k) => { (g[k.split(".")[0]!] ??= []).push(k); return g; }, {});
  return (
    <div className="work wrap">
      <div className="work__main" style={{ display: "grid", gap: "2rem" }}>
        <p className="meta" style={{ maxWidth: "46rem" }}>Money is in paise and durations in days unless the key says otherwise. Changes apply to new decisions; accepted fee terms and existing deposits do not change.</p>
        {Object.entries(groups).map(([g, keys]) => (
          <section key={g}>
            <h3 className="display t-s" style={{ textTransform: "capitalize" }}>{g}</h3>
            <ul className="rows">{keys.map((k) => <Row key={k} k={k} value={values[k]} />)}</ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function Row({ k, value }: { k: string; value: unknown }) {
  const { act, busy } = useStaffAction();
  const initial = JSON.stringify(value);
  const [text, setText] = useState(initial);
  let parsed: unknown, valid = true;
  try { parsed = JSON.parse(text); } catch { valid = false; }
  return (
    <li className="row">
      <form className="row__body" style={{ display: "grid", gridTemplateColumns: "minmax(12rem, 18rem) 1fr auto", gap: "0.75rem", alignItems: "center", padding: "0.75rem 1.25rem" }}
        onSubmit={(e) => { e.preventDefault(); if (valid) void act(k, "PUT", `config/${k}`, { value: parsed }, `${k} saved.`); }}>
        <label htmlFor={`c-${k}`} className="mono small">{k}</label>
        <input id={`c-${k}`} className="input mono" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!valid} />
        <button className="btn btn--sm btn--ink" type="submit" disabled={!valid || text === initial || !!busy}>{busy === k ? "Saving…" : "Save"}</button>
      </form>
    </li>
  );
}
