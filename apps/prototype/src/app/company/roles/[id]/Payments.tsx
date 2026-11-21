"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Arrow } from "@/components/Icons";
import { useNotify } from "@/components/Toasts";
import { GST_STATES, type Billing, type CheckoutView, type CompanyRoleView, type RolePaymentsView } from "@/lib/api-types";
import { formatPaiseExact as inr } from "@/lib/rules";
import { zh } from "@/lib/zh";

type Purpose = "deposit" | "fee";
const pct = (r: number) => `${Math.round(r * 100)}%`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

declare global { interface Window { Cashfree?: (o: { mode: "sandbox" | "production" }) => { checkout: (o: { paymentSessionId: string; redirectTarget?: string }) => Promise<unknown> } } }
let sdk: Promise<void> | null = null;
/** Cashfree's JS SDK v3, loaded once, only when a real checkout starts. */
function loadCashfree(): Promise<void> {
  if (window.Cashfree) return Promise.resolve();
  sdk ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { sdk = null; reject(new Error("Could not load the payment page. Check your connection and try again.")); };
    document.head.appendChild(s);
  });
  return sdk;
}

/**
 * Starting a checkout and coming back from one. A first payment asks for billing details (Cashfree needs a phone; the
 * GST invoice needs the legal name, address and state). The redirect back carries `order_id`; the page then asks the
 * API, which asks Cashfree, until the payment shows as paid. The redirect alone never counts.
 */
export function usePayments(role: CompanyRoleView, payments: RolePaymentsView | null, returned: { orderId?: string; pay?: string }) {
  const router = useRouter();
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [billingFor, setBillingFor] = useState<Purpose | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const start = useCallback(async (purpose: Purpose, billing?: Omit<Billing, "state">) => {
    if (busy || !payments) return;
    if (!billing && !payments.billing) { setBillingFor(purpose); return; }
    setBusy(true);
    try {
      const { checkout } = await zh<{ checkout: CheckoutView }>(`/roles/${role.id}/payments/checkout`, { method: "POST", body: { purpose, billing } });
      setBillingFor(null);
      if (checkout.mode === "fake") { router.push(`/company/roles/${role.id}/pay?order=${encodeURIComponent(checkout.orderId)}`); return; }
      if (!checkout.paymentSessionId) throw new Error("The payment could not be started. Try again.");
      await loadCashfree();
      await window.Cashfree!({ mode: checkout.mode }).checkout({ paymentSessionId: checkout.paymentSessionId, redirectTarget: "_self" });
    } catch (err) {
      notify((err as Error).message);
    } finally { setBusy(false); }
  }, [busy, payments, role.id, router, notify]);

  // Back from checkout: confirm with the API a few times, then tidy the address bar.
  const synced = useRef(false);
  useEffect(() => {
    const orderId = returned.orderId;
    if (!orderId || synced.current) return;
    synced.current = true;
    setConfirming(orderId);
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 8 && !cancelled; i++) {
        try {
          const r = await zh<{ order: { status: string; total: number } }>(`/roles/${role.id}/payments/orders/${encodeURIComponent(orderId)}/sync`, { method: "POST", body: {} });
          if (r.order.status === "paid") { notify(`Payment of ${inr(r.order.total)} received. The invoice is on its way by email.`); break; }
          if (r.order.status === "expired" || r.order.status === "cancelled") { notify("That payment did not complete. You can try again."); break; }
        } catch (err) { notify((err as Error).message); break; }
        if (i === 7) notify("We have not heard from the bank yet. This page updates once the payment is confirmed; you will also get an email.");
        await new Promise((r) => setTimeout(r, 2500));
      }
      if (!cancelled) { setConfirming(null); router.replace(`/company/roles/${role.id}`); router.refresh(); }
    })();
    return () => { cancelled = true; };
  }, [returned.orderId, role.id, router, notify]);

  // The fee email links here with ?pay=fee.
  const autoPaid = useRef(false);
  useEffect(() => {
    if (returned.pay === "fee" && payments?.canPayFee && !autoPaid.current && !returned.orderId) { autoPaid.current = true; void start("fee"); }
  }, [returned.pay, returned.orderId, payments?.canPayFee, start]);

  return { start, busy, confirming, billingFor, closeBilling: () => setBillingFor(null) };
}
export type PaymentsCtl = ReturnType<typeof usePayments>;

function GstRows({ cgst, sgst, igst, gstRate }: { cgst: number; sgst: number; igst: number; gstRate: number }) {
  return igst
    ? <><dt>IGST at {pct(gstRate)}</dt><dd className="num">{inr(igst)}</dd></>
    : <><dt>CGST at {pct(gstRate / 2)}</dt><dd className="num">{inr(cgst)}</dd><dt>SGST at {pct(gstRate / 2)}</dt><dd className="num">{inr(sgst)}</dd></>;
}

