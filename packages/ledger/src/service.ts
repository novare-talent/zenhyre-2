import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";
import type { BillingDetails, InvoiceLine, SupplierDetails } from "@zenhyre/db/schema";
import { Clock, DomainError, Invalid, NotFound, type Paise } from "@zenhyre/shared";
import { financialYear } from "./gst";

export type PaymentOrder = typeof schema.paymentOrder.$inferSelect;
export type Settlement = typeof schema.depositSettlement.$inferSelect;
export type LedgerEntry = typeof schema.ledgerEntry.$inferSelect;
export type Invoice = typeof schema.invoice.$inferSelect;
export type LedgerType = LedgerEntry["type"];
export type Purpose = PaymentOrder["purpose"];

export interface Balances {
  /** Deposit money Novare holds for the role: received and re-held, less refunded, retained, forfeited and applied. */
  depositPaid: Paise; depositHeld: Paise;
  /** Held less settlements already requested or in flight: what a new settlement may take. */
  depositAvailable: Paise; settlementsPending: Paise;
  depositRefunded: Paise; depositForfeited: Paise; gatewayFeeRetained: Paise;
  /** Fee raised on the hire (GST included), less voided. */
  feeDue: Paise; depositApplied: Paise; feePaid: Paise;
  /** What the company still owes on the fee. */
  feeOutstanding: Paise;
}

const PENDING: Settlement["status"][] = ["requested", "processing"];

function balancesOf(rows: Array<{ type: LedgerType; amount: number }>, pending: number): Balances {
  const s: Record<LedgerType, number> = {
    deposit_received: 0, deposit_refunded: 0, deposit_gateway_fee_retained: 0, deposit_forfeited: 0,
    deposit_applied_to_fee: 0, deposit_application_reversed: 0, fee_due: 0, fee_paid: 0, fee_voided: 0 };
  for (const r of rows) s[r.type] += Number(r.amount);
  const applied = s.deposit_applied_to_fee - s.deposit_application_reversed;
  const held = s.deposit_received - s.deposit_refunded - s.deposit_gateway_fee_retained - s.deposit_forfeited - applied;
  const feeDue = s.fee_due - s.fee_voided;
  return {
    depositPaid: s.deposit_received, depositHeld: held, depositAvailable: held - pending, settlementsPending: pending,
    depositRefunded: s.deposit_refunded, depositForfeited: s.deposit_forfeited, gatewayFeeRetained: s.deposit_gateway_fee_retained,
    feeDue, depositApplied: applied, feePaid: s.fee_paid, feeOutstanding: feeDue - applied - s.fee_paid,
  };
}

