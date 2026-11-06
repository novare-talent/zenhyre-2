"use client";
import { useState } from "react";
import { Chevron } from "@/components/Icons";
import { useRules } from "@/components/Rules";
import { useAssociation } from "@/seats/association";

const ago = (d: number) => (d === 0 ? "Opened today" : d === 1 ? "Opened yesterday" : `Opened ${d} days ago`);

export function Queue() {
  const rules = useRules();
  const { queue, resolved, resolve } = useAssociation();
  const [openId, setOpenId] = useState<string | null>(queue[0]?.id ?? null);
  const [reason, setReason] = useState("");

  return (
    <div className="work wrap">
      <div className="work__main">
        <div className="work__lead">
          <h2 className="display t-m">{queue.length} waiting on you</h2>
          <p className="meta">Oldest requests are at the bottom.</p>
        </div>
        {queue.length === 0 ? (
          <p className="empty">The queue is clear. New requests arrive by email and show up here.</p>
        ) : (
          <ul className="rows">
            {queue.map((q, i) => {
              const isOpen = openId === q.id;
              const late = q.openedDaysAgo > rules.escapeHatchDays;
              return (
                <li key={q.id} className={`row post${isOpen ? " is-open" : ""}`} style={{ "--i": i + 2 } as React.CSSProperties}>
                  <h3 style={{ font: "inherit" }}>
                    <button type="button" className="row__hit role-row" aria-expanded={isOpen} aria-controls={`q-${q.id}`} onClick={() => { setOpenId(isOpen ? null : q.id); setReason(""); }}>
                      <span>
                        <span className="role-row__title">{q.name}</span>
                        <span className="meta" style={{ display: "block", marginTop: "0.2rem" }}>Says: batch of {q.batch}, {q.branch}.</span>
                      </span>
                      <span className="role-row__right">
                        <span className="small">{ago(q.openedDaysAgo)}</span>
                        <span className="chips" style={{ justifyContent: "flex-end", alignItems: "center" }}>
                          {late && <span className="tag tag--lit">Also with Novare</span>}
                          {q.attempt === 2 && <span className="tag">Second request</span>}
                          <span className="tag tag--quiet">{q.source}</span>
                          <Chevron />
                        </span>
                      </span>
                    </button>
                  </h3>
                  {isOpen && (
                    <div className="row__body post" id={`q-${q.id}`}>
                      <dl className="kv" style={{ maxWidth: "34rem" }}>
                        <dt>Claimed batch</dt><dd>{q.batch}</dd>
                        <dt>Claimed branch</dt><dd>{q.branch}</dd>
                        <dt>LinkedIn</dt><dd className="mono" style={{ overflowWrap: "anywhere" }}>{q.linkedin}</dd>
                        <dt>Came in by</dt><dd>{q.source}{q.viaRole ? `, for ${q.viaRole}` : ""}</dd>
                      </dl>
                      {q.viaRole && <p className="small">They have already applied through your link. The application waits at the line until you verify them.</p>}
                      {late && <p className="small">This has been open for more than {rules.escapeHatchDays} days, so Novare staff can now verify it too.</p>}
                      <div className="actions">
                        <button type="button" className="btn btn--ink" onClick={() => resolve(q.id, "approve")}>Verify as an alum</button>
                      </div>
                      <form className="field" style={{ maxWidth: "34rem" }} onSubmit={(e) => { e.preventDefault(); resolve(q.id, "reject", reason); }}>
                        <label htmlFor={`why-${q.id}`}>Or say why not</label>
                        <div className="linkbox">
                          <input id={`why-${q.id}`} className="input" style={{ border: 0 }} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Not in the batch records" />
                          <button type="submit" className="btn btn--stop">Do not verify</button>
                        </div>
                        <span className="hint">They are sent this reason and may ask {q.attempt === 2 ? "no more times" : "once more"}.</span>
                      </form>
                      <button type="button" className="small link" style={{ justifySelf: "start", minHeight: "1.75rem" }} onClick={() => resolve(q.id, "reject_fraud", "Reported as a false claim")}>Report as a false claim</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {resolved.length > 0 && (
          <>
            <h2 className="display t-m" style={{ margin: "2.5rem 0 1rem" }}>Decided this session</h2>
            <ul className="rows">
              {resolved.map((r) => (
                <li key={r.item.id} className="row post">
                  <div className="role-row" style={{ display: "grid", padding: "0.9rem 1.25rem" }}>
                    <span><b>{r.item.name}</b><span className="meta" style={{ display: "block" }}>Batch of {r.item.batch}, {r.item.branch}{r.reason ? `. Reason: ${r.reason}` : ""}</span></span>
                    <span className={`tag${r.resolution === "approve" ? " tag--lit" : " tag--stop"}`}>{r.resolution === "approve" ? "Verified" : r.resolution === "reject" ? "Not verified" : "Reported"}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <aside className="work__side" aria-label="How verification works">
        <div className="sheet post" style={{ "--i": 4 } as React.CSSProperties}>
          <div className="sheet__head"><h3>How verification works</h3></div>
          <div className="sheet__pad" style={{ display: "grid", gap: "0.9rem" }}>
            <p className="small">Students prove themselves with a campus email. Alumni have no such address, so their claim comes to you.</p>
            <p className="small">You are never the bottleneck. Anything still open after {rules.escapeHatchDays} days also goes to Novare staff, and their name is recorded if they verify it.</p>
            <p className="small">An alum you verify is attributed to you on every hire that follows, unless a referral link gets there first.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
