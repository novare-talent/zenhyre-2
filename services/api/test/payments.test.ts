// Deposits and fees through the (fake) payment gateway: pricing, checkout, the role going live on payment, webhooks,
// the fee on a hire, refunds by rule and by finance, forfeits from SQL, and reversal when a hire does not join.
import { describe, expect, it, beforeAll } from "vitest";
import { eq, sql } from "@zenhyre/db/orm";
import { schema } from "@zenhyre/db";
import { fakeGateway, type FakeGateway } from "@zenhyre/ledger";
import { body, DAY, L, post, world, type Seat, type World } from "./world";

const billing = { legalName: "Lab0 Technologies Private Limited", gstin: "27AAACL1234A1Z5", address: "4th Floor, Bandra Kurla Complex, Mumbai",
  stateCode: "27", phone: "+91 98765 43210", email: "accounts@lab0.ai" };
// 12–16 LPA role → the 15–20 LPA slab → ₹15,000 + 18% GST.
const DEPOSIT = 1_500_000, DEPOSIT_GST = 270_000, DEPOSIT_TOTAL = 1_770_000;

async function setup() {
  const gw = fakeGateway();
  const w = await world({ gateway: gw });
  const finance = await w.seat("cfo@novaretalent.com");
  await w.t.db.update(schema.user).set({ isStaff: true, isFinance: true }).where(eq(schema.user.id, finance.userId));
  const payments = async (roleId: string) => (await body(await w.ceo.req(`/roles/${roleId}/payments`))).payments;
  async function checkout(roleId: string, purpose: "deposit" | "fee", withBilling = true) {
    return w.ceo.req(`/roles/${roleId}/payments/checkout`, post({ purpose, ...(withBilling ? { billing } : {}) }));
  }
  async function pay(roleId: string, purpose: "deposit" | "fee" = "deposit") {
    const res = await checkout(roleId, purpose);
    expect(res.status).toBe(200);
    const { orderId } = (await body(res)).checkout;
    const paid = await w.ceo.req(`/roles/${roleId}/payments/orders/${orderId}/fake-pay`, post({ outcome: "success" }));
    expect((await body(paid)).order.status).toBe("paid");
    return orderId as string;
  }
  /** A paid role in `shortlist_ready` with `applicants` shortlisted. */
  async function paidShortlist(title: string, applicants: Seat[]) {
    const id = await w.roleAt("deposit_pending", title);
    await pay(id);
    const match: Record<string, string> = {};
    for (const s of applicants) match[s.email] = (await body(await s.req(`/me/roles/${id}/apply`, post()))).application.id;
    expect((await w.staff.req(`/admin/roles/${id}/close-broadcast`, post({ note: "Moving early." }))).status).toBe(200);
    return { id, match };
  }
  const ledger = async (roleId: string) => (await w.t.db.select().from(schema.ledgerEntry).where(eq(schema.ledgerEntry.roleId, roleId)))
    .map((e) => [e.type, e.amount]);
  const emailsTo = (to: string) => w.t.transport.sent.filter((m) => m.to === to);
  return { gw, w, finance, payments, checkout, pay, paidShortlist, ledger, emailsTo };
}
type S = Awaited<ReturnType<typeof setup>>;

