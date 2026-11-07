// Pure rules shared by every seat. Each function mirrors a spec section; nothing here is invented.
import { formatPaise, percentOf, type Paise } from "@zenhyre/shared/src/money";
import { evaluateRules as gateRules, lpa, type RoleType, type RulesOutcome } from "@zenhyre/gate/src/rules";

export { formatPaise, percentOf, lpa, type Paise, type RoleType };

export interface Rules {
  depositTiers: { maxCampuses: number; amount: Paise }[];
  engagedThreshold: number;
  darkDays: number;
  internFlat: Paise;
  percentDefault: number;
  percentSenior: number;
  seniorYears: number;
  replacementDays: number;
  dueDaysAfterJoin: number;
  blocklist: string[];
  minCtc: Record<RoleType, Paise>;
  termsTimeoutDays: number;
  appealWindowDays: number;
  broadcastDays: number;
  shortlistCap: number;
  nudgeCap: number;
  escapeHatchDays: number;
  freemailDomains: string[];
  maxVerificationAttempts: number;
  shareRate: number;
}

/** §2 deposit pricing: by number of campuses selected. 0 campuses has no deposit yet. */
export function depositFor(rules: Rules, campusCount: number): Paise {
  if (campusCount <= 0) return 0;
  const tier = rules.depositTiers.find((t) => campusCount <= t.maxCampuses);
  return (tier ?? rules.depositTiers[rules.depositTiers.length - 1]!).amount;
}
export function tierIndexFor(rules: Rules, campusCount: number): number {
  if (campusCount <= 0) return -1;
  const i = rules.depositTiers.findIndex((t) => campusCount <= t.maxCampuses);
  return i < 0 ? rules.depositTiers.length - 1 : i;
}

export interface FeeTerms { kind: "flat" | "percent"; amount: number; replacementGuaranteeDays: number }

/** §7 Terms: prefilled from config by role type and years_exp_min. */
export function defaultFeeTerms(rules: Rules, type: RoleType, yearsExpMin: number): FeeTerms {
  if (type === "intern") return { kind: "flat", amount: rules.internFlat, replacementGuaranteeDays: rules.replacementDays };
  const pct = yearsExpMin >= rules.seniorYears ? rules.percentSenior : rules.percentDefault;
  return { kind: "percent", amount: pct, replacementGuaranteeDays: rules.replacementDays };
}
export function feeFor(terms: FeeTerms, hiredCtc: Paise): Paise {
  return terms.kind === "flat" ? terms.amount : percentOf(hiredCtc, terms.amount);
}
export function describeTerms(terms: FeeTerms): string {
  return terms.kind === "flat" ? `${formatPaise(terms.amount)} flat` : `${Math.round(terms.amount * 100)}% of annual CTC`;
}

export interface RoleDraft { title: string; jd: string; type: RoleType; ctcMin: Paise; ctcMax: Paise; locations: string[]; reach: string[] }
export type GateOutcome = RulesOutcome;

/** §7 Stage 1, the rules pass. The logic lives in @zenhyre/gate, the same code the API's gate job runs. */
export function evaluateRules(rules: Rules, role: RoleDraft): GateOutcome {
  return gateRules({ ...role, campusReach: role.reach }, { blocklist: rules.blocklist, minCtc: rules.minCtc });
}

export function ctcBand(type: RoleType, min: Paise | null, max: Paise | null): string {
  if (min === null || max === null) return "Pay not set";
  if (type === "intern") return `${formatPaise(Math.round(min / 12))} to ${formatPaise(Math.round(max / 12))} a month`;
  return `${lpa(min).replace(" LPA", "")} to ${lpa(max)}`;
}

/** §5 role lifecycle, in order. */
export const ROLE_STATES = ["draft", "gated", "terms_pending", "deposit_pending", "broadcast", "shortlist_ready", "closing", "closed"] as const;
export type RoleStatus = (typeof ROLE_STATES)[number] | "rejected" | "withdrawn";
export const ROLE_STATE_LABEL: Record<RoleStatus, string> = {
  draft: "Draft", gated: "Gate", terms_pending: "Terms", deposit_pending: "Deposit", broadcast: "Broadcast",
  shortlist_ready: "Shortlist", closing: "Closing", closed: "Closed", rejected: "Not accepted", withdrawn: "Withdrawn",
};

/** §4.3 match stages a company can move through, in order. */
export const STAGE_ORDER = ["applied", "shortlisted", "viewed", "interviewed", "offered", "offer_accepted", "hired"] as const;
export type Stage = (typeof STAGE_ORDER)[number] | "scored" | "pending_approval" | "rejected" | "withdrawn" | "offer_reneged" | "did_not_join" | "left_early" | "declined_by_staff" | "role_closed";
export const STAGE_LABEL: Record<Stage, string> = {
  scored: "Matched", applied: "Applied", pending_approval: "Awaiting approval", shortlisted: "Shortlisted", viewed: "Viewed", interviewed: "Interviewed", offered: "Offered",
  offer_accepted: "Offer accepted", hired: "Hired", rejected: "Not selected", withdrawn: "Withdrawn",
  offer_reneged: "Offer reneged", did_not_join: "Did not join", left_early: "Left early", declined_by_staff: "Declined", role_closed: "Role closed",
};
export const SETTLED: Stage[] = ["hired", "rejected", "withdrawn", "offer_reneged", "did_not_join", "left_early", "declined_by_staff", "role_closed"];
/** §4.3: the company's next forward step from each open stage. */
export const NEXT_STAGE: Partial<Record<Stage, Stage>> = {
  shortlisted: "viewed", viewed: "interviewed", interviewed: "offered", offered: "offer_accepted", offer_accepted: "hired",
};
export const REJECTION_CATEGORIES = ["skills", "experience", "location", "compensation", "culture", "position_filled", "no_show", "other"] as const;
export type RejectionCategory = (typeof REJECTION_CATEGORIES)[number];
export const REJECTION_LABEL: Record<RejectionCategory, string> = {
  skills: "Skills", experience: "Experience", location: "Location", compensation: "Compensation", culture: "Culture",
  position_filled: "Position filled", no_show: "No show", other: "Other",
};
/** §4.3: stages a candidate may withdraw from. From offer_accepted it becomes offer_reneged. */
export const CAN_WITHDRAW: Stage[] = ["applied", "shortlisted", "viewed", "interviewed", "offered", "offer_accepted"];

/** A date-only or ISO string as "6 Nov 2026". */
export const dayOf = (iso: string, addDays = 0) => {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  d.setDate(d.getDate() + addDays);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d);
};
