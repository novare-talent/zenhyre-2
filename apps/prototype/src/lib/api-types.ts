// What the API's seat routes return (services/api/src/routes/views.ts). Dates arrive as ISO strings.
import type { RejectionCategory, RoleStatus, RoleType, Stage } from "./rules";

export interface FeeTerms { kind: "flat" | "percent"; amount: number; replacement_guarantee_days: number; notes?: string }
export interface GateView { stage: "rules" | "model" | "human"; outcome: "accept" | "reject" | "needs_review"; reason: string; rule: string | null; decidedAt: string }

/** A role as its company sees it. */
export interface CompanyRoleView {
  id: string; companyId: string; title: string; jd: string; type: RoleType;
  ctcMin: number | null; ctcMax: number | null; yearsExpMin: number; yearsExpMax: number;
  locations: string[]; campusReach: string[]; status: RoleStatus;
  gate: GateView | null; appealed: boolean;
  feeTerms: FeeTerms | null; feeTermsReleasedAt: string | null; feeTermsAcceptedAt: string | null;
  depositAmount: number | null; depositMode: "razorpay" | "waived" | "cashfree" | null;
  broadcastOpensAt: string | null; broadcastClosesAt: string | null; shortlistReadyAt: string | null; shortlistCap: number;
  hiredMatchId: string | null; hiredAt: string | null; replacementOfRoleId: string | null;
  applicants: number; createdAt: string;
}

export interface ShortlistRowView {
  id: string; rank: number | null; stage: Stage; fitScore: number; fitReason: string; appliedAt: string | null;
  offeredCtc: number | null; hiredCtc: number | null; joinedOn: string | null;
  rejectionCategory: RejectionCategory | null; rejectionNote: string | null; joinConfirmedAt: string | null;
  candidate: null | {
    id: string; name: string | null; campus: { id: string; name: string; shortCode: string } | null; course: string; gradDate: string;
    status: "student" | "final_year" | "alumnus";
    profile: { headline: string | null; skills: string[]; yearsExperience: number | null; currentCompany: string | null; currentTitle: string | null;
      preferredRoles: string[]; preferredLocations: string[]; noticePeriodDays: number | null; linkedinUrl: string | null; cvUrl: string | null };
  };
}

/** A role as a candidate sees it on the board. */
export interface CandidateRoleView {
  id: string; title: string; jd: string; type: RoleType; ctcMin: number | null; ctcMax: number | null;
  yearsExpMin: number; yearsExpMax: number; locations: string[]; campusReach: string[];
  company: { id: string; name: string }; open: boolean; broadcastClosesAt: string | null; nudged: boolean;
  application: { id: string; stage: Stage; appliedAt: string } | null;
}

export interface ApplicationView {
  id: string; stage: Stage; appliedAt: string | null; updatedAt: string;
  rejectionCategory: RejectionCategory | null; joinedOn: string | null;
  joinPromptSentAt: string | null; joinConfirmedAt: string | null; canWithdraw: boolean;
  role: { id: string; title: string; type: RoleType; locations: string[]; ctcMin: number | null; ctcMax: number | null };
  company: { id: string; name: string };
}

// ---- payments (services/api/src/workflows/payments.ts). All money integer paise, GST shown separately. ----

export interface Billing { legalName: string; gstin: string | null; address: string; state: string; stateCode: string; phone: string; email: string }
export interface Balances {
  depositPaid: number; depositHeld: number; depositAvailable: number; settlementsPending: number;
  depositRefunded: number; depositForfeited: number; gatewayFeeRetained: number;
  feeDue: number; depositApplied: number; feePaid: number; feeOutstanding: number;
}
export type PaymentMode = "fake" | "sandbox" | "production";
export interface PaymentOrderView {
  orderId: string; purpose: "deposit" | "fee"; status: "active" | "paid" | "failed" | "expired" | "cancelled";
  taxable: number; gst: number; total: number; paidAt: string | null; cfPaymentId: string | null; paymentMethod: string | null; createdAt: string; expiresAt: string;
}
export interface SettlementView {
  id: string; kind: "refund" | "forfeit"; amount: number; gatewayFee: number; refunded: number;
  status: "requested" | "processing" | "succeeded" | "failed" | "cancelled"; requestedAt: string; succeededAt: string | null;
}
export interface InvoiceView { id: string; number: string; kind: "tax_invoice" | "credit_note"; total: number; issuedAt: string }
export interface RolePaymentsView {
  mode: PaymentMode; gstRate: number;
  deposit: { taxable: number; cgst: number; sgst: number; igst: number; gst: number; total: number; mode: CompanyRoleView["depositMode"] };
  balances: Balances; canPayDeposit: boolean; canPayFee: boolean; billing: Billing | null;
  orders: PaymentOrderView[]; settlements: SettlementView[]; invoices: InvoiceView[];
}
export interface CheckoutView { orderId: string; paymentSessionId: string | null; mode: PaymentMode; purpose: "deposit" | "fee"; taxable: number; gst: number; total: number; expiresAt: string }

/** Finance console. */
export interface FinanceSettlement extends Omit<SettlementView, "refunded"> {
  roleId: string; paymentOrderId: string; deductGatewayFee: boolean; reason: string; source: string; requestedBy: string;
  cfRefundId: string | null; failureReason: string | null; attempts: number; processedAt: string | null;
}
export interface FinanceReview { id: string; kind: string; refType: string; refId: string; payload: Record<string, unknown>; openedAt: string }
export interface FinanceOverview {
  roles: Array<{ roleId: string; title: string; status: string; depositMode: string | null; companyName: string } & Balances>;
  settlements: FinanceSettlement[]; decisions: FinanceReview[]; alerts: FinanceReview[]; mode: PaymentMode;
}
export interface LedgerEntryView { id: string; type: string; amount: number; tax: number; note: string | null; externalRef: string | null; createdAt: string; createdBy: string }
export interface FinanceRoleView {
  role: { id: string; title: string; status: string; depositMode: string | null; depositAmount: number | null; hiredMatchId: string | null; companyId: string; companyName: string };
  summary: RolePaymentsView; entries: LedgerEntryView[]; settlements: FinanceSettlement[];
}

/** GST state codes for the billing form (mirrors packages/ledger/src/gst.ts). */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
  "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland",
  "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
};
