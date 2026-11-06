import { describe, expect, it } from "vitest";
import { evaluateRules, lpa, RULES, type GateRole, type RulesConfig } from "../src/index";

// The defaults of `gate.blocklist` and `gate.min_ctc` (spec §17).
const config: RulesConfig = { blocklist: ["field sales", "bpo", "data entry", "unpaid"], minCtc: { intern: 24_000_000, fresher: 60_000_000, experienced: 100_000_000 } };
const L = (lakhs: number) => lakhs * 100_000 * 100;
const role = (over: Partial<GateRole> = {}): GateRole => ({
  title: "Backend engineer", jd: "x".repeat(220), type: "fresher", ctcMin: L(12), ctcMax: L(16), locations: ["Bengaluru"], campusReach: ["IITD"], ...over });

describe("evaluateRules (§7 stage 1)", () => {
  it("passes a complete role above the CTC floor", () => {
    expect(evaluateRules(role(), config)).toEqual({ outcome: "accept", reason: "Passed the rules." });
  });

  describe("role-category blocklist, matched against title and JD", () => {
    it.each([
      ["title", { title: "Field sales associate" }, "field sales"],
      ["JD", { jd: "This is a BPO voice process. " + "x".repeat(220) }, "bpo"],
      ["JD, across a line break", { jd: "Mostly data\nentry work. " + "x".repeat(220) }, "data entry"],
      ["title, any case", { title: "UNPAID research intern" }, "unpaid"],
    ])("rejects a blocked category in the %s", (_where, over, phrase) => {
      const out = evaluateRules(role(over), config);
      expect(out).toMatchObject({ outcome: "reject", rule: RULES.category });
      expect(out.reason).toContain(`"${phrase}"`);
    });
    it("matches whole phrases only", () => {
      expect(evaluateRules(role({ title: "Sales engineer, field robotics" }), config).outcome).toBe("accept");
      expect(evaluateRules(role({ jd: "You will pay down the unpaidinvoices backlog. " + "x".repeat(220) }), config).outcome).toBe("accept");
    });
    it("is checked first, so a blocked role is named as such even when fields are missing", () => {
      expect(evaluateRules(role({ title: "Data entry operator", jd: "short", campusReach: [] }), config).rule).toBe(RULES.category);
    });
    it("uses the configured list", () => {
      expect(evaluateRules(role({ title: "Telecaller" }), { ...config, blocklist: ["telecaller"] }).rule).toBe(RULES.category);
      expect(evaluateRules(role({ title: "Field sales associate" }), { ...config, blocklist: [] }).outcome).toBe("accept");
    });
  });

  describe("required fields", () => {
    it.each([
      ["a JD under 200 characters", { jd: "too short" }, /at least 200 characters \(it has 9\)/],
      ["a JD that is 199 characters after trimming", { jd: "  " + "x".repeat(199) + "  " }, /it has 199/],
      ["no role type", { type: null }, /role type/],
      ["no CTC band", { ctcMin: null, ctcMax: null }, /CTC band/],
      ["a zero CTC floor", { ctcMin: 0 }, /CTC band/],
      ["a band that is upside down", { ctcMin: L(16), ctcMax: L(12) }, /lowest figure first/],
      ["no location", { locations: [] }, /location/],
      ["only blank locations", { locations: ["  "] }, /location/],
      ["no campus", { campusReach: [] }, /campus/],
    ])("rejects %s", (_what, over, reason) => {
      const out = evaluateRules(role(over as Partial<GateRole>), config);
      expect(out).toMatchObject({ outcome: "reject", rule: RULES.required });
      expect(out.reason).toMatch(reason);
    });
    it("accepts a JD of exactly 200 characters", () => {
      expect(evaluateRules(role({ jd: "x".repeat(200) }), config).outcome).toBe("accept");
    });
  });

  describe("minimum annual CTC by type", () => {
    it.each([
      ["intern", 24_000_000], ["fresher", 60_000_000], ["experienced", 100_000_000],
    ] as const)("%s: accepts at the floor, rejects one paisa under it", (type, floor) => {
      expect(evaluateRules(role({ type, ctcMin: floor, ctcMax: floor * 2 }), config).outcome).toBe("accept");
      expect(evaluateRules(role({ type, ctcMin: floor - 1, ctcMax: floor * 2 }), config)).toMatchObject({ outcome: "reject", rule: RULES.minCtc });
    });
    it("names both figures in the reason", () => {
      expect(evaluateRules(role({ ctcMin: L(4), ctcMax: L(5) }), config).reason).toBe("The floor for fresher roles is ₹6 LPA. This band starts at ₹4 LPA.");
    });
    it("reads the floor from config", () => {
      expect(evaluateRules(role({ ctcMin: L(4), ctcMax: L(5) }), { ...config, minCtc: { ...config.minCtc, fresher: L(3) } }).outcome).toBe("accept");
    });
  });

  it("formats lakh figures", () => {
    expect(lpa(240_000_000)).toBe("₹24 LPA");
    expect(lpa(24_000_000)).toBe("₹2.4 LPA");
  });
});
