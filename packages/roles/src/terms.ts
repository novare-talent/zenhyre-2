// §7 fee terms and §9.1 deposit pricing. Pure; every number comes from config.
import type { FeeTerms } from "@zenhyre/db/schema";
import { Invalid, percentOf, type Paise } from "@zenhyre/shared";
import type { RoleType } from "./service";

/** From config: `fee.intern_flat`, `fee.percent_default`, `fee.percent_senior`, `fee.senior_years`, `fee.replacement_days`. */
export interface FeeConfig { internFlat: Paise; percentDefault: number; percentSenior: number; seniorYears: number; replacementDays: number }

/** Prefilled on gate acceptance: flat for interns; a percent of CTC otherwise, stepping up at `seniorYears`. */
export function prefillFeeTerms(type: RoleType, yearsExpMin: number, cfg: FeeConfig): FeeTerms {
  if (type === "intern") return { kind: "flat", amount: cfg.internFlat, replacement_guarantee_days: cfg.replacementDays };
  const rate = yearsExpMin >= cfg.seniorYears ? cfg.percentSenior : cfg.percentDefault;
  return { kind: "percent", amount: rate, replacement_guarantee_days: cfg.replacementDays };
}

export function feeFor(terms: FeeTerms, hiredCtc: Paise): Paise {
  return terms.kind === "flat" ? terms.amount : percentOf(hiredCtc, terms.amount);
}

export function assertValidFeeTerms(t: FeeTerms): void {
  if (t.kind !== "flat" && t.kind !== "percent") throw new Invalid("fee terms: kind must be flat or percent");
  if (typeof t.amount !== "number" || !Number.isFinite(t.amount) || t.amount < 0) throw new Invalid("fee terms: amount must be zero or more");
  if (t.kind === "flat" && !Number.isInteger(t.amount)) throw new Invalid("fee terms: a flat fee is a whole number of paise");
  if (t.kind === "percent" && t.amount > 1) throw new Invalid("fee terms: a percent fee is a fraction, 0.10 for 10%");
  if (!Number.isInteger(t.replacement_guarantee_days) || t.replacement_guarantee_days < 0) throw new Invalid("fee terms: replacement guarantee must be a whole number of days");
}

export interface DepositTier { max_campuses: number; amount: Paise }

/** By number of campuses selected (`deposit.tiers`), times `deposit.probation_multiplier` when the company is on probation. */
export function depositFor(tiers: readonly DepositTier[], campusCount: number, multiplier = 1): Paise {
  if (campusCount <= 0 || tiers.length === 0) return 0;
  const sorted = [...tiers].sort((a, b) => a.max_campuses - b.max_campuses);
  const tier = sorted.find((t) => campusCount <= t.max_campuses) ?? sorted[sorted.length - 1]!;
  return Math.round(tier.amount * multiplier);
}

export interface CtcSlab { ctc_from: Paise; ctc_to: Paise | null; amount: Paise }

/**
 * The deposit for a role by the most it offers (`ctc_max`, annual paise): the slab with `ctc_from ≤ ctc < ctc_to`
 * (`ctc_to` null = no ceiling), times the probation multiplier. Before GST. A CTC below every slab takes the lowest;
 * a role with no CTC cannot be priced and returns null (staff set `deposit_amount` by hand).
 */
export function depositForCtc(slabs: readonly CtcSlab[], ctc: Paise | null | undefined, multiplier = 1): Paise | null {
  if (ctc == null || ctc <= 0 || slabs.length === 0) return null;
  const sorted = [...slabs].sort((a, b) => a.ctc_from - b.ctc_from);
  const slab = sorted.find((s) => ctc >= s.ctc_from && (s.ctc_to === null || ctc < s.ctc_to))
    ?? (ctc < sorted[0]!.ctc_from ? sorted[0]! : sorted[sorted.length - 1]!);
  return Math.round(slab.amount * multiplier);
}
