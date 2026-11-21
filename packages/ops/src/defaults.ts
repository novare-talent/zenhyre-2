import { z } from "zod";

const tier = z.object({ max_campuses: z.number().int().positive(), amount: z.number().int().positive() });
const ctcSlab = z.object({ ctc_from: z.number().int().nonnegative(), ctc_to: z.number().int().positive().nullable(), amount: z.number().int().positive() });
const LPA = 100_000 * 100;
/** A CTC band in lakhs per annum and a deposit in rupees, stored as paise. */
const slab = (fromLpa: number, toLpa: number | null, rupees: number) => ({ ctc_from: fromLpa * LPA, ctc_to: toLpa === null ? null : toLpa * LPA, amount: rupees * 100 });
const supplier = z.object({
  legalName: z.string(), gstin: z.string(), address: z.string(), state: z.string(), stateCode: z.string().regex(/^\d{2}$/), email: z.string(), sac: z.string() });

export const CONFIG = {
  "deposit.tiers": { schema: z.array(tier), default: [
    { max_campuses: 5, amount: 1500000 }, { max_campuses: 12, amount: 3000000 }, { max_campuses: 23, amount: 6000000 }] },
  // Deposit by the most the role offers (`ctc_max`, annual paise): the slab whose [ctc_from, ctc_to) holds it. `amount` is
  // before GST. Placeholder reference (₹1,000 per LPA, stepped) until Novare's slab sheet replaces it; staff edit it at /staff/config.
  "deposit.ctc_slabs": { schema: z.array(ctcSlab).min(1), default: [
    slab(0, 10, 5_000), slab(10, 15, 10_000), slab(15, 20, 15_000), slab(20, 30, 20_000), slab(30, 40, 30_000), slab(40, 50, 40_000),
    slab(50, 75, 50_000), slab(75, 100, 75_000), slab(100, 150, 100_000), slab(150, 200, 150_000), slab(200, null, 200_000)] },
  "deposit.probation_multiplier": { schema: z.number().positive(), default: 2 },
  // A role that ends without a hire (no hire `deposit.dark_days` after its shortlist) has its deposit refunded on its own,
  // less the gateway's charges. Off: it waits in the finance console like every other settlement.
  "deposit.auto_refund_no_hire": { schema: z.boolean(), default: true },
  "gst.rate": { schema: z.number().min(0).max(1), default: 0.18 },
  // Cashfree's charge on a payment before its own GST, used when Cashfree has not reported the actual charge yet.
  "payment.gateway_fee_rate": { schema: z.number().min(0).max(0.1), default: 0.0195 },
  // Who issues the GST invoices. Fill in Novare's real GSTIN and address before going live.
  "invoice.supplier": { schema: supplier, default: {
    legalName: "Novare Talent Private Limited", gstin: "", address: "", state: "Maharashtra", stateCode: "27",
    email: "accounts@novaretalent.com", sac: "998512" } },
  "deposit.engaged_threshold": { schema: z.number().min(0).max(1), default: 0.5 },
  "deposit.dark_days": { schema: z.number().int().positive(), default: 30 },
  "deposit.refund_sla_days": { schema: z.number().int().positive(), default: 7 },
  "deposit.stuck_alert_hours": { schema: z.number().int().positive(), default: 24 },
  "fee.intern_flat": { schema: z.number().int().nonnegative(), default: 1250000 },
  "fee.percent_default": { schema: z.number().min(0).max(1), default: 0.10 },
  "fee.percent_senior": { schema: z.number().min(0).max(1), default: 0.20 },
  "fee.senior_years": { schema: z.number().int().nonnegative(), default: 10 },
  // The standing guarantee. Novare's sales rep changes it per role when a company negotiates one (staff fee-terms edit, before release).
  "fee.replacement_days": { schema: z.number().int().nonnegative(), default: 60 },
  "fee.due_days_after_join": { schema: z.number().int().positive(), default: 30 },
  "fee.reminder_days_before_due": { schema: z.number().int().positive(), default: 7 },
  "fee.join_grace_days": { schema: z.number().int().positive(), default: 7 },
  "fee.join_dispute_days": { schema: z.number().int().positive(), default: 3 },
  "gate.blocklist": { schema: z.array(z.string()), default: ["field sales", "bpo", "data entry", "unpaid"] },
  "gate.min_ctc": { schema: z.object({ intern: z.number().int(), fresher: z.number().int(), experienced: z.number().int() }),
    default: { intern: 24000000, fresher: 60000000, experienced: 100000000 } },
  "gate.accept_threshold": { schema: z.number().int(), default: 70 },
  "gate.reject_threshold": { schema: z.number().int(), default: 40 },
  "gate.terms_auto_release_hours": { schema: z.number().int().positive(), default: 48 },
  "gate.terms_timeout_days": { schema: z.number().int().positive(), default: 14 },
  "gate.appeal_window_days": { schema: z.number().int().positive(), default: 14 },
  "match.broadcast_days": { schema: z.number().int().positive(), default: 10 },
  "match.extension_days": { schema: z.number().int().positive(), default: 7 },
  "match.extension_min_applicants": { schema: z.number().int().positive(), default: 10 },
  "match.shortlist_cap": { schema: z.number().int().positive(), default: 25 },
  "match.nudge_cap": { schema: z.number().int().positive(), default: 150 },
  "match.rerank_pool": { schema: z.number().int().positive(), default: 200 },
  "trust.company.probation": { schema: z.number().int(), default: 70 },
  "trust.company.ban": { schema: z.number().int(), default: 40 },
  "trust.company.probation_lift": { schema: z.number().int(), default: 75 },
  "trust.company.lift_days": { schema: z.number().int(), default: 30 },
  "trust.candidate.restricted": { schema: z.number().int(), default: 60 },
  "trust.candidate.blocked": { schema: z.number().int(), default: 30 },
  "trust.candidate.restricted_lift": { schema: z.number().int(), default: 65 },
  "trust.candidate.blocked_lift": { schema: z.number().int(), default: 35 },
  "trust.decay_months": { schema: z.number().int().positive(), default: 12 },
  "trust.prompt_action_days": { schema: z.number().int().positive(), default: 7 },
  "trust.overdue_days": { schema: z.number().int().positive(), default: 30 },
  "trust.self_report_days": { schema: z.array(z.number().int()), default: [30, 90] },
  "trust.leakage_lookback_months": { schema: z.number().int().positive(), default: 12 },
  "trust.weights": { schema: z.record(z.string(), z.number().int()), default: {
    "company.hire_closed": 5, "company.fee_paid_on_time": 3, "company.shortlist_actioned_promptly": 2, "company.went_dark": -15,
    "company.fee_overdue": -15, "company.off_platform_hire": -40, "company.appeal_rejected": -10,
    "candidate.joined": 5, "candidate.self_report_answered": 1, "candidate.interview_no_show": -10, "candidate.offer_reneged": -25, "candidate.profile_false": -50 } },
  "identity.freemail_domains": { schema: z.array(z.string()),
    default: ["gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.in", "ymail.com", "outlook.com", "outlook.in", "hotmail.com", "live.com", "live.in", "msn.com",
      "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "pm.me", "rediffmail.com", "aol.com", "zoho.com", "zohomail.in", "gmx.com", "mail.com", "yandex.com"] },
  "identity.escape_hatch_days": { schema: z.number().int().positive(), default: 7 },
  "identity.max_verification_attempts": { schema: z.number().int().positive(), default: 2 },
  "identity.final_year_months_before_grad": { schema: z.number().int().positive(), default: 12 },
  "identity.grad_nudge_days": { schema: z.array(z.number().int()), default: [-60, 30] },
} as const;

export type ConfigKey = keyof typeof CONFIG;
export type ConfigValueOf<K extends ConfigKey> = z.infer<(typeof CONFIG)[K]["schema"]>;
