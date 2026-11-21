"use client";
import { useState } from "react";
import type { FinanceSettlement } from "@/lib/api-types";
import { formatPaiseExact as inr } from "@/lib/rules";
import { useStaffAction } from "../act";

export function ReconcileButton() {
  const { act, busy } = useStaffAction();
  return <button type="button" className="btn btn--sm" disabled={!!busy} onClick={() => act("rec", "POST", "payments/reconcile", {}, "Checked open payments and processed the queue.")}>{busy ? "Running" : "Run reconcile now"}</button>;
}

/** Cancel a queued settlement, retry a failed refund, or re-check one in flight with Cashfree. */
export function SettlementActions({ s }: { s: Pick<FinanceSettlement, "id" | "status"> }) {
  const { act, busy } = useStaffAction();
  return (
    <span className="actions" style={{ gap: "0.4rem", flexWrap: "nowrap" }}>
      {s.status === "requested" && <button type="button" className="btn btn--sm" disabled={!!busy} onClick={() => { if (confirm("Cancel this settlement? Nothing has been sent yet.")) void act("c", "POST", `payments/settlements/${s.id}/cancel`, {}, "Settlement cancelled."); }}>Cancel</button>}
      {s.status === "processing" && <button type="button" className="btn btn--sm" disabled={!!busy} onClick={() => act("s", "POST", `payments/settlements/${s.id}/sync`, {}, "Checked with Cashfree.")}>Check</button>}
      {s.status === "failed" && <button type="button" className="btn btn--sm btn--ink" disabled={!!busy} onClick={() => { if (confirm("Send this refund again as a new settlement?")) void act("r", "POST", `payments/settlements/${s.id}/retry`, {}, "Refund queued again."); }}>Retry</button>}
    </span>
  );
}

/** Refund (all or part, with or without the gateway's charges) or forfeit a role's held deposit. Two steps: fill, confirm. */
export function SettleForm({ roleId, available }: { roleId: string; available: number }) {
  const { act, busy } = useStaffAction();
  const [kind, setKind] = useState<"refund" | "forfeit">("refund");
  const [all, setAll] = useState(true);
  const [rupees, setRupees] = useState("");
  const [deduct, setDeduct] = useState(true);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const amount = all ? available : Math.round(Number(rupees) * 100);
  const valid = available > 0 && Number.isInteger(amount) && amount > 0 && amount <= available && reason.trim().length >= 3;
  const edit = <T,>(f: (v: T) => void) => (v: T) => { f(v); setConfirming(false); };
  if (available <= 0) return <p className="small">Nothing is available to settle on this role.</p>;
  return (
    <form className="form" style={{ maxWidth: "36rem" }} onSubmit={async (e) => {
      e.preventDefault();
      if (!valid) return;
      if (!confirming) { setConfirming(true); return; }
      const ok = await act("settle", "POST", `payments/roles/${roleId}/settlements`,
        { kind, amount: all ? undefined : amount, deductGatewayFee: kind === "refund" && deduct, reason: reason.trim() },
        kind === "refund" ? "Refund sent to Cashfree." : "Deposit forfeited.");
      if (ok) { setConfirming(false); setReason(""); setRupees(""); setAll(true); }
    }}>
      <fieldset className="field" style={{ border: 0, padding: 0 }}>
        <legend className="small" style={{ fontWeight: 700 }}>Action</legend>
        <div className="actions">
          <label className="small"><input type="radio" name="kind" checked={kind === "refund"} onChange={() => edit(setKind)("refund")} /> Refund to the company</label>
          <label className="small"><input type="radio" name="kind" checked={kind === "forfeit"} onChange={() => edit(setKind)("forfeit")} /> Forfeit (Novare keeps it)</label>
        </div>
      </fieldset>
      <fieldset className="field" style={{ border: 0, padding: 0 }}>
        <legend className="small" style={{ fontWeight: 700 }}>Amount (available {inr(available)})</legend>
        <div className="actions">
          <label className="small"><input type="radio" name="all" checked={all} onChange={() => edit(setAll)(true)} /> All of it</label>
          <label className="small"><input type="radio" name="all" checked={!all} onChange={() => edit(setAll)(false)} /> Part, in rupees</label>
          {!all && <input className="input" style={{ maxWidth: "10rem" }} inputMode="decimal" aria-label="Amount in rupees" value={rupees} onChange={(e) => edit(setRupees)(e.target.value.replace(/[^\d.]/g, ""))} />}
        </div>
      </fieldset>
      {kind === "refund" && (
        <label className="small"><input type="checkbox" checked={deduct} onChange={(e) => edit(setDeduct)(e.target.checked)} /> Deduct the payment gateway&apos;s charges (Cashfree&apos;s fee plus GST) from the refund</label>
      )}
      <div className="field">
        <label htmlFor="settle-reason" className="small" style={{ fontWeight: 700 }}>Reason (kept on the record{kind === "forfeit" ? "; the company is told" : ""})</label>
        <input id="settle-reason" className="input" required minLength={3} value={reason} onChange={(e) => edit(setReason)(e.target.value)} />
      </div>
      {confirming && valid && (
        <p className="note" role="alert"><b>Confirm.</b>{kind === "refund" ? `Refund ${inr(amount)}${deduct ? " less the gateway's charges" : " in full"} through Cashfree.` : `Forfeit ${inr(amount)}. This cannot be undone.`}</p>
      )}
      <div className="actions">
        <button type="submit" className={`btn btn--sm ${kind === "forfeit" ? "btn--stop" : "btn--ink"}`} disabled={!!busy || !valid}>{confirming ? (kind === "refund" ? "Yes, send the refund" : "Yes, forfeit") : "Review"}</button>
        {confirming && <button type="button" className="btn btn--sm" onClick={() => setConfirming(false)}>Back</button>}
      </div>
    </form>
  );
}

export function OrderSync({ orderId }: { orderId: string }) {
  const { act, busy } = useStaffAction();
  return <button type="button" className="btn btn--sm" disabled={!!busy} onClick={() => act("o", "POST", `payments/orders/${encodeURIComponent(orderId)}/sync`, {}, "Checked with Cashfree.")}>Check</button>;
}
