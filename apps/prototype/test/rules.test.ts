import { describe, expect, it } from "vitest";
import { rulesFromConfig } from "../src/lib/config";
import { defaultFeeTerms, depositFor, evaluateRules, feeFor, type RoleDraft } from "../src/lib/rules";

const rules = rulesFromConfig();
const L = (lakhs: number) => lakhs * 100_000 * 100;
const draft = (over: Partial<RoleDraft> = {}): RoleDraft => ({ title: "Backend engineer", jd: "x".repeat(220), type: "fresher", ctcMin: L(12), ctcMax: L(16), locations: ["Bengaluru"], reach: ["IITD"], ...over });

describe("rules mirror the spec", () => {
  it("prices the deposit by campus count (§2)", () => {
    expect([1, 5, 6, 12, 13, 23].map((n) => depositFor(rules, n))).toEqual([1_500_000, 1_500_000, 3_000_000, 3_000_000, 6_000_000, 6_000_000]);
    expect(depositFor(rules, 0)).toBe(0);
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