describe("deposit checkout", () => {
  let s: S; let w: World;
  beforeAll(async () => { s = await setup(); w = s.w; });

  it("prices the deposit on the CTC slab, plus GST shown separately", async () => {
    const id = await w.roleAt("deposit_pending", "Backend engineer");
    expect((await w.row(id)).depositAmount).toBe(DEPOSIT);
    const p = await s.payments(id);
    expect(p).toMatchObject({ mode: "fake", canPayDeposit: true, deposit: { taxable: DEPOSIT, gst: DEPOSIT_GST, total: DEPOSIT_TOTAL } });
  });

  it("asks for billing details and a phone number at the first checkout", async () => {
    const id = await w.roleAt("deposit_pending", "Data engineer");
    const res = await s.checkout(id, "deposit", false);
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("billing_required");
    const bad = await w.ceo.req(`/roles/${id}/payments/checkout`, post({ purpose: "deposit", billing: { ...billing, phone: "12345" } }));
    expect(bad.status).toBe(400);
    const ok = await body(await s.checkout(id, "deposit"));
    expect(ok.checkout).toMatchObject({ mode: "fake", total: DEPOSIT_TOTAL, taxable: DEPOSIT, gst: DEPOSIT_GST });
    // The phone is stored as 10 digits; the second checkout reuses the live order and the saved details.
    const again = await body(await s.checkout(id, "deposit", false));
    expect(again.checkout.orderId).toBe(ok.checkout.orderId);
    expect((await s.payments(id)).billing).toMatchObject({ phone: "9876543210", gstin: "27AAACL1234A1Z5", state: "Maharashtra" });
  });

  it("takes the role live only once the gateway confirms payment, and emails a GST invoice", async () => {
    const id = await w.roleAt("deposit_pending", "Platform engineer");
    const { orderId } = (await body(await s.checkout(id, "deposit"))).checkout;
    // Coming back from checkout without paying changes nothing.
    expect((await body(await w.ceo.req(`/roles/${id}/payments/orders/${orderId}/sync`, post()))).roleStatus).toBe("deposit_pending");
    await w.ceo.req(`/roles/${id}/payments/orders/${orderId}/fake-pay`, post({ outcome: "success" }));
    const role = await w.row(id);
    expect(role).toMatchObject({ status: "broadcast", depositMode: "cashfree" });
    expect(await s.ledger(id)).toEqual([["deposit_received", DEPOSIT_TOTAL]]);
    const [inv] = await w.t.db.select().from(schema.invoice).where(eq(schema.invoice.roleId, id));
    expect(inv).toMatchObject({ kind: "tax_invoice", taxable: DEPOSIT, cgst: 135_000, sgst: 135_000, igst: 0, total: DEPOSIT_TOTAL });
    expect(inv!.number).toMatch(/^NT\/INV\/2026-27\/\d{5}$/);
    const mail = s.emailsTo("ceo@lab0.ai").find((m) => m.subject === "Deposit received: Platform engineer")!;
    expect(mail.attachments?.[0]?.filename).toMatch(/\.pdf$/);
    expect(mail.attachments![0]!.content.subarray(0, 4).toString()).toBe("%PDF");
    // The accounts address on the billing details gets the invoice too.
    expect(s.emailsTo("accounts@lab0.ai").some((m) => m.subject === "Deposit received: Platform engineer")).toBe(true);
    // A second confirmation (webhook replay, second sync) is a no-op.
    await w.ceo.req(`/roles/${id}/payments/orders/${orderId}/sync`, post());
    expect(await s.ledger(id)).toHaveLength(1);
    // The PDF can be downloaded from the role.
    const pdf = await w.ceo.req(`/roles/${id}/invoices/${inv!.id}/pdf`);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
  });

  it("a failed payment leaves the role waiting", async () => {
    const id = await w.roleAt("deposit_pending", "SRE");
    const { orderId } = (await body(await s.checkout(id, "deposit"))).checkout;
    await w.ceo.req(`/roles/${id}/payments/orders/${orderId}/fake-pay`, post({ outcome: "failed" }));
    expect((await w.row(id)).status).toBe("deposit_pending");
  });

  it("verifies webhook signatures and ignores replays", async () => {
    const id = await w.roleAt("deposit_pending", "ML engineer");
    const { orderId } = (await body(await s.checkout(id, "deposit"))).checkout;
    s.gw.pay(orderId);
    const raw = JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: orderId }, payment: { cf_payment_id: `cfp_${orderId}`, payment_status: "SUCCESS" } } });
    const send = (headers: Record<string, string>) => w.t.app.request("/webhooks/cashfree", { method: "POST", body: raw, headers });
    expect((await send({ "x-webhook-timestamp": "1", "x-webhook-signature": "forged" })).status).toBe(401);
    const { timestamp, signature } = s.gw.sign(raw);
    expect(await (await send({ "x-webhook-timestamp": timestamp, "x-webhook-signature": signature })).json()).toEqual({ ok: true });
    expect((await w.row(id)).status).toBe("broadcast");
    expect(await (await send({ "x-webhook-timestamp": timestamp, "x-webhook-signature": signature })).json()).toEqual({ ok: true, duplicate: true });
    expect(await s.ledger(id)).toHaveLength(1);
  });

  it("refunds a payment that lands after the role was withdrawn", async () => {
    const id = await w.roleAt("deposit_pending", "Analyst");
    const { orderId } = (await body(await s.checkout(id, "deposit"))).checkout;
    expect((await w.withdraw(w.ceo, id)).status).toBe(200);
    s.gw.pay(orderId);
    await w.staff.req("/admin/jobs/payment.reconcile/run", post());
    const fee = Math.round(DEPOSIT_TOTAL * 0.0195 * 1.18);
    expect(await s.ledger(id)).toEqual([["deposit_received", DEPOSIT_TOTAL], ["deposit_refunded", DEPOSIT_TOTAL - fee], ["deposit_gateway_fee_retained", fee]]);
  });
});

