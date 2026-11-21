import { uuid, text, timestamp, bigint, integer, boolean, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z2 } from "./_schema";
import { company } from "./identity";
import { role } from "./roles";

/**
 * Payments (docs/superpowers/plans/2026-11-21-cashfree-deposits.md). Every amount is integer paise. `total` amounts
 * are what actually moved (taxable + GST); the ledger works in those gross amounts so balances match the bank.
 */
export const paymentPurpose = z2.enum("payment_purpose", ["deposit", "fee"]);
export const paymentOrderStatus = z2.enum("payment_order_status", ["active", "paid", "failed", "expired", "cancelled"]);
export const settlementKind = z2.enum("settlement_kind", ["refund", "forfeit"]);
export const settlementStatus = z2.enum("settlement_status", ["requested", "processing", "succeeded", "failed", "cancelled"]);
export const ledgerType = z2.enum("ledger_type", [
  "deposit_received", "deposit_refunded", "deposit_gateway_fee_retained", "deposit_forfeited",
  "deposit_applied_to_fee", "deposit_application_reversed", "fee_due", "fee_paid", "fee_voided"]);
export const invoiceKind = z2.enum("invoice_kind", ["tax_invoice", "credit_note"]);

export interface BillingDetails {
  legalName: string; gstin: string | null; address: string; state: string; stateCode: string; phone: string; email: string;
}

