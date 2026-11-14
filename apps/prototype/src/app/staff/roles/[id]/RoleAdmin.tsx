"use client";
import { useState } from "react";
import { useStaffAction } from "../../act";

interface FeeTerms { kind: "flat" | "percent"; amount: number; replacement_guarantee_days: number; notes?: string }
export interface AdminRoleView {
  role: {
    id: string; title: string; status: string; type: string; jd: string | null; ctcMin: number | null; ctcMax: number | null;
    yearsExpMin: number | null; yearsExpMax: number | null; locations: string[]; campusReach: string[]; feeTerms: FeeTerms | null;
    feeTermsReleasedAt: string | null; feeTermsAcceptedAt: string | null; depositAmount: number | null; depositMode: string | null;
    broadcastOpensAt: string | null; broadcastClosesAt: string | null; broadcastExtendedAt: string | null; shortlistReadyAt: string | null; jobError: string | null;
  };
  events: { fromStatus: string | null; toStatus: string; actor: string; note: string | null; at: string }[];
  gateDecisions: { stage: string; outcome: string; reason: string | null; modelScore: number | null; decidedAt: string }[];
  applicants: { id: string; candidateId: string; stage: string; fitScore: number | null; rank: number | null; fitReason: string | null; appliedAt: string | null }[];
}
const rupees = (paise: number | null) => (paise == null ? "–" : `₹${Math.round(paise / 100).toLocaleString("en-IN")}`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "–");

