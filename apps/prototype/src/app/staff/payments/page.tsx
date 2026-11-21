import type { Metadata } from "next";
import Link from "next/link";
import type { FinanceOverview } from "@/lib/api-types";
import { formatPaiseExact as inr } from "@/lib/rules";
import { readApi } from "@/lib/server-api";
import { requireFinanceSession } from "../guard";
import { ReconcileButton, SettlementActions } from "./FinanceActions";

export const metadata: Metadata = { title: "Payments" };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "–");

/** The finance console: every role with money on it, the settlement queue, deposits waiting on a decision, payment alerts. */
export default async function Page() {
  await requireFinanceSession();
  const data = await readApi<FinanceOverview>("/admin/payments");
  const title = (roleId: string) => data.roles.find((r) => r.roleId === roleId)?.title ?? roleId.slice(0, 8);
  return (
    <div className="work wrap">
      <div className="work__main" style={{ display: "grid", gap: "2rem" }}>
        <section className="actions" style={{ justifyContent: "space-between" }}>
          <div>
            <h2 className="display t-m">Payments</h2>
            <p className="meta">Gateway: {data.mode === "fake" ? "fake (offline dev, no real money)" : `Cashfree ${data.mode}`}. Every refund and forfeit here is audited.</p>
          </div>
          <ReconcileButton />
        </section>

        {data.decisions.length > 0 && (
          <section>
            <h3 className="display t-s">Deposits waiting on a decision ({data.decisions.length})</h3>
            <ul className="rows">
              {data.decisions.map((d) => (
                <li key={d.id} className="row">
                  <Link href={`/staff/payments/${d.refId}`} className="row__hit role-row">
                    <span><span className="role-row__title">{title(d.refId)}</span><span className="meta" style={{ display: "block" }}>{String(d.payload.reason ?? "")} · opened {when(d.openedAt)}</span></span>
                    <span className="tag tag--lit">Decide</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="display t-s">Settlement queue ({data.settlements.length})</h3>
          {data.settlements.length === 0 ? <p className="empty">Nothing queued, in flight or failed.</p> : (
            <table className="table">
              <thead><tr><th>Role</th><th>Kind</th><th>Amount</th><th>Gateway fee</th><th>Status</th><th>Source</th><th>Requested</th><th /></tr></thead>
              <tbody>{data.settlements.map((s) => (
                <tr key={s.id}>
                  <td><Link className="link" href={`/staff/payments/${s.roleId}`}>{title(s.roleId)}</Link></td>
                  <td>{s.kind}</td><td className="num">{inr(s.amount)}</td><td className="num">{s.gatewayFee ? inr(s.gatewayFee) : "–"}</td>
                  <td><span className={`tag${s.status === "failed" ? " tag--stop" : ""}`}>{s.status}</span>{s.failureReason ? <span className="meta" style={{ display: "block" }}>{s.failureReason}</span> : null}</td>
                  <td className="small">{s.source}</td><td className="small">{when(s.requestedAt)}</td>
                  <td><SettlementActions s={s} /></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>

        {data.alerts.length > 0 && (
          <section>
            <h3 className="display t-s">Payment alerts ({data.alerts.length})</h3>
            <ul className="small" style={{ display: "grid", gap: "0.4rem" }}>
              {data.alerts.map((a) => <li key={a.id} className="note note--stop">{when(a.openedAt)}: {String(a.payload.reason ?? a.refType)} <span className="mono meta">{a.refType} {a.refId.slice(0, 12)}</span></li>)}
            </ul>
            <p className="meta">Resolve alerts from the Queues tab once handled.</p>
          </section>
        )}

        <section>
          <h3 className="display t-s">Roles with money ({data.roles.length})</h3>
          {data.roles.length === 0 ? <p className="empty">No payments yet.</p> : (
            <table className="table">
              <thead><tr><th>Role</th><th>Status</th><th>Paid</th><th>Held</th><th>Refunded</th><th>Fee due</th><th>Outstanding</th></tr></thead>
              <tbody>{data.roles.map((r) => (
                <tr key={r.roleId}>
                  <td><Link className="link" href={`/staff/payments/${r.roleId}`}>{r.title}</Link><span className="meta" style={{ display: "block" }}>{r.companyName}</span></td>
                  <td><span className="tag">{(r.status ?? "").replace(/_/g, " ")}</span></td>
                  <td className="num">{inr(r.depositPaid)}</td><td className="num">{inr(r.depositHeld)}</td><td className="num">{inr(r.depositRefunded)}</td>
                  <td className="num">{inr(r.feeDue)}</td><td className="num">{inr(Math.max(0, r.feeOutstanding))}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
