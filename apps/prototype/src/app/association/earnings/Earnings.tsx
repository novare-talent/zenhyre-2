"use client";
import { useState } from "react";
import { ATTRIBUTED_HIRES, SHARE_LEDGER } from "@/data/fixtures";
import { formatPaise, lpa } from "@/lib/rules";
import { balances, shareOf, useAssociation } from "@/seats/association";

const ENTRY = { accrued: "Share accrued", reversed: "Share reversed", paid_cash: "Paid to you" } as const;

export function Earnings() {
  const { me, sendTip, tips } = useAssociation();
  const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
  const [tip, setTip] = useState("");
  const b = balances(me.shareRate);
  const pct = Math.round(me.shareRate * 100);
  const earnedOn = (hireId: string) => SHARE_LEDGER.filter((e) => e.hireId === hireId).reduce((s, e) => s + (e.type === "reversed" ? -1 : 1) * shareOf(me.shareRate, e), 0);

  return (
    <div className="work wrap">
      <div className="work__main">
        <dl className="figures post" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginBottom: "2.5rem", background: "var(--sheet)" }}>
          <div className="figure"><dt className="meta">Accrued, net of reversals</dt><dd className="big-num num" style={{ marginTop: "0.75rem" }}>{formatPaise(b.accrued - b.reversed)}</dd></div>
          <div className="figure"><dt className="meta">Paid to you</dt><dd className="big-num num" style={{ marginTop: "0.75rem" }}>{formatPaise(b.paid)}</dd></div>
          <div className="figure" style={{ background: "var(--lit)" }}><dt className="small" style={{ fontWeight: 600 }}>Balance today</dt><dd className="big-num num" style={{ marginTop: "0.75rem" }}>{formatPaise(b.balance)}</dd></div>
        </dl>

        <div className="work__lead">
          <h2 className="display t-m">Hires attributed to you</h2>
          <p className="meta">An alum is shown by batch unless they choose to share their name.</p>
        </div>
        <ul className="rows" style={{ marginBottom: "2.5rem" }}>
          {ATTRIBUTED_HIRES.map((h, i) => (
            <li key={h.id} className="row post" style={{ "--i": i + 2 } as React.CSSProperties}>
              <div className="role-row" style={{ display: "grid", padding: "1.1rem 1.25rem" }}>
                <div>
                  <h3 className="role-row__title">{h.name ?? `Batch of ${h.batch}`}{h.name ? <span className="meta" style={{ fontWeight: 400 }}>, batch of {h.batch}</span> : null}</h3>
                  <p className="meta" style={{ marginTop: "0.2rem" }}>{h.role} at {h.company}, {lpa(h.hiredCtc)}. Attributed by: {h.attributedBy.toLowerCase()}.</p>
                </div>
                <div className="role-row__right">
                  <span className={`tag${h.outcome === "Did not join" ? " tag--stop" : " tag--lit"}`}>{h.outcome}</span>
                  <span className="small num" style={{ fontWeight: 700 }}>{formatPaise(earnedOn(h.id))} earned</span>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <h2 className="display t-m">Every entry</h2>
        <table className="ledger post">
          <caption className="vh">Association share ledger, oldest first</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">Entry</th><th scope="col" className="hide-s" style={{ textAlign: "right" }}>On an amount of</th><th scope="col" style={{ textAlign: "right" }}>Share</th></tr></thead>
          <tbody>
            {SHARE_LEDGER.map((e) => {
              const h = ATTRIBUTED_HIRES.find((x) => x.id === e.hireId);
              const minus = e.type !== "accrued";
              return (
                <tr key={e.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{e.date}</td>
                  <td><b>{ENTRY[e.type]}</b><span className="meta" style={{ display: "block" }}>{e.note}{h ? `. ${h.role}, ${h.company}` : ""}</span></td>
                  <td className="amt hide-s num" style={{ fontWeight: 400 }}>{e.type === "paid_cash" ? "" : `${formatPaise(e.base)} × ${pct}%`}</td>
                  <td className={`amt num${e.type === "reversed" ? " stop" : ""}`}>{minus ? "minus " : ""}{formatPaise(shareOf(me.shareRate, e))}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td colSpan={2}>Balance</td><td className="hide-s" /><td className="amt num">{formatPaise(b.balance)}</td></tr></tfoot>
        </table>
      </div>

      <aside className="work__side" aria-label="Agreement and tips">
        <div className="sheet post" style={{ "--i": 3 } as React.CSSProperties}>
          <div className="sheet__head"><h3>Your agreement</h3></div>
          <div className="sheet__pad">
            <dl className="kv">
              <dt>Share</dt><dd>{pct}% of each fee collected</dd>
              <dt>Paid as</dt><dd>{me.payoutMode === "cash" ? "Cash, on a monthly statement" : "Sponsorship credit"}</dd>
                            <dt>MoU signed</dt><dd>{me.mouSignedAt ? day(me.mouSignedAt) : "Not on record yet"}</dd>
            </dl>
            <p className="meta" style={{ marginTop: "1rem" }}>A share is written when money is actually collected, so part payments accrue in proportion. If a hire falls through, the share on it is reversed.</p>
          </div>
        </div>
        <form className="sheet sheet__pad field post" style={{ "--i": 5 } as React.CSSProperties} onSubmit={(e) => { e.preventDefault(); sendTip(); setTip(""); }}>
          <label htmlFor="tip">Know of a hire that went around the platform?</label>
          <textarea id="tip" className="textarea" style={{ minHeight: "6rem" }} required value={tip} onChange={(e) => setTip(e.target.value)} placeholder="Who, which company, roughly when" />
          <div className="actions">
            <button type="submit" className="btn">Tell Novare</button>
            {tips > 0 && <span className="meta">{tips} sent this session</span>}
          </div>
          <span className="hint">Staff check every tip before anything is charged or scored.</span>
        </form>
      </aside>
    </div>
  );
}
