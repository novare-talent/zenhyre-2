// §7 stage 2: the model pass. This file is the pure half: validating what the model returned and routing
// it by threshold. The call itself goes through a GateModel, so Slice 1 runs on recorded fixtures (§14) and
// the Claude-backed implementation can be dropped in later without touching the routing.
import type { GateOutcome, GateRole } from "./rules";

/** The JSON the model is asked for. */
export interface ModelResponse {
  score: number;
  suggested_reach: string[];
  concerns: string[];
  reason: string;
}

/** From config: `gate.accept_threshold`, `gate.reject_threshold`. */
export interface ModelConfig { acceptThreshold: number; rejectThreshold: number }

export interface ModelOutcome extends GateOutcome {
  modelScore: number;
  suggestedReach: string[];
  concerns: string[];
}

/** §13: an invalid model response is a failure, never a decision. */
export class GateModelError extends Error {
  constructor(message: string) { super(message); this.name = "GateModelError"; }
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

export function parseModelResponse(raw: unknown): ModelResponse {
  if (!raw || typeof raw !== "object") throw new GateModelError("model response is not an object");
  const r = raw as Record<string, unknown>;
  if (typeof r.score !== "number" || !Number.isFinite(r.score) || r.score < 0 || r.score > 100) throw new GateModelError("model response: score must be a number from 0 to 100");
  if (!isStringArray(r.suggested_reach)) throw new GateModelError("model response: suggested_reach must be a list of campus ids");
  if (!isStringArray(r.concerns)) throw new GateModelError("model response: concerns must be a list of strings");
  if (typeof r.reason !== "string" || !r.reason.trim()) throw new GateModelError("model response: reason is required");
  return { score: r.score, suggested_reach: r.suggested_reach, concerns: r.concerns, reason: r.reason };
}

/**
 * Routes a model response: below the reject threshold rejects whatever the reach; at or above it, a reach that goes
 * beyond the model's suggestion needs a human; otherwise at or above the accept threshold accepts and the band between
 * needs a human. Throws GateModelError on a response that does not validate.
 */
export function evaluateModel(role: GateRole, response: unknown, config: ModelConfig): ModelOutcome {
  const m = parseModelResponse(response);
  const base = { modelScore: Math.round(m.score), suggestedReach: m.suggested_reach, concerns: m.concerns };
  if (m.score < config.rejectThreshold) return { ...base, outcome: "reject", reason: m.reason };
  const suggested = new Set(m.suggested_reach);
  const outside = role.campusReach.filter((c) => !suggested.has(c));
  if (outside.length) {
    return { ...base, outcome: "needs_review", reason: `${m.reason} The role reaches ${outside.length} ${outside.length === 1 ? "campus" : "campuses"} beyond the suggested reach.` };
  }
  return { ...base, outcome: m.score >= config.acceptThreshold ? "accept" : "needs_review", reason: m.reason };
}

/** What stage 2 calls. Returns the raw response; `evaluateModel` validates it. */
export interface GateModel {
  evaluate(role: GateRole): Promise<unknown>;
}

/** A GateModel that replays fixed responses: one object for every role, or a function choosing one per role. */
export function fixtureGateModel(response: Record<string, unknown> | ((role: GateRole) => unknown)): GateModel {
  return { evaluate: async (role) => (typeof response === "function" ? response(role) : response) };
}