/** deposit_pending: the deposit with its GST, and the way to pay it. */
export function DepositSheet({ payments, ctl, broadcastDays }: { payments: RolePaymentsView | null; ctl: PaymentsCtl; broadcastDays: number }) {
  if (!payments) return <div className="note post"><b>Deposit due.</b>The payment details could not be loaded. Refresh the page in a minute.</div>;
  const d = payments.deposit;
  return (
    <div className="sheet post">
      <div className="sheet__head"><h3>Deposit</h3><span className="tag tag--lit">{ctl.confirming ? "Confirming" : "Due now"}</span></div>
      <div className="sheet__pad" style={{ display: "grid", gap: "1.25rem" }}>
        <p className="display t-l num">{inr(d.total)} to switch the role on.</p>
        <dl className="kv" style={{ maxWidth: "28rem" }}>
          <dt>Refundable deposit</dt><dd className="num">{inr(d.taxable)}</dd>
          <GstRows cgst={d.cgst} sgst={d.sgst} igst={d.igst} gstRate={payments.gstRate} />
          <div className="kv--total" style={{ display: "contents" }}><dt>To pay</dt><dd className="num">{inr(d.total)}</dd></div>
        </dl>
        {!payments.billing && <p className="meta">The CGST and SGST split assumes the same state as Novare; it becomes IGST if your billing state differs.</p>}
        <div className="actions">
          <button type="button" className="btn btn--ink" disabled={ctl.busy || !!ctl.confirming || !payments.canPayDeposit} onClick={() => void ctl.start("deposit")}>
            {ctl.confirming ? "Confirming your payment" : ctl.busy ? "Opening the payment page" : `Pay ${inr(d.total)}`}<Arrow />
          </button>
          <span className="meta">{payments.mode === "fake" ? "Test mode: no real money moves." : "Secure payment by Cashfree: UPI, cards, net banking."}</span>
        </div>
        <p className="small measure">
          The role goes live to candidates as soon as the payment is confirmed, and stays open for {broadcastDays} days. Once it is live the
          deposit is not refunded on request. If the role ends with no hire it is refunded on its own, less the payment gateway&apos;s charges;
          on a hire it is applied to the success fee. A GST invoice is emailed with the receipt.
        </p>
      </div>
    </div>
  );
}

/** After a hire: the success fee with GST, the deposit applied to it, and what is left to pay. */
export function FeeLines({ payments, ctl }: { payments: RolePaymentsView; ctl: PaymentsCtl }) {
  const b = payments.balances;
  if (!b.feeDue) return <p className="meta">The fee is raised when the hire is recorded with its CTC.</p>;
  return (
    <>
      <dl className="kv">
        <dt>Success fee incl. {pct(payments.gstRate)} GST</dt><dd className="num">{inr(b.feeDue)}</dd>
        {b.depositApplied > 0 && <><dt>Deposit applied</dt><dd className="num">minus {inr(b.depositApplied)}</dd></>}
        {b.feePaid > 0 && <><dt>Paid</dt><dd className="num">minus {inr(b.feePaid)}</dd></>}
        <div className="kv--total" style={{ display: "contents" }}><dt>Outstanding</dt><dd className="num">{inr(Math.max(0, b.feeOutstanding))}</dd></div>
      </dl>
      {payments.canPayFee
        ? <button type="button" className="btn btn--ink btn--sm" style={{ marginTop: "1rem" }} disabled={ctl.busy || !!ctl.confirming} onClick={() => void ctl.start("fee")}>
            {ctl.confirming ? "Confirming your payment" : `Pay ${inr(b.feeOutstanding)}`}<Arrow />
          </button>
        : b.feeOutstanding <= 0 && <p className="meta" style={{ marginTop: "0.75rem" }}>Paid in full. Thank you.</p>}
    </>
  );
}

