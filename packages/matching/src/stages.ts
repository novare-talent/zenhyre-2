// §4.3 match stages as data: which stage may follow which, and who may make the move. Pure.

export const MATCH_STAGES = [
  "scored", "applied", "pending_approval", "shortlisted", "viewed", "interviewed", "offered", "offer_accepted", "hired",
  "offer_reneged", "rejected", "withdrawn", "did_not_join", "left_early", "declined_by_staff", "role_closed"] as const;
export type MatchStage = (typeof MATCH_STAGES)[number];

export const MATCH_ACTOR_KINDS = ["candidate", "company", "staff", "system"] as const;
export type MatchActorKind = (typeof MATCH_ACTOR_KINDS)[number];
export interface MatchActor { kind: MatchActorKind; userId?: string }
export const SYSTEM_ACTOR: MatchActor = { kind: "system" };
/** What goes in an event's `actor` column: the user id, or "system". */
export const matchActorRef = (a: MatchActor): string => (a.kind === "system" ? "system" : a.userId ?? a.kind);

/** Never moved by `closeOpenMatches` or blocking. Everything else is open. */
export const SETTLED_STAGES: readonly MatchStage[] = [
  "hired", "did_not_join", "left_early", "rejected", "declined_by_staff", "withdrawn", "offer_reneged", "role_closed"];
export const isSettled = (s: MatchStage) => SETTLED_STAGES.includes(s);

export const REJECTION_CATEGORIES = ["skills", "experience", "location", "compensation", "culture", "position_filled", "no_show", "other"] as const;
export type RejectionCategory = (typeof REJECTION_CATEGORIES)[number];

/** §4.3 qualifying actions: company-initiated moves to these stages. `viewed` does not count. */
export const QUALIFYING_STAGES: readonly MatchStage[] = ["interviewed", "offered", "rejected"];

const COMPANY: readonly MatchActorKind[] = ["company"];
const CANDIDATE: readonly MatchActorKind[] = ["candidate"];
const SYSTEM: readonly MatchActorKind[] = ["system"];
const STAFF: readonly MatchActorKind[] = ["staff"];

/** The named rows of the §4.3 table. The three "any stage" rows are added in `allowedActors`. */
const STEPS: Partial<Record<MatchStage, Partial<Record<MatchStage, readonly MatchActorKind[]>>>> = {
  scored: { applied: CANDIDATE },
  applied: { pending_approval: SYSTEM, shortlisted: SYSTEM, withdrawn: CANDIDATE },
  pending_approval: { applied: STAFF, declined_by_staff: STAFF },
  shortlisted: { applied: SYSTEM, viewed: COMPANY, rejected: COMPANY, withdrawn: CANDIDATE },
  viewed: { interviewed: COMPANY, rejected: COMPANY, withdrawn: CANDIDATE },
  interviewed: { offered: COMPANY, rejected: COMPANY, withdrawn: CANDIDATE },
  offered: { offer_accepted: COMPANY, rejected: COMPANY, withdrawn: CANDIDATE },
  offer_accepted: { hired: COMPANY, offer_reneged: ["company", "candidate"], rejected: COMPANY },
  // did_not_join comes from the didNotJoin workflow: the company directly, or a join dispute settled by staff or by grace expiry.
  hired: { did_not_join: ["company", "staff", "system"], left_early: COMPANY },
};

/** Who may move a match from `from` to `to`. Empty means the move is illegal. */
export function allowedActors(from: MatchStage, to: MatchStage): MatchActorKind[] {
  if (from === to) return [];
  const kinds = new Set<MatchActorKind>(STEPS[from]?.[to] ?? []);
  if (!isSettled(from)) {
    // banCompany / a blocked candidate decline whatever is still open; closeOpenMatches closes it.
    if (to === "declined_by_staff") { kinds.add("staff"); kinds.add("system"); }
    if (to === "role_closed") kinds.add("system");
  }
  // confirmLeakage: staff override any stage to hired.
  if (to === "hired") kinds.add("staff");
  return [...kinds];
}
export function canMove(from: MatchStage, to: MatchStage, by: MatchActorKind): boolean {
  return allowedActors(from, to).includes(by);
}

/** A candidate's withdraw: `withdrawn` from most stages, `offer_reneged` once they had accepted an offer; null where they cannot withdraw. */
export function withdrawTarget(stage: MatchStage): "withdrawn" | "offer_reneged" | null {
  if (stage === "offer_accepted") return "offer_reneged";
  return canMove(stage, "withdrawn", "candidate") ? "withdrawn" : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * When a hire's replacement guarantee ends: the close of the last guarantee day, `joined_on + days`, in UTC. Up to this
 * instant the company may still mark `left_early`; after it `guaranteeExpiry` may close the role. One definition, so the
 * two can never overlap or leave a gap.
 */
export function guaranteeEndsAt(joinedOn: string, days: number): Date {
  return new Date(new Date(joinedOn + "T00:00:00Z").getTime() + (days + 1) * DAY_MS);
}