export function RoleAdmin({ data }: { data: AdminRoleView }) {
  const { role, events, gateDecisions, applicants } = data;
  const { act, busy } = useStaffAction();
  const [note, setNote] = useState("");
  const [terms, setTerms] = useState<FeeTerms>(role.feeTerms ?? { kind: "percent", amount: 0.1, replacement_guarantee_days: 60 });
  const path = `roles/${role.id}`;
  const can = {
    terms: role.status === "terms_pending" && !role.feeTermsAcceptedAt,
    release: role.status === "terms_pending" && !role.feeTermsReleasedAt,
    waive: role.status === "deposit_pending",
    extend: role.status === "broadcast" && !role.broadcastExtendedAt,
    close: role.status === "broadcast",
  };
  return (
    <div className="work wrap">
      <div className="work__main" style={{ display: "grid", gap: "2rem" }}>
        <section>
          <h2 className="display t-m">{role.title}</h2>
          <p className="meta">{role.type} · <span className="tag">{role.status.replace(/_/g, " ")}</span> · CTC {rupees(role.ctcMin)}–{rupees(role.ctcMax)} · {role.locations.join(", ") || "no location"} · reach {role.campusReach.length} campus{role.campusReach.length === 1 ? "" : "es"}</p>
          {role.jobError && <p className="note note--stop" role="alert">Last job failed: {role.jobError}</p>}
          <dl className="kv" style={{ maxWidth: "40rem", marginTop: "1rem" }}>
            <dt>Fee terms</dt><dd>{role.feeTerms ? `${role.feeTerms.kind === "flat" ? rupees(role.feeTerms.amount) : `${role.feeTerms.amount * 100}% of CTC`}, ${role.feeTerms.replacement_guarantee_days}-day guarantee` : "–"}</dd>
            <dt>Terms released / accepted</dt><dd>{when(role.feeTermsReleasedAt)} / {when(role.feeTermsAcceptedAt)}</dd>
            <dt>Deposit</dt><dd>{rupees(role.depositAmount)} {role.depositMode ? `(${role.depositMode})` : ""}</dd>
            <dt>Broadcast</dt><dd>{when(role.broadcastOpensAt)} → {when(role.broadcastClosesAt)}{role.broadcastExtendedAt ? " (extended)" : ""}</dd>
            <dt>Shortlist ready</dt><dd>{when(role.shortlistReadyAt)}</dd>
          </dl>
        </section>

        <section className="sheet">
          <div className="sheet__head"><h3>Staff actions</h3></div>
          <div className="sheet__pad" style={{ display: "grid", gap: "1rem" }}>
            {can.terms && (
              <form className="field" style={{ maxWidth: "40rem" }} onSubmit={(e) => { e.preventDefault(); void act("terms", "PUT", `${path}/fee-terms`, terms, "Fee terms saved."); }}>
                <label className="small">Fee terms (before the company accepts; amount in paise for flat, a fraction for percent)</label>
                <div className="actions">
                  <select className="input" value={terms.kind} onChange={(e) => setTerms({ ...terms, kind: e.target.value as FeeTerms["kind"] })}><option value="percent">percent</option><option value="flat">flat</option></select>
                  <input className="input" type="number" step="any" value={terms.amount} onChange={(e) => setTerms({ ...terms, amount: Number(e.target.value) })} aria-label="Amount" />
                  <input className="input" type="number" value={terms.replacement_guarantee_days} onChange={(e) => setTerms({ ...terms, replacement_guarantee_days: Number(e.target.value) })} aria-label="Guarantee days" />
                </div>
                <input className="input" placeholder="Notes" value={terms.notes ?? ""} onChange={(e) => setTerms({ ...terms, notes: e.target.value || undefined })} />
                <div className="actions">
                  <button className="btn btn--sm btn--ink" type="submit" disabled={!!busy}>Save terms</button>
                  {can.release && <button className="btn btn--sm" type="button" disabled={!!busy} onClick={() => act("release", "POST", `${path}/release-terms`, {}, "Terms released to the company.")}>Release to company</button>}
                </div>
              </form>
            )}
            {(can.waive || can.extend || can.close) && (
              <div className="field" style={{ maxWidth: "40rem" }}>
                <label htmlFor="staff-note" className="small">Note (required to waive a deposit or close a broadcast; kept on the record)</label>
                <input id="staff-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="actions">
                  {can.waive && <button className="btn btn--sm btn--ink" disabled={!!busy || !note.trim()} onClick={() => act("waive", "POST", `${path}/waive-deposit`, { note }, "Deposit waived; the broadcast is starting.")}>Waive deposit and broadcast</button>}
                  {can.extend && <button className="btn btn--sm" disabled={!!busy} onClick={() => act("extend", "POST", `${path}/extend-broadcast`, { note: note || undefined }, "Broadcast extended.")}>Extend broadcast</button>}
                  {can.close && <button className="btn btn--sm btn--stop" disabled={!!busy || !note.trim()} onClick={() => act("close", "POST", `${path}/close-broadcast`, { note }, "Shortlist frozen.")}>Close broadcast now</button>}
                </div>
              </div>
            )}
            {!can.terms && !can.waive && !can.extend && !can.close && <p className="small">No staff action applies in this state. Gate reviews are in Queues.</p>}
          </div>
        </section>

        <section>
          <h3 className="display t-s">Longlist ({applicants.length})</h3>
          {applicants.length === 0 ? <p className="empty">No applicants yet.</p> : (
            <table className="table"><thead><tr><th>Rank</th><th>Stage</th><th>Fit</th><th>Why</th><th>Applied</th></tr></thead>
              <tbody>{applicants.map((a) => <tr key={a.id}><td>{a.rank ?? "–"}</td><td>{a.stage.replace(/_/g, " ")}</td><td>{a.fitScore ?? "–"}</td><td>{a.fitReason ?? ""}</td><td>{when(a.appliedAt)}</td></tr>)}</tbody>
            </table>
          )}
        </section>

        <section style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(18rem, 1fr))" }}>
          <div>
            <h3 className="display t-s">History</h3>
            <ol className="small" style={{ display: "grid", gap: "0.4rem" }}>{events.map((e, i) => <li key={i}>{when(e.at)}: {e.fromStatus ?? "–"} → <b>{e.toStatus}</b>{e.actor === "system" ? " (system)" : ""}{e.note ? `. ${e.note}` : ""}</li>)}</ol>
          </div>
          <div>
            <h3 className="display t-s">Gate decisions</h3>
            <ol className="small" style={{ display: "grid", gap: "0.4rem" }}>{gateDecisions.map((g, i) => <li key={i}>{when(g.decidedAt)}: {g.stage} → <b>{g.outcome}</b>{g.modelScore != null ? ` (score ${g.modelScore})` : ""}{g.reason ? `. ${g.reason}` : ""}</li>)}</ol>
          </div>
        </section>
      </div>
    </div>
  );
}
