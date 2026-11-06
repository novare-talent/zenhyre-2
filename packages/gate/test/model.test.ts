import { describe, expect, it } from "vitest";
import { evaluateModel, fixtureGateModel, GateModelError, parseModelResponse, type GateRole, type ModelConfig } from "../src/index";

// The defaults of `gate.accept_threshold` / `gate.reject_threshold` (spec §17).
const config: ModelConfig = { acceptThreshold: 70, rejectThreshold: 40 };
const role = (campusReach = ["IITB", "IITD"]): GateRole => ({
  title: "Backend engineer", jd: "x".repeat(220), type: "fresher", ctcMin: 120_000_000, ctcMax: 160_000_000, locations: ["Bengaluru"], campusReach });
const response = (score: number, suggested_reach = ["IITB", "IITD", "IITM"]) => ({ score, suggested_reach, concerns: [], reason: "Solid engineering role." });

describe("evaluateModel (§7 stage 2) threshold routing with fixture responses", () => {
  it.each([
    [100, "accept"], [70, "accept"], [69, "needs_review"], [40, "needs_review"], [39, "reject"], [0, "reject"],
  ] as const)("score %i with the reach inside the suggestion → %s", (score, outcome) => {
    expect(evaluateModel(role(), response(score), config).outcome).toBe(outcome);
  });

  it("sends a reach beyond the suggestion to a human, even at a score that would accept", () => {
    const out = evaluateModel(role(["IITB", "IITGOA"]), response(92), config);
    expect(out.outcome).toBe("needs_review");
    expect(out.reason).toContain("1 campus beyond the suggested reach");
  });
  it("rejects under the reject threshold regardless of reach", () => {
    expect(evaluateModel(role(["IITB", "IITGOA"]), response(39), config).outcome).toBe("reject");
  });
  it("carries the score, suggested reach, concerns and reason", () => {
    const out = evaluateModel(role(), { score: 84.6, suggested_reach: ["IITB", "IITD"], concerns: ["thin JD"], reason: "Good fit." }, config);
    expect(out).toEqual({ outcome: "accept", reason: "Good fit.", modelScore: 85, suggestedReach: ["IITB", "IITD"], concerns: ["thin JD"] });
  });
  it("reads thresholds from config", () => {
    expect(evaluateModel(role(), response(60), { acceptThreshold: 60, rejectThreshold: 30 }).outcome).toBe("accept");
    expect(evaluateModel(role(), response(35), { acceptThreshold: 60, rejectThreshold: 30 }).outcome).toBe("needs_review");
  });

  it.each([
    ["not an object", "nope"],
    ["null", null],
    ["a score out of range", { ...response(50), score: 140 }],
    ["a score that is not a number", { ...response(50), score: "high" }],
    ["a missing suggested reach", { score: 50, concerns: [], reason: "x" }],
    ["concerns that are not strings", { ...response(50), concerns: [1] }],
    ["an empty reason", { ...response(50), reason: " " }],
  ])("treats %s as a failure, never a decision", (_what, raw) => {
    expect(() => evaluateModel(role(), raw, config)).toThrow(GateModelError);
    expect(() => parseModelResponse(raw)).toThrow(GateModelError);
  });

  it("replays fixtures through the GateModel interface", async () => {
    const fixed = fixtureGateModel(response(80));
    expect(evaluateModel(role(), await fixed.evaluate(role()), config).outcome).toBe("accept");
    const perRole = fixtureGateModel((r: GateRole) => response(r.title.includes("Backend") ? 30 : 90));
    expect(evaluateModel(role(), await perRole.evaluate(role()), config).outcome).toBe("reject");
  });
});