function buildLedger(db: DbOrTx, clock: Clock) {
  async function balances(roleId: string): Promise<Balances> {
    const rows = await db.select({ type: schema.ledgerEntry.type, amount: schema.ledgerEntry.amount })
      .from(schema.ledgerEntry).where(eq(schema.ledgerEntry.roleId, roleId));
    const [p] = await db.select({ n: sql<string>`coalesce(sum(${schema.depositSettlement.amount}), 0)` }).from(schema.depositSettlement)
      .where(and(eq(schema.depositSettlement.roleId, roleId), inArray(schema.depositSettlement.status, PENDING)));
    return balancesOf(rows, Number(p?.n ?? 0));
  }

  return {
    balances,

    // ---- billing ----
    async billing(companyId: string): Promise<BillingDetails | null> {
      const [row] = await db.select().from(schema.companyBilling).where(eq(schema.companyBilling.companyId, companyId));
      if (!row) return null;
      return { legalName: row.legalName, gstin: row.gstin, address: row.address, state: row.state, stateCode: row.stateCode, phone: row.phone, email: row.email };
    },
    async saveBilling(companyId: string, b: BillingDetails, userId: string | null) {
      const values = { ...b, companyId, updatedBy: userId, updatedAt: clock.now() };
      await db.insert(schema.companyBilling).values(values).onConflictDoUpdate({ target: schema.companyBilling.companyId, set: values });
    },

    // ---- orders ----
    async insertOrder(o: typeof schema.paymentOrder.$inferInsert): Promise<PaymentOrder> {
      const [row] = await db.insert(schema.paymentOrder).values({ ...o, createdAt: clock.now(), updatedAt: clock.now() }).returning();
      return row!;
    },
    async order(orderId: string): Promise<PaymentOrder | null> {
      const [row] = await db.select().from(schema.paymentOrder).where(eq(schema.paymentOrder.orderId, orderId));
      return row ?? null;
    },
    async orderById(id: string): Promise<PaymentOrder | null> {
      const [row] = await db.select().from(schema.paymentOrder).where(eq(schema.paymentOrder.id, id));
      return row ?? null;
    },
    /** Locks the order row for the rest of the transaction. */
    async lockOrder(orderId: string): Promise<PaymentOrder> {
      const [row] = await db.select().from(schema.paymentOrder).where(eq(schema.paymentOrder.orderId, orderId)).for("update");
      if (!row) throw new NotFound(`payment order ${orderId}`);
      return row;
    },
    async activeOrder(roleId: string, purpose: Purpose): Promise<PaymentOrder | null> {
      const [row] = await db.select().from(schema.paymentOrder)
        .where(and(eq(schema.paymentOrder.roleId, roleId), eq(schema.paymentOrder.purpose, purpose), eq(schema.paymentOrder.status, "active")));
      return row ?? null;
    },
    async paidDepositOrder(roleId: string): Promise<PaymentOrder | null> {
      const [row] = await db.select().from(schema.paymentOrder)
        .where(and(eq(schema.paymentOrder.roleId, roleId), eq(schema.paymentOrder.purpose, "deposit"), eq(schema.paymentOrder.status, "paid")))
        .orderBy(desc(schema.paymentOrder.paidAt)).limit(1);
      return row ?? null;
    },
    async orders(roleId: string): Promise<PaymentOrder[]> {
      return db.select().from(schema.paymentOrder).where(eq(schema.paymentOrder.roleId, roleId)).orderBy(asc(schema.paymentOrder.createdAt));
    },
    async ordersCount(roleId: string, purpose: Purpose): Promise<number> {
      const [r] = await db.select({ n: sql<string>`count(*)` }).from(schema.paymentOrder)
        .where(and(eq(schema.paymentOrder.roleId, roleId), eq(schema.paymentOrder.purpose, purpose)));
      return Number(r?.n ?? 0);
    },
    /**
     * Orders to check with the gateway: active ones created before `before`, and ones cancelled on our side in the last
     * two days (the company may still have paid the gateway's page, which must then be refunded).
     */
    async staleActiveOrders(before: Date): Promise<PaymentOrder[]> {
      const since = new Date(clock.now().getTime() - 2 * 24 * 60 * 60 * 1000);
      return db.select().from(schema.paymentOrder)
        .where(sql`(${schema.paymentOrder.status} = 'active' and ${schema.paymentOrder.createdAt} < ${before.toISOString()})
          or (${schema.paymentOrder.status} = 'cancelled' and ${schema.paymentOrder.updatedAt} > ${since.toISOString()})`)
        .orderBy(asc(schema.paymentOrder.createdAt)).limit(200);
    },
    async updateOrder(id: string, patch: Partial<typeof schema.paymentOrder.$inferInsert>): Promise<PaymentOrder> {
      const [row] = await db.update(schema.paymentOrder).set({ ...patch, updatedAt: clock.now() }).where(eq(schema.paymentOrder.id, id)).returning();
      return row!;
    },

    // ---- ledger ----
    /**
     * Appends one entry and re-checks the role's invariants in the same transaction: nothing held or owed may go
     * negative, and money in flight may not exceed what is held. The caller holds the role's lock. A repeat with the
     * same (type, external_ref) is a no-op and returns null, which makes webhook replays harmless.
     */
    async record(e: { type: LedgerType; roleId: string; amount: Paise; tax?: Paise; matchId?: string | null;
      paymentOrderId?: string | null; settlementId?: string | null; externalRef?: string | null; note?: string | null; createdBy: string }): Promise<LedgerEntry | null> {
      if (!Number.isInteger(e.amount) || e.amount <= 0) throw new Invalid(`ledger: ${e.type} needs a positive whole amount of paise`);
      const [row] = await db.insert(schema.ledgerEntry).values({ ...e, tax: e.tax ?? 0, createdAt: clock.now() })
        .onConflictDoNothing().returning();
      if (!row) return null;
      const b = await balances(e.roleId);
      if (b.depositHeld < 0) throw new DomainError("ledger_invariant", `ledger: the deposit held on role ${e.roleId} would go below zero`, 409);
      if (b.depositAvailable < 0) throw new DomainError("ledger_invariant", `ledger: settlements in flight exceed the deposit held on role ${e.roleId}`, 409);
      if (b.feeOutstanding < 0 && e.type !== "fee_voided" && e.type !== "deposit_application_reversed")
        throw new DomainError("ledger_invariant", `ledger: more was paid or applied than the fee due on role ${e.roleId}`, 409);
      return row;
    },
    async entries(roleId: string): Promise<LedgerEntry[]> {
      return db.select().from(schema.ledgerEntry).where(eq(schema.ledgerEntry.roleId, roleId)).orderBy(asc(schema.ledgerEntry.createdAt));
    },

    // ---- settlements ----
    /** Queues a settlement. The caller holds the role's lock; the amount may not exceed what is available. */
    async requestSettlement(s: { roleId: string; paymentOrderId: string; kind: Settlement["kind"]; amount: Paise; deductGatewayFee: boolean;
      reason: string; source: string; requestedBy: string }): Promise<Settlement> {
      if (!s.reason.trim()) throw new Invalid("a settlement needs a reason");
      const b = await balances(s.roleId);
      if (b.depositAvailable <= 0) throw new DomainError("not_available", "Nothing of this deposit is left to settle.", 409);
      if (!Number.isInteger(s.amount) || s.amount <= 0) throw new Invalid("a settlement needs a positive whole amount of paise");
      if (s.amount > b.depositAvailable) throw new DomainError("not_available", `Only ₹${(b.depositAvailable / 100).toFixed(2)} of the deposit is available to settle.`, 409);
      const [row] = await db.insert(schema.depositSettlement).values({
        ...s, deductGatewayFee: s.kind === "refund" && s.deductGatewayFee, requestedAt: clock.now() }).returning();
      return row!;
    },
    async settlement(id: string): Promise<Settlement | null> {
      const [row] = await db.select().from(schema.depositSettlement).where(eq(schema.depositSettlement.id, id));
      return row ?? null;
    },
    /** Takes the settlement for processing if it is still in `status`; null if another worker has it or it moved on. */
    async claimSettlement(id: string, status: Settlement["status"]): Promise<Settlement | null> {
      const rows = await db.execute<{ id: string }>(sql`select id from deposit_settlement where id = ${id} and status = ${status} for update skip locked`);
      if (!rows.length) return null;
      const [row] = await db.select().from(schema.depositSettlement).where(eq(schema.depositSettlement.id, id));
      return row ?? null;
    },
    async updateSettlement(id: string, patch: Partial<typeof schema.depositSettlement.$inferInsert>): Promise<Settlement> {
      const [row] = await db.update(schema.depositSettlement).set(patch).where(eq(schema.depositSettlement.id, id)).returning();
      return row!;
    },
    async settlements(filter: { roleId?: string; status?: Settlement["status"][] } = {}): Promise<Settlement[]> {
      const conds = [];
      if (filter.roleId) conds.push(eq(schema.depositSettlement.roleId, filter.roleId));
      if (filter.status) conds.push(inArray(schema.depositSettlement.status, filter.status));
      return db.select().from(schema.depositSettlement).where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(schema.depositSettlement.requestedAt)).limit(500);
    },

    // ---- invoices ----
    /** Issues the next number in the series for the current financial year and stores the invoice. */
    async issueInvoice(i: { kind: Invoice["kind"]; roleId: string; paymentOrderId?: string | null; settlementId?: string | null;
      lines: InvoiceLine[]; taxable: Paise; cgst: Paise; sgst: Paise; igst: Paise; total: Paise; billing: BillingDetails; supplier: SupplierDetails }): Promise<Invoice> {
      const now = clock.now();
      const series = `${i.kind === "credit_note" ? "CN" : "INV"}/${financialYear(now)}`;
      const [c] = await db.insert(schema.invoiceCounter).values({ series, last: 1 })
        .onConflictDoUpdate({ target: schema.invoiceCounter.series, set: { last: sql`${schema.invoiceCounter.last} + 1` } }).returning();
      const number = `NT/${series}/${String(c!.last).padStart(5, "0")}`;
      const [row] = await db.insert(schema.invoice).values({ ...i, number, issuedAt: now }).returning();
      return row!;
    },
    async invoice(id: string): Promise<Invoice | null> {
      const [row] = await db.select().from(schema.invoice).where(eq(schema.invoice.id, id));
      return row ?? null;
    },
    async invoices(roleId: string): Promise<Invoice[]> {
      return db.select().from(schema.invoice).where(eq(schema.invoice.roleId, roleId)).orderBy(asc(schema.invoice.issuedAt));
    },
    async invoiceFor(by: { paymentOrderId?: string; settlementId?: string }): Promise<Invoice | null> {
      const cond = by.settlementId ? eq(schema.invoice.settlementId, by.settlementId) : eq(schema.invoice.paymentOrderId, by.paymentOrderId!);
      const [row] = await db.select().from(schema.invoice).where(cond).limit(1);
      return row ?? null;
    },

    // ---- webhooks ----
    /** Stores a webhook; false if this exact event was stored before. */
    async storeWebhook(e: { provider: string; eventType: string; dedupeKey: string; payload: Record<string, unknown> }): Promise<{ id: string } | null> {
      const [row] = await db.insert(schema.paymentWebhookEvent).values({ ...e, receivedAt: clock.now() }).onConflictDoNothing()
        .returning({ id: schema.paymentWebhookEvent.id });
      return row ?? null;
    },
    async markWebhook(id: string, error: string | null) {
      await db.update(schema.paymentWebhookEvent).set({ processedAt: clock.now(), error }).where(eq(schema.paymentWebhookEvent.id, id));
    },

    // ---- finance console ----
    /** Every role with money on it, newest activity first, with its balances. */
    async rolesWithMoney(): Promise<Array<{ roleId: string } & Balances>> {
      const rows = await db.execute<{ role_id: string }>(sql`
        select role_id from (
          select role_id, max(created_at) as at from payment_order group by role_id
          union all select role_id, max(created_at) from ledger_entry group by role_id
        ) x group by role_id order by max(at) desc limit 500`);
      const out = [];
      for (const r of rows) out.push({ roleId: r.role_id, ...(await balances(r.role_id)) });
      return out;
    },
  };
}

export type Ledger = ReturnType<typeof buildLedger> & { withDb(tx: DbOrTx): Ledger };
export function createLedger(db: DbOrTx, deps: { clock: Clock }): Ledger {
  return { ...buildLedger(db, deps.clock), withDb: (tx) => createLedger(tx, deps) };
}
