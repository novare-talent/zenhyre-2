import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { addGst, splitGross, estimateGatewayFee, financialYear, GSTIN_RE, cashfreeGateway, fakeGateway } from "../src/index";

describe("GST", () => {
  it("adds 18% on top, split CGST/SGST within the supplier's state and IGST across states", () => {
    expect(addGst(1_500_000, 0.18, "27", "27")).toEqual({ taxable: 1_500_000, cgst: 135_000, sgst: 135_000, igst: 0, gst: 270_000, total: 1_770_000 });
    expect(addGst(1_500_000, 0.18, "27", "29")).toEqual({ taxable: 1_500_000, cgst: 0, sgst: 0, igst: 270_000, gst: 270_000, total: 1_770_000 });
    // An odd paisa of GST goes to SGST, so the halves always add up.
    const odd = addGst(5, 0.18, "27", "27");
    expect(odd.cgst + odd.sgst).toBe(odd.gst);
  });
  it("splits a gross amount back into taxable value and GST", () => {
    expect(splitGross(1_770_000, 0.18, "27", "07")).toMatchObject({ taxable: 1_500_000, igst: 270_000, total: 1_770_000 });
    const s = splitGross(1_729_272, 0.18, "27", "27");
    expect(s.taxable + s.cgst + s.sgst).toBe(1_729_272);
  });
  it("estimates the gateway's charge with GST on it", () => {
    expect(estimateGatewayFee(1_770_000, 0.0195, 0.18)).toBe(40_728);
  });
  it("labels Indian financial years April to March", () => {
    expect(financialYear(new Date("2026-11-21T00:00:00Z"))).toBe("2026-27");
    expect(financialYear(new Date("2027-03-31T12:00:00Z"))).toBe("2026-27");
    expect(financialYear(new Date("2027-04-01T00:00:00Z"))).toBe("2027-28");
  });
  it("checks GSTIN format", () => {
    expect(GSTIN_RE.test("27AAACL1234A1Z5")).toBe(true);
    expect(GSTIN_RE.test("27AAACL1234A1X5")).toBe(false);
  });
});

describe("Cashfree adapter", () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const reply = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  const fetchStub = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/orders")) return reply(200, { cf_order_id: 123, order_id: "dep_1", payment_session_id: "session_abc", order_status: "ACTIVE" });
    if (url.endsWith("/orders/dep_1")) return reply(200, { order_status: "PAID" });
    if (url.endsWith("/orders/dep_1/payments")) return reply(200, [{ cf_payment_id: 99, payment_status: "SUCCESS", payment_amount: 17700, payment_group: "upi", payment_time: "2026-11-21T10:00:00+05:30" }]);
    if (url.endsWith("/refunds/r1")) return reply(404, { message: "refund not found" });
    if (url.endsWith("/refunds")) return reply(200, { cf_refund_id: 7, refund_id: "r1", refund_status: "PENDING" });
    return reply(500, { message: "unexpected" });
  }) as unknown as typeof fetch;
  const cf = cashfreeGateway({ env: "sandbox", appId: "app", secretKey: "secret", apiVersion: "2026-01-01", fetch: fetchStub });

  it("creates orders in rupees with the auth and version headers", async () => {
    const out = await cf.createOrder({ orderId: "dep_1", amount: 1_770_000, note: "Deposit", returnUrl: "https://app/r", notifyUrl: "https://api/webhooks/cashfree",
      expiresAt: new Date("2026-11-21T11:00:00Z"), customer: { id: "c1", email: "a@b.co", phone: "9876543210", name: "Lab0" } });
    expect(out).toMatchObject({ cfOrderId: "123", paymentSessionId: "session_abc" });
    const { url, init } = calls[0]!;
    expect(url).toBe("https://sandbox.cashfree.com/pg/orders");
    expect(init.headers).toMatchObject({ "x-client-id": "app", "x-client-secret": "secret", "x-api-version": "2026-01-01" });
    expect(JSON.parse(String(init.body))).toMatchObject({ order_amount: 17700, order_currency: "INR", customer_details: { customer_phone: "9876543210" } });
  });
  it("reads a paid order and its payment, in paise", async () => {
    expect(await cf.getOrder("dep_1")).toMatchObject({ status: "paid", payment: { cfPaymentId: "99", amount: 1_770_000, method: "upi" } });
  });
  it("creates refunds and treats an unknown refund as null", async () => {
    expect(await cf.createRefund({ orderId: "dep_1", refundId: "r1", amount: 100_000, note: "n" })).toMatchObject({ cfRefundId: "7", status: "pending" });
    expect(await cf.getRefund("dep_1", "r1")).toBeNull();
  });
  it("verifies webhook signatures: base64 HMAC-SHA256 of timestamp + raw body", () => {
    const raw = '{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{"order":{"order_amount":170.00}}}';
    const sig = createHmac("sha256", "secret").update("1700000000000" + raw).digest("base64");
    expect(cf.verifyWebhook(raw, "1700000000000", sig)).toBe(true);
    expect(cf.verifyWebhook(raw.replace("170.00", "170"), "1700000000000", sig)).toBe(false);
    expect(cf.verifyWebhook(raw, "", sig)).toBe(false);
  });
});

describe("fake gateway", () => {
  it("never refunds more than was paid", async () => {
    const gw = fakeGateway();
    await gw.createOrder({ orderId: "o", amount: 1000, note: "", returnUrl: "", notifyUrl: "", expiresAt: new Date(), customer: { id: "c", email: "e", phone: "p", name: "n" } });
    await expect(gw.createRefund({ orderId: "o", refundId: "r", amount: 10, note: "" })).rejects.toThrow(/not paid/);
    gw.pay("o");
    expect((await gw.createRefund({ orderId: "o", refundId: "r", amount: 600, note: "" })).status).toBe("succeeded");
    expect((await gw.createRefund({ orderId: "o", refundId: "r", amount: 600, note: "" })).status).toBe("succeeded"); // idempotent
    await expect(gw.createRefund({ orderId: "o", refundId: "r2", amount: 600, note: "" })).rejects.toThrow(/exceeds/);
  });
});
