import { describe, expect, it } from "vitest";
import { rulesFromConfig } from "../src/lib/config";
import { defaultFeeTerms, depositFor, depositForCtc, evaluateRules, feeFor, slabIndexFor, type RoleDraft } from "../src/lib/rules";

const rules = rulesFromConfig();
const L = (lakhs: number) => lakhs * 100_000 * 100;
const draft = (over: Partial<RoleDraft> = {}): RoleDraft => ({ title: "Backend engineer", jd: "x".repeat(220), type: "fresher", ctcMin: L(12), ctcMax: L(16), locations: ["Bengaluru"], reach: ["IITD"], ...over });

describe("rules mirror the spec", () => {
  it("prices the deposit by campus count (§2)", () => {
    expect([1, 5, 6, 12, 13, 23].map((n) => depositFor(rules, n))).toEqual([1_500_000, 1_500_000, 3_000_000, 3_000_000, 6_000_000, 6_000_000]);
    expect(depositFor(rules, 0)).toBe(0);
  });
  it("prices the deposit by the CTC offered, from the slabs in config (before GST)", () => {
    const slabs = rules.depositCtcSlabs;
    const R = (rupees: number) => rupees * 100;
    expect(depositForCtc(slabs, L(4))).toBe(R(5_000)); // below 5 LPA takes the base slab
    expect(depositForCtc(slabs, L(16))).toBe(R(15_000));
    expect(depositForCtc(slabs, L(20))).toBe(R(20_000)); // 20 LPA → ₹20k (lower bound inclusive)
    expect(depositForCtc(slabs, L(199))).toBe(R(150_000));
    expect(depositForCtc(slabs, L(500))).toBe(R(200_000)); // 2 Cr and above
    expect(depositForCtc(slabs, L(16), 2)).toBe(R(30_000)); // probation multiplier
    expect(depositForCtc(slabs, null)).toBeNull();
    expect(depositForCtc(slabs, 0)).toBeNull();
    expect(slabIndexFor(slabs, L(20))).toBe(3);
    expect(rules.gstRate).toBe(0.18);
  });
  it("prefills fee terms by role type and seniority (§7)", () => {
    expect(defaultFeeTerms(rules, "intern", 0)).toMatchObject({ kind: "flat", amount: 1_250_000 });
    expect(defaultFeeTerms(rules, "experienced", 4)).toMatchObject({ kind: "percent", amount: 0.1 });
    expect(defaultFeeTerms(rules, "experienced", 10)).toMatchObject({ kind: "percent", amount: 0.2 });
    expect(feeFor(defaultFeeTerms(rules, "experienced", 4), L(46))).toBe(46_000_000); // 10% of ₹46 lakh, in paise
  });
  it("runs the gate's rules pass and names the rule on a reject (§7 stage 1)", () => {
    expect(evaluateRules(rules, draft()).outcome).toBe("accept");
    expect(evaluateRules(rules, draft({ title: "Field sales associate" }))).toMatchObject({ outcome: "reject", rule: "Role category" });
    expect(evaluateRules(rules, draft({ jd: "too short" }))).toMatchObject({ outcome: "reject", rule: "Required fields" });
    expect(evaluateRules(rules, draft({ ctcMin: L(4), ctcMax: L(5) }))).toMatchObject({ outcome: "reject", rule: "Minimum CTC" });
    expect(evaluateRules(rules, draft({ reach: [] }))).toMatchObject({ outcome: "reject", rule: "Required fields" });
  });
  it("refuses personal mailboxes for companies (§6.4)", () => {
    expect(rules.freemailDomains).toContain("gmail.com");
  });
});
