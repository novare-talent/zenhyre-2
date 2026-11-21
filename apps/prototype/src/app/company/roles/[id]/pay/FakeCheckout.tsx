"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useNotify } from "@/components/Toasts";
import type { PaymentOrderView } from "@/lib/api-types";
import { formatPaiseExact as inr } from "@/lib/rules";
import { zh } from "@/lib/zh";

export function FakeCheckout({ roleId, order }: { roleId: string; order: PaymentOrderView }) {
  const router = useRouter();
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const go = async (outcome: "success" | "failed") => {
    setBusy(true);
    try {
      await zh(`/roles/${roleId}/payments/orders/${encodeURIComponent(order.orderId)}/fake-pay`, { method: "POST", body: { outcome } });
      if (outcome === "failed") { notify("Payment declined (simulated). You can try again from the role page."); router.push(`/company/roles/${roleId}`); return; }
      router.push(`/company/roles/${roleId}?order_id=${encodeURIComponent(order.orderId)}`);
    } catch (err) { notify((err as Error).message); setBusy(false); }
  };
  return (
    <div className="work wrap">
      <div className="work__main">
        <div className="sheet post">
          <div className="sheet__head"><h3>Test checkout</h3><span className="tag tag--lit">No real money</span></div>
          <div className="sheet__pad" style={{ display: "grid", gap: "1.25rem" }}>
            <p className="small measure">The API is running the fake payment gateway, so this page stands in for Cashfree. Set <span className="mono">PAYMENT_PROVIDER=cashfree</span> with sandbox keys to see the real checkout.</p>
            <dl className="kv" style={{ maxWidth: "28rem" }}>
              <dt>For</dt><dd>{order.purpose === "deposit" ? "Hiring deposit" : "Success fee"}</dd>
              <dt>Order</dt><dd className="mono">{order.orderId}</dd>
              <dt>Taxable</dt><dd className="num">{inr(order.taxable)}</dd>
              <dt>GST</dt><dd className="num">{inr(order.gst)}</dd>
              <div className="kv--total" style={{ display: "contents" }}><dt>Total</dt><dd className="num">{inr(order.total)}</dd></div>
            </dl>
            <div className="actions">
              <button type="button" className="btn btn--ink" disabled={busy} onClick={() => void go("success")}>Pay {inr(order.total)} (simulated)</button>
              <button type="button" className="btn btn--stop btn--sm" disabled={busy} onClick={() => void go("failed")}>Fail the payment</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