/** Who the company is on an invoice, and the phone Cashfree requires. Asked for at the first checkout. */
export const companyBilling = z2.table("company_billing", {
  companyId: uuid("company_id").primaryKey().references(() => company.id),
  legalName: text("legal_name").notNull(),
  gstin: text("gstin"),
  address: text("address").notNull(),
  state: text("state").notNull(),
  /** GST state code, two digits ("27" Maharashtra). Same as the supplier's → CGST + SGST, else IGST. */
  stateCode: text("state_code").notNull(),
  phone: text("phone").notNull(),
  email: text("email").notNull(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One checkout at Cashfree. A role may have several over time, but at most one active per purpose. */
export const paymentOrder = z2.table("payment_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Ours, sent to Cashfree as `order_id`; also the idempotency key there. */
  orderId: text("order_id").notNull().unique(),
  purpose: paymentPurpose("purpose").notNull(),
  roleId: uuid("role_id").notNull().references(() => role.id),
  companyId: uuid("company_id").notNull().references(() => company.id),
  matchId: uuid("match_id"),
  taxable: bigint("taxable", { mode: "number" }).notNull(),
  gst: bigint("gst", { mode: "number" }).notNull(),
  total: bigint("total", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("INR"),
  status: paymentOrderStatus("status").notNull().default("active"),
  provider: text("provider").notNull(),
  cfOrderId: text("cf_order_id"),
  paymentSessionId: text("payment_session_id"),
  cfPaymentId: text("cf_payment_id"),
  paymentMethod: text("payment_method"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  billing: jsonb("billing").$type<BillingDetails>().notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  raw: jsonb("raw").$type<Record<string, unknown>>(),
}, (t) => [
  index("payment_order_role_idx").on(t.roleId),
  uniqueIndex("payment_order_active_uq").on(t.roleId, t.purpose).where(sql`status = 'active'`),
  uniqueIndex("payment_order_cf_payment_uq").on(t.cfPaymentId),
  check("payment_order_total_ck", sql`total > 0 and total = taxable + gst`),
]);

/**
 * The one way money leaves a held deposit. Rules, the finance console and `request_deposit_settlement()` in SQL all
 * insert a `requested` row; the API's settlement worker carries it out. `amount` is how much of the held deposit this
 * settles; for a refund with `deduct_gateway_fee`, the company receives `amount − gateway_fee`.
 */
export const depositSettlement = z2.table("deposit_settlement", {
  id: uuid("id").primaryKey().defaultRandom(),
  roleId: uuid("role_id").notNull().references(() => role.id),
  paymentOrderId: uuid("payment_order_id").notNull().references(() => paymentOrder.id),
  kind: settlementKind("kind").notNull(),
  amount: bigint("amount", { mode: "number" }).notNull(),
  deductGatewayFee: boolean("deduct_gateway_fee").notNull().default(true),
  gatewayFee: bigint("gateway_fee", { mode: "number" }).notNull().default(0),
  reason: text("reason").notNull(),
  /** `rule:<name>`, `staff` or `db`. */
  source: text("source").notNull(),
  requestedBy: text("requested_by").notNull(),
  status: settlementStatus("status").notNull().default("requested"),
  cfRefundId: text("cf_refund_id"),
  failureReason: text("failure_reason"),
  attempts: integer("attempts").notNull().default(0),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  succeededAt: timestamp("succeeded_at", { withTimezone: true }),
}, (t) => [
  index("deposit_settlement_role_idx").on(t.roleId),
  index("deposit_settlement_status_idx").on(t.status),
  check("deposit_settlement_amount_ck", sql`amount > 0 and gateway_fee >= 0 and gateway_fee < amount`),
]);

/** Append-only (UPDATE and DELETE are revoked in the migration). Balances are sums over it. */
export const ledgerEntry = z2.table("ledger_entry", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: ledgerType("type").notNull(),
  roleId: uuid("role_id").notNull().references(() => role.id),
  companyId: uuid("company_id").notNull().references(() => company.id),
  matchId: uuid("match_id"),
  paymentOrderId: uuid("payment_order_id").references(() => paymentOrder.id),
  settlementId: uuid("settlement_id").references(() => depositSettlement.id),
  amount: bigint("amount", { mode: "number" }).notNull(),
  /** The GST inside `amount`, for invoices and reports. */
  tax: bigint("tax", { mode: "number" }).notNull().default(0),
  externalRef: text("external_ref"),
  note: text("note"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("ledger_entry_role_idx").on(t.roleId, t.type),
  uniqueIndex("ledger_entry_ref_uq").on(t.type, t.externalRef).where(sql`external_ref is not null`),
  check("ledger_entry_amount_ck", sql`amount > 0 and tax >= 0 and tax <= amount`),
]);

export interface InvoiceLine { description: string; sac: string; taxable: number }
export interface SupplierDetails { legalName: string; gstin: string; address: string; state: string; stateCode: string; email: string; sac: string }

/** A GST tax invoice for every payment, and a credit note for every refund. Numbered per series and financial year. */
export const invoice = z2.table("invoice", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull().unique(),
  kind: invoiceKind("kind").notNull(),
  roleId: uuid("role_id").notNull().references(() => role.id),
  companyId: uuid("company_id").notNull().references(() => company.id),
  paymentOrderId: uuid("payment_order_id").references(() => paymentOrder.id),
  settlementId: uuid("settlement_id").references(() => depositSettlement.id),
  lines: jsonb("lines").$type<InvoiceLine[]>().notNull(),
  taxable: bigint("taxable", { mode: "number" }).notNull(),
  cgst: bigint("cgst", { mode: "number" }).notNull().default(0),
  sgst: bigint("sgst", { mode: "number" }).notNull().default(0),
  igst: bigint("igst", { mode: "number" }).notNull().default(0),
  total: bigint("total", { mode: "number" }).notNull(),
  billing: jsonb("billing").$type<BillingDetails>().notNull(),
  supplier: jsonb("supplier").$type<SupplierDetails>().notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("invoice_role_idx").on(t.roleId),
  uniqueIndex("invoice_order_kind_uq").on(t.paymentOrderId, t.kind).where(sql`settlement_id is null`),
  uniqueIndex("invoice_settlement_uq").on(t.settlementId),
]);

/** Gap-free numbering: `INV/2026-27` → last number issued in that series. */
export const invoiceCounter = z2.table("invoice_counter", {
  series: text("series").primaryKey(),
  last: integer("last").notNull().default(0),
});

/** Every gateway webhook as received. `dedupe_key` makes a replay a no-op. */
export const paymentWebhookEvent = z2.table("payment_webhook_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  eventType: text("event_type").notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
});