/** Every payment, refund and invoice on the role. */
export function PaymentHistory({ roleId, payments }: { roleId: string; payments: RolePaymentsView }) {
  const paid = payments.orders.filter((o) => o.status === "paid");
  const refunds = payments.settlements.filter((s) => s.kind === "refund" || s.status === "succeeded");
  if (!paid.length && !refunds.length && !payments.invoices.length) return null;
  const SETTLE: Record<string, string> = { requested: "Queued", processing: "With the bank", succeeded: "Done", failed: "Failed, Novare is on it", cancelled: "Cancelled" };
  return (
    <div className="sheet post" style={{ "--i": 4 } as React.CSSProperties}>
      <div className="sheet__head"><h3>Payments</h3></div>
      <div className="sheet__pad" style={{ display: "grid", gap: "1rem" }}>
        {paid.length > 0 && (
          <dl className="kv">
            {paid.map((o) => (
              <div key={o.orderId} style={{ display: "contents" }}>
                <dt>{o.purpose === "deposit" ? "Deposit" : "Fee"} paid {o.paidAt ? day(o.paidAt) : ""}<span className="meta mono" style={{ display: "block" }}>{o.cfPaymentId}</span></dt>
                <dd className="num">{inr(o.total)}</dd>
              </div>
            ))}
          </dl>
        )}
        {refunds.length > 0 && (
          <dl className="kv">
            {refunds.map((s) => (
              <div key={s.id} style={{ display: "contents" }}>
                <dt>{s.kind === "refund" ? "Refund" : "Forfeited"}: {SETTLE[s.status]}{s.gatewayFee > 0 && <span className="meta" style={{ display: "block" }}>{inr(s.amount)} less gateway charges {inr(s.gatewayFee)}</span>}</dt>
                <dd className="num">{inr(s.kind === "refund" ? s.refunded : s.amount)}</dd>
              </div>
            ))}
          </dl>
        )}
        {payments.invoices.length > 0 && (
          <ul className="small" style={{ display: "grid", gap: "0.4rem" }}>
            {payments.invoices.map((i) => (
              <li key={i.id}><a className="link" href={`/api/pay/roles/${roleId}/invoices/${i.id}`} target="_blank" rel="noreferrer">{i.kind === "credit_note" ? "Credit note" : "Tax invoice"} <span className="mono">{i.number}</span></a> <span className="meta num">{inr(i.total)}, {day(i.issuedAt)}</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Billing details for the GST invoice, and the phone number Cashfree requires. Asked once, then prefilled. */
export function BillingDialog({ ctl, initial, defaultEmail }: { ctl: PaymentsCtl; initial: Billing | null; defaultEmail: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [f, setF] = useState({ legalName: initial?.legalName ?? "", gstin: initial?.gstin ?? "", address: initial?.address ?? "",
    stateCode: initial?.stateCode ?? "", phone: initial?.phone ?? "", email: initial?.email ?? defaultEmail });
  const open = ctl.billingFor !== null;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const phoneOk = /^(\+?91[\s-]?|0)?[6-9]\d{9}$/.test(f.phone.replace(/[\s-]/g, ""));
  const gstinOk = !f.gstin || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(f.gstin.toUpperCase());
  return (
    <dialog ref={ref} className="panel" aria-labelledby="billing-h" onClose={ctl.closeBilling}>
      <div className="panel__head">
        <span className="meta">Before you pay</span>
        <button type="button" className="btn btn--sm" onClick={() => ref.current?.close()}>Close</button>
      </div>
      <form className="panel__body form" onSubmit={(e) => {
        e.preventDefault();
        if (!ctl.billingFor) return;
        void ctl.start(ctl.billingFor, { ...f, gstin: f.gstin.trim().toUpperCase() || null });
      }}>
        <div>
          <h2 id="billing-h" className="display t-l">Billing details</h2>
          <p className="meta" style={{ marginTop: "0.5rem" }}>For the GST invoice on every payment. Asked once; you can change them on a later payment.</p>
        </div>
        <div className="field"><label htmlFor="b-name">Legal name of the business</label><input id="b-name" className="input" required minLength={2} value={f.legalName} onChange={set("legalName")} autoComplete="organization" /></div>
        <div className="field">
          <label htmlFor="b-gstin">GSTIN <span className="meta">(leave empty if not registered)</span></label>
          <input id="b-gstin" className="input mono" value={f.gstin} onChange={set("gstin")} maxLength={15} aria-invalid={!gstinOk} style={{ textTransform: "uppercase" }} />
          {!gstinOk && <span className="hint" role="alert">That is not a valid GSTIN.</span>}
        </div>
        <div className="field"><label htmlFor="b-addr">Billing address</label><textarea id="b-addr" className="input" required minLength={5} rows={3} value={f.address} onChange={set("address")} autoComplete="street-address" /></div>
        <div className="form__pair">
          <div className="field">
            <label htmlFor="b-state">State</label>
            <select id="b-state" className="select" required value={f.stateCode} onChange={set("stateCode")}>
              <option value="">Choose the state</option>
              {Object.entries(GST_STATES).sort((a, b) => a[1].localeCompare(b[1])).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="b-phone">Mobile number</label>
            <input id="b-phone" className="input" type="tel" inputMode="tel" required value={f.phone} onChange={set("phone")} autoComplete="tel" aria-invalid={!!f.phone && !phoneOk} />
            <span className="hint">{f.phone && !phoneOk ? "Enter a 10-digit Indian mobile number." : "Required by the payment gateway."}</span>
          </div>
        </div>
        <div className="field"><label htmlFor="b-email">Invoices go to</label><input id="b-email" className="input" type="email" required value={f.email} onChange={set("email")} autoComplete="email" /></div>
        <div className="actions">
          <button type="submit" className="btn btn--ink" disabled={ctl.busy || !phoneOk || !gstinOk}>{ctl.busy ? "Opening the payment page" : "Save and continue to payment"}<Arrow /></button>
        </div>
      </form>
    </dialog>
  );
}
