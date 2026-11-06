import { evaluateModel, evaluateRules, type GateRole, type ModelOutcome } from "@zenhyre/gate";
import { Invalid } from "@zenhyre/shared";
import { prefillFeeTerms, SYSTEM, type Actor, type Role } from "@zenhyre/roles";
import { AppDeps } from "../context";
import { inTx, notifyCompany, requireStaff, User, Wf } from "./tx";

export type GateInput =
  | { trigger: "job"; roleId: string }
  | { trigger: "staff"; roleId: string; user: User; outcome: "accept" | "reject"; reason?: string; campusReach?: string[] };
export type GateResult = { outcome: "accept" | "reject" | "needs_review" | "noop"; role: Role | null };

const gateRole = (r: Role): GateRole => ({ title: r.title, jd: r.jd, type: r.type, ctcMin: r.ctcMin, ctcMax: r.ctcMax, locations: r.locations, campusReach: r.campusReach });

async function accept(w: Wf, role: Role, actor: Actor, note: string): Promise<GateResult> {
  const { config } = w.m.ops;
  const feeTerms = prefillFeeTerms(role.type, role.yearsExpMin, {
    internFlat: await config.get("fee.intern_flat"), percentDefault: await config.get("fee.percent_default"),
    percentSenior: await config.get("fee.percent_senior"), seniorYears: await config.get("fee.senior_years"),
    replacementDays: await config.get("fee.replacement_days") });
  const updated = await w.m.roles.transition(role.id, "terms_pending", actor, note, { feeTerms });
  notifyCompany(w, role.companyId, "role_accepted", { roleTitle: role.title });
  return { outcome: "accept", role: updated };
}
async function reject(w: Wf, role: Role, actor: Actor, reason: string): Promise<GateResult> {
  const updated = await w.m.roles.transition(role.id, "rejected", actor, reason);
  notifyCompany(w, role.companyId, "role_rejected", { roleTitle: role.title, reason });
  return { outcome: "reject", role: updated };
}
/** Stage 3 hand-off: the role stays `gated` with a `gate` item in the staff queue. */
async function review(w: Wf, role: Role, reason: string, payload: Record<string, unknown> = {}): Promise<GateResult> {
  await w.m.ops.openReview({ kind: "gate", refType: "role", refId: role.id, associationId: null,
    payload: { reason, roleTitle: role.title, companyId: role.companyId, ...payload } });
  notifyCompany(w, role.companyId, "role_needs_review", { roleTitle: role.title });
  return { outcome: "needs_review", role };
}

/**
 * §7 / §3.3 gateDecision. As a job (role just entered `gated`): rules, then the model, each writing a
 * RoleGateDecision; the first stage that decides, decides. As staff (stage 3): accept, optionally adjusting the
 * reach, or reject with a reason. A no-op if the role is no longer `gated` (withdrawn mid-flight).
 */
export async function gateDecision(deps: AppDeps, input: GateInput): Promise<GateResult> {
  if (input.trigger === "staff") return humanDecision(deps, input);

  const seen = await deps.roles.get(input.roleId);
  if (!seen || seen.status !== "gated") return { outcome: "noop", role: seen };
  // An appealed role goes straight to stage 3; appealRole has already queued it.
  if ((await deps.roles.events(seen.id)).some((e) => e.fromStatus === "rejected" && e.toStatus === "gated")) return { outcome: "noop", role: seen };

  const rules = evaluateRules(gateRole(seen), { blocklist: await deps.ops.config.get("gate.blocklist"), minCtc: await deps.ops.config.get("gate.min_ctc") });
  const company = await deps.identity.getCompany(seen.companyId);
  const onProbation = company?.status === "probation";
  // The model call is slow, so it runs before the transaction opens. A response that does not validate throws
  // (§13: a failure, never a decision) and the job runner records it on the role.
  let model: ModelOutcome | null = null;
  if (rules.outcome === "accept" && !onProbation && deps.gateModel) {
    model = evaluateModel(gateRole(seen), await deps.gateModel.evaluate(gateRole(seen)), {
      acceptThreshold: await deps.ops.config.get("gate.accept_threshold"), rejectThreshold: await deps.ops.config.get("gate.reject_threshold") });
  }

  return inTx(deps, async (w) => {
    const role = await w.m.roles.require(input.roleId);
    if (role.status !== "gated") return { outcome: "noop", role };
    await w.m.roles.recordGateDecision(role.id, { stage: "rules", outcome: rules.outcome, reason: rules.reason, rule: rules.rule, decidedBy: "system" });
    if (rules.outcome === "reject") return reject(w, role, SYSTEM, rules.reason);
    if (onProbation) return review(w, role, "The company is on probation: a person reviews every role.");
    if (!model) return review(w, role, "No model pass is configured: a person reviews every role that passes the rules.");
    await w.m.roles.recordGateDecision(role.id, { stage: "model", outcome: model.outcome, reason: model.reason,
      suggestedReach: model.suggestedReach, modelScore: model.modelScore, decidedBy: "system" });
    if (model.outcome === "accept") return accept(w, role, SYSTEM, model.reason);
    if (model.outcome === "reject") return reject(w, role, SYSTEM, model.reason);
    return review(w, role, model.reason, { modelScore: model.modelScore, suggestedReach: model.suggestedReach, concerns: model.concerns });
  });
}

async function humanDecision(deps: AppDeps, input: Extract<GateInput, { trigger: "staff" }>): Promise<GateResult> {
  const actor = requireStaff(input.user);
  const reason = input.reason?.trim() ?? "";
  if (input.outcome === "reject" && !reason) throw new Invalid("a rejection needs a reason the company will see");
  return inTx(deps, async (w) => {
    let role = await w.m.roles.require(input.roleId);
    const open = (await w.m.ops.listReviews({ kind: "gate", open: true })).filter((i) => i.refType === "role" && i.refId === role.id);
    const closeItems = async (resolution: string) => { for (const i of open) await w.m.ops.resolveReview(i.id, `staff:${input.user.id}`, resolution); };
    if (role.status !== "gated") { await closeItems("noop"); return { outcome: "noop", role }; }

    if (input.outcome === "accept" && input.campusReach) role = await w.m.roles.update(role.id, { campusReach: input.campusReach });
    await w.m.roles.recordGateDecision(role.id, { stage: "human", outcome: input.outcome, reason: reason || "Accepted on review.", decidedBy: input.user.id });
    const result = input.outcome === "accept" ? await accept(w, role, actor, reason || "Accepted on review.") : await reject(w, role, actor, reason);
    await closeItems(input.outcome);
    await w.m.ops.audit(input.user.id, `gate.${input.outcome}`, "role", role.id, reason || undefined);
    return result;
  });
}
