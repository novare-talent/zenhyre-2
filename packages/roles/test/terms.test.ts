import { describe, expect, it } from "vitest";
import { assertValidFeeTerms, depositFor, depositForCtc, feeFor, prefillFeeTerms, type FeeConfig } from "../src/index";

// Defaults from spec §17.
const fee: FeeConfig = { internFlat: 1_250_000, percentDefault: 0.10, percentSenior: 0.20, seniorYears: 10, replacementDays: 90 };
const tiers = [{ max_campuses: 5, amount: 1_500_000 }, { max_campuses: 12, amount: 3_000_000 }, { max_campuses: 23, amount: 6_000_000 }];
const L = (lakhs: number) => lakhs * 100_000 * 100;

describe("fee terms prefill (§7)", () => {
  it("interns: flat fee, whatever the experience", () => {
    expect(prefillFeeTerms("intern", 0, fee)).toEqual({ kind: "flat", amount: 1_250_000, replacement_guarantee_days: 90 });
    expect(prefillFeeTerms("intern", 12, fee).kind).toBe("flat");
  });
  it("freshers and experienced: 10% of CTC", () => {
    expect(prefillFeeTerms("fresher", 0, fee)).toEqual({ kind: "percent", amount: 0.10, replacement_guarantee_days: 90 });
    expect(prefillFeeTerms("experienced", 9.5, fee).amount).toBe(0.10);
  });
  it("steps to 20% at ten years, not gradually", () => {
    expect(prefillFeeTerms("experienced", 10, fee).amount).toBe(0.20);
    expect(prefillFeeTerms("experienced", 15, fee).amount).toBe(0.20);
  });
  it("reads every number from config", () => {
    const custom: FeeConfig = { internFlat: 1_000_000, percentDefault: 0.08, percentSenior: 0.15, seniorYears: 8, replacementDays: 60 };
    expect(prefillFeeTerms("intern", 0, custom)).toEqual({ kind: "flat", amount: 1_000_000, replacement_guarantee_days: 60 });
    expect(prefillFeeTerms("experienced", 8, custom).amount).toBe(0.15);
  });
  it("computes the fee from the terms and the hired CTC", () => {
    expect(feeFor(prefillFeeTerms("experienced", 4, fee), L(46))).toBe(46_000_000);
    expect(feeFor(prefillFeeTerms("intern", 0, fee), L(9))).toBe(1_250_000);
  });
  it("refuses malformed terms", () => {
    expect(() => assertValidFeeTerms({ kind: "percent", amount: 10, replacement_guarantee_days: 90 })).toThrow(/fraction/);
    expect(() => assertValidFeeTerms({ kind: "flat", amount: 12.5, replacement_guarantee_days: 90 })).toThrow(/paise/);
    expect(() => assertValidFeeTerms({ kind: "flat", amount: -1, replacement_guarantee_days: 90 })).toThrow(/zero or more/);
    expect(() => assertValidFeeTerms({ kind: "flat", amount: 0, replacement_guarantee_days: 1.5 })).toThrow(/days/);
    expect(() => assertValidFeeTerms({ kind: "bogus" as any, amount: 0, replacement_guarantee_days: 90 })).toThrow(/kind/);
    expect(() => assertValidFeeTerms({ kind: "flat", amount: 0, replacement_guarantee_days: 90 })).not.toThrow();
  });
});

describe("deposit pricing by campus count (§2, §9.1)", () => {
  it("prices by tier", () => {
    expect([1, 5, 6, 12, 13, 23].map((n) => depositFor(tiers, n))).toEqual([1_500_000, 1_500_000, 3_000_000, 3_000_000, 6_000_000, 6_000_000]);
  });
  it("is zero with no campuses and tops out at the last tier", () => {
    expect(depositFor(tiers, 0)).toBe(0);
    expect(depositFor(tiers, 40)).toBe(6_000_000);
  });
  it("applies the probation multiplier", () => {
    expect(depositFor(tiers, 6, 2)).toBe(6_000_000);
  });
  it("does not depend on the order tiers are stored in", () => {
    expect(depositFor([...tiers].reverse(), 3)).toBe(1_500_000);
  });
});

describe("depositForCtc (deposit.ctc_slabs)", () => {
  const LPA = 100_000 * 100;
  const slabs = [{ ctc_from: 0, ctc_to: 10 * LPA, amount: 500_000 }, { ctc_from: 10 * LPA, ctc_to: 20 * LPA, amount: 1_000_000 },
    { ctc_from: 20 * LPA, ctc_to: null, amount: 2_000_000 }];
  it("takes the slab holding the CTC: from inclusive, to exclusive, the last open-ended", () => {
    expect([5, 9.99, 10, 19.99, 20, 200].map((l) => depositForCtc(slabs, Math.round(l * LPA)))).toEqual([500_000, 500_000, 1_000_000, 1_000_000, 2_000_000, 2_000_000]);
  });
  it("applies the probation multiplier and needs a CTC", () => {
    expect(depositForCtc(slabs, 12 * LPA, 2)).toBe(2_000_000);
    expect(depositForCtc(slabs, null)).toBeNull();
    expect(depositForCtc([], 12 * LPA)).toBeNull();
  });
});
