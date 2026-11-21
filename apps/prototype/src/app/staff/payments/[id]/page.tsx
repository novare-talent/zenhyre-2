import type { Metadata } from "next";
import Link from "next/link";
import type { FinanceRoleView } from "@/lib/api-types";
import { formatPaiseExact as inr } from "@/lib/rules";
import { readApiOrNull } from "@/lib/server-api";
import { requireFinanceSession } from "../../guard";
import { OrderSync, SettleForm, SettlementActions } from "../FinanceActions";

export const metadata: Metadata = { title: "Role payments" };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "–");
const TYPE: Record<string, string> = {
  deposit_received: "Deposit received", deposit_refunded: "Deposit refunded", deposit_gateway_fee_retained: "Gateway charges retained",
  deposit_forfeited: "Deposit forfeited", deposit_applied_to_fee: "Deposit applied to fee", deposit_application_reversed: "Deposit application reversed",
  fee_due: "Fee raised", fee_paid: "Fee paid", fee_voided: "Fee voided",
};

/** One role's money: balances, orders, the ledger, settlements and invoices, and the refund / forfeit form. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireFinanceSession();
  const { id } = await params;
  const data = await readApiOrNull<FinanceRoleView>(`/admin/payments/roles/${id}`);
  if (!data) return <div className="wrap"><p className="empty">No such role.</p></div>;
  const { role, summary, entries, settlements } = data;
  const b = summary.balances;
  return (
    <div className="work wrap">
      <div className="work__main" style={{ display: "grid", gap: "2rem" }}>
        <section>
          <Link href="/staff/payments" className="small link">All payments</Link>
          <h2 className="display t-m" style={{ marginTop: "0.75rem" }}>{role.title}</h2>
          <p className="meta">{role.companyName} · <span className="tag">{role.status.replace(/_/g, " ")}</span> · deposit {role.depositAmount != null ? `${inr(role.depositAmount)} + GST` : "not set"}{role.depositMode ? ` (${role.depositMode})` : ""} · <Link className="link" href={`/staff/roles/${role.id}`}>role admin</Link></p>
          <dl className="kv" style={{ maxWidth: "40rem", marginTop: "1rem" }}>
            <dt>Deposit paid</dt><dd className="num">{inr(b.depositPaid)}</dd>
            <dt>Held now</dt><dd className="num">{inr(b.depositHeld)}</dd>
            <dt>In flight</dt><dd className="num">{inr(b.settlementsPending)}</dd>
            <dt>Available to settle</dt><dd className="num">{inr(b.depositAvailable)}</dd>
            <dt>Refunded / gateway charges / forfeited</dt><dd className="num">{inr(b.depositRefunded)} / {inr(b.gatewayFeeRetained)} / {inr(b.depositForfeited)}</dd>
            <dt>Fee due / deposit applied / paid</dt><dd className="num">{inr(b.feeDue)} / {inr(b.depositApplied)} / {inr(b.feePaid)}</dd>
            <div className="kv--total" style={{ display: "contents" }}><dt>Fee outstanding</dt><dd className="num">{inr(Math.max(0, b.feeOutstanding))}</dd></div>
          </dl>
        </section>

        <section className="sheet">
          <div className="sheet__head"><h3>Refund or forfeit</h3></div>
          <div className="sheet__pad">
            <SettleForm roleId={role.id} available={b.depositAvailable} />
            <p className="meta" style={{ marginTop: "1rem" }}>The same request can be made in SQL: <span className="mono">{`select zenhyre2.request_deposit_settlement('${role.id}', 'refund', null, 'reason', 'you@novaretalent.com');`}</span></p>
          </div>
        </section>

        <section>
          <h3 className="display t-s">Settlements ({settlements.length})</h3>
          {settlements.length === 0 ? <p className="empty">None.</p> : (
            <table className="table">
              <thead><tr><th>Kind</th><th>Amount</th><th>Gateway fee</th><th>Status</th><th>Reason</th><th>Source</th><th>Requested</th><th /></tr></thead>
              <tbody>{settlements.map((s) => (
                <tr key={s.id}>
                  <td>{s.kind}</td><td className="num">{inr(s.amount)}</td><td className="num">{s.gatewayFee ? inr(s.gatewayFee) : "–"}</td>
                  <td><span className={`tag${s.status === "failed" ? " tag--stop" : s.status === "succeeded" ? " tag--lit" : ""}`}>{s.status}</span>{s.failureReason ? <span className="meta" style={{ display: "block" }}>{s.failureReason}</span> : null}{s.cfRefundId ? <span className="meta mono" style={{ display: "block" }}>{s.cfRefundId}</span> : null}</td>
                  <td className="small">{s.reason}</td><td className="small">{s.source} · {s.requestedBy}</td><td className="small">{when(s.requestedAt)}</td>
                  <td><SettlementActions s={s} /></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>

        <section>
          <h3 className="display t-s">Checkouts ({summary.orders.length})</h3>
          {summary.orders.length === 0 ? <p className="empty">None.</p> : (
            <table className="table">
              <thead><tr><th>Order</th><th>For</th><th>Taxable</th><th>GST</th><th>Total</th><th>Status</th><th>Paid</th><th /></tr></thead>
              <tbody>{summary.orders.map((o) => (
                <tr key={o.orderId}>
                  <td className="mono small">{o.orderId}</td><td>{o.purpose}</td><td className="num">{inr(o.taxable)}</td><td className="num">{inr(o.gst)}</td><td className="num">{inr(o.total)}</td>
                  <td><span className="tag">{o.status}</span></td><td className="small">{when(o.paidAt)}{o.cfPaymentId ? <span className="meta mono" style={{ display: "block" }}>{o.cfPaymentId}</span> : null}</td>
                  <td>{(o.status === "active" || o.status === "cancelled") && <OrderSync orderId={o.orderId} />}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>

        <section>
          <h3 className="display t-s">Ledger ({entries.length})</h3>
          {entries.length === 0 ? <p className="empty">No entries.</p> : (
            <table className="table">
              <thead><tr><th>When</th><th>Entry</th><th>Amount</th><th>of which GST</th><th>Ref</th><th>Note</th></tr></thead>
              <tbody>{entries.map((e) => (
                <tr key={e.id}><td className="small">{when(e.createdAt)}</td><td>{TYPE[e.type] ?? e.type}</td><td className="num">{inr(e.amount)}</td><td className="num">{e.tax ? inr(e.tax) : "–"}</td><td className="mono small">{e.externalRef ?? ""}</td><td className="small">{e.note ?? ""}</td></tr>
              ))}</tbody>
            </table>
          )}
        </section>

        <section>
          <h3 className="display t-s">Invoices ({summary.invoices.length})</h3>
          {summary.invoices.length === 0 ? <p className="empty">None.</p> : (
            <ul className="small" style={{ display: "grid", gap: "0.4rem" }}>
              {summary.invoices.map((i) => <li key={i.id}><a className="link" href={`/api/pay/finance/invoices/${i.id}`} target="_blank" rel="noreferrer">{i.kind === "credit_note" ? "Credit note" : "Tax invoice"} <span className="mono">{i.number}</span></a> <span className="meta num">{inr(i.total)}, {when(i.issuedAt)}</span></li>)}
            </ul>
          )}
          {summary.billing && <p className="meta" style={{ marginTop: "0.75rem" }}>Billed to {summary.billing.legalName}{summary.billing.gstin ? ` (GSTIN ${summary.billing.gstin})` : ""}, {summary.billing.state}. {summary.billing.email} · {summary.billing.phone}</p>}
        </section>
      </div>
    </div>
  );
}