describe("after the role is live", () => {
  let s: S; let w: World;
  beforeAll(async () => { s = await setup(); w = s.w; });

  it("a hire raises the fee with GST, applies the deposit and asks for the balance", async () => {
    const a = await w.candidate("asha", 80);
    const { id, match } = await s.paidShortlist("Founding engineer", [a]);
    await w.hire(match[a.email]!, "2026-12-01");
    // 10% of ₹14L = ₹1,40,000 + 18% GST = ₹1,65,200; less the ₹17,700 deposit = ₹1,47,500.
    const p = await s.payments(id);
    expect(p.balances).toMatchObject({ feeDue: 16_520_000, depositApplied: DEPOSIT_TOTAL, depositHeld: 0, feeOutstanding: 14_750_000 });
    expect(p.canPayFee).toBe(true);
    const mail = s.emailsTo("ceo@lab0.ai").find((m) => m.subject.startsWith("Success fee for Founding engineer"))!;
    expect(mail.text).toContain("₹1,47,500.00");
    expect(mail.text).toContain("60-day replacement guarantee");
    expect(mail.attachments?.[0]?.content.subarray(0, 4).toString()).toBe("%PDF");
    // Paying the balance through the gateway settles it.
    const { orderId } = (await body(await s.checkout(id, "fee", false))).checkout;
    expect((await body(await s.checkout(id, "fee", false))).checkout).toMatchObject({ orderId, total: 14_750_000 });
    await w.ceo.req(`/roles/${id}/payments/orders/${orderId}/fake-pay`, post({}));
    expect((await s.payments(id)).balances).toMatchObject({ feePaid: 14_750_000, feeOutstanding: 0 });
    expect(s.emailsTo("ceo@lab0.ai").some((m) => m.subject === "Payment received: Founding engineer")).toBe(true);
    expect((await s.checkout(id, "fee", false)).status).toBe(409);
  });

  it("a hire who does not join puts the deposit back on hold and voids the fee", async () => {
    const b = await w.candidate("bala", 80);
    const { id, match } = await s.paidShortlist("Product engineer", [b]);
    await w.hire(match[b.email]!, "2026-12-01");
    expect((await w.act(match[b.email]!, { stage: "did_not_join" })).status).toBe(200);
    const p = await s.payments(id);
    expect(p.balances).toMatchObject({ depositHeld: DEPOSIT_TOTAL, depositApplied: 0, feeDue: 0, feeOutstanding: 0 });
    expect((await w.row(id)).status).toBe("shortlist_ready");
  });

  it("no hire 30 days after the shortlist: the deposit is refunded on its own, less gateway charges, and the role closes", async () => {
    const c = await w.candidate("chitra", 70);
    const { id } = await s.paidShortlist("Infra engineer", [c]);
    w.t.clock.advance(31 * DAY);
    await w.runJob("role.dark_check");
    const fee = Math.round(DEPOSIT_TOTAL * 0.0195 * 1.18);
    expect(await s.ledger(id)).toEqual([["deposit_received", DEPOSIT_TOTAL], ["deposit_refunded", DEPOSIT_TOTAL - fee], ["deposit_gateway_fee_retained", fee]]);
    expect((await w.row(id)).status).toBe("closed");
    const cn = (await w.t.db.select().from(schema.invoice).where(eq(schema.invoice.roleId, id))).find((i) => i.kind === "credit_note")!;
    expect(cn.total).toBe(DEPOSIT_TOTAL - fee);
    expect(cn.number).toMatch(/^NT\/CN\//);
    expect(s.emailsTo("ceo@lab0.ai").find((m) => m.subject === "Deposit refunded: Infra engineer")?.text).toContain("less payment gateway charges");
  });
});

describe("finance settles by hand", () => {
  let s: S; let w: World;
  beforeAll(async () => { s = await setup(); w = s.w; });

  it("a role withdrawn while live keeps its deposit until finance decide, and only finance can refund it", async () => {
    const id = await w.roleAt("deposit_pending", "Designer");
    await s.pay(id);
    expect((await w.withdraw(w.ceo, id)).status).toBe(200);
    expect(await s.ledger(id)).toEqual([["deposit_received", DEPOSIT_TOTAL]]);
    const overview = await body(await s.finance.req("/admin/payments"));
    expect(overview.decisions.some((d: any) => d.refId === id)).toBe(true);
    // Staff without finance access, and the company, are refused.
    expect((await w.staff.req(`/admin/payments/roles/${id}/settlements`, post({ kind: "refund", reason: "Client asked." }))).status).toBe(403);
    expect((await w.ceo.req(`/admin/payments/roles/${id}/settlements`, post({ kind: "refund", reason: "Client asked." }))).status).toBe(403);
    // Finance refunds the whole deposit without deducting charges.
    const res = await s.finance.req(`/admin/payments/roles/${id}/settlements`, post({ kind: "refund", deductGatewayFee: false, reason: "Goodwill: client asked early." }));
    const json = await body(res);
    expect(res.status, JSON.stringify(json)).toBe(201);
    expect(json.settlement).toMatchObject({ status: "succeeded", gatewayFee: 0, amount: DEPOSIT_TOTAL });
    expect(await s.ledger(id)).toEqual([["deposit_received", DEPOSIT_TOTAL], ["deposit_refunded", DEPOSIT_TOTAL]]);
    // Nothing is left to refund.
    expect((await s.finance.req(`/admin/payments/roles/${id}/settlements`, post({ kind: "refund", reason: "Again." }))).status).toBe(409);
    const audit = await w.t.db.select().from(schema.staffAction).where(eq(schema.staffAction.refId, id));
    expect(audit.map((a) => a.action)).toContain("deposit.refund.request");
  });

  it("a forfeit can be queued from SQL and is carried out by the sweep", async () => {
    const id = await w.roleAt("deposit_pending", "Writer");
    await s.pay(id);
    await w.withdraw(w.ceo, id);
    await w.t.db.execute(sql`select zenhyre2.request_deposit_settlement(${id}::uuid, 'forfeit', null, 'Company went dark after the shortlist', 'cfo@novaretalent.com')`);
    await expect(w.t.db.execute(sql`select zenhyre2.request_deposit_settlement(${id}::uuid, 'refund', 1, 'More than held', 'cfo@novaretalent.com')`)).rejects.toThrow(/available/);
    expect((await s.finance.req("/admin/payments/reconcile", post())).status).toBe(200);
    expect(await s.ledger(id)).toEqual([["deposit_received", DEPOSIT_TOTAL], ["deposit_forfeited", DEPOSIT_TOTAL]]);
    expect(s.emailsTo("ceo@lab0.ai").some((m) => m.subject === "Deposit forfeited: Writer")).toBe(true);
  });

  it("a refund the gateway leaves pending completes on its webhook; a failed one can be retried", async () => {
    const id = await w.roleAt("deposit_pending", "Recruiter");
    const orderId = await s.pay(id);
    await w.withdraw(w.ceo, id);
    s.gw.refundMode = "pending";
    const pending = (await body(await s.finance.req(`/admin/payments/roles/${id}/settlements`, post({ kind: "refund", amount: 500_000, deductGatewayFee: false, reason: "Part refund." })))).settlement;
    expect(pending.status).toBe("processing");
    s.gw.settleRefund(orderId, pending.id, "succeeded");
    const raw = JSON.stringify({ type: "REFUND_STATUS_WEBHOOK", data: { refund: { order_id: orderId, refund_id: pending.id, cf_refund_id: "cfr_x", refund_status: "SUCCESS" } } });
    const { timestamp, signature } = s.gw.sign(raw);
    await w.t.app.request("/webhooks/cashfree", { method: "POST", body: raw, headers: { "x-webhook-timestamp": timestamp, "x-webhook-signature": signature } });
    expect((await s.payments(id)).balances).toMatchObject({ depositRefunded: 500_000, depositHeld: DEPOSIT_TOTAL - 500_000 });

    s.gw.refundMode = "fail";
    const failed = (await body(await s.finance.req(`/admin/payments/roles/${id}/settlements`, post({ kind: "refund", amount: 100_000, deductGatewayFee: false, reason: "Second part." })))).settlement;
    expect(failed.status).toBe("failed");
    expect((await s.payments(id)).balances.depositAvailable).toBe(DEPOSIT_TOTAL - 500_000);
    s.gw.refundMode = "succeed";
    const retried = (await body(await s.finance.req(`/admin/payments/settlements/${failed.id}/retry`, post()))).settlement;
    expect(retried).toMatchObject({ status: "succeeded", amount: 100_000 });
  });

  it("the ledger cannot be edited", async () => {
    await expect(w.t.db.execute(sql`update zenhyre2.ledger_entry set amount = 1`)).rejects.toThrow(/append-only/);
  });
});
