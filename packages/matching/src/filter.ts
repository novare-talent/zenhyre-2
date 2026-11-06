// §8 step 2 (who is matched and nudged) and step 5 (who may apply, which roles a candidate sees). Pure.
import type { CandidateProfile } from "@zenhyre/db/schema";

export type CandidateStatus = "student" | "final_year" | "alumnus";
export type RoleType = "intern" | "fresher" | "experienced";

/** The parts of a candidate matching reads. A `candidate` row from identity satisfies it. */
export interface MatchingCandidate {
  userId: string; campusId: string; status: CandidateStatus;
  verificationState: "verified" | "referral_pending" | "verification_pending" | "rejected";
  trustStatus: "ok" | "restricted" | "blocked";
  openToOpportunities: boolean; profile: CandidateProfile;
}
/** The parts of a role matching reads. A `role` row from roles satisfies it. */
export interface MatchingRole {
  id: string; status: string; type: RoleType; title: string; jd: string;
  yearsExpMin: number; yearsExpMax: number; locations: string[]; campusReach: string[];
  shortlistCap: number; nudgeCap: number;
}

const years = (c: Pick<MatchingCandidate, "profile">) => c.profile.years_experience ?? 0;
/** A fresher role takes alumni with at most this much experience. */
export const FRESHER_MAX_YEARS = 1;

/** Status fits type: intern → student or final_year; fresher → final_year, or alumnus with ≤ 1 year; experienced → alumnus inside the band. */
export function fitsType(role: Pick<MatchingRole, "type" | "yearsExpMin" | "yearsExpMax">, c: Pick<MatchingCandidate, "status" | "profile">): boolean {
  switch (role.type) {
    case "intern": return c.status === "student" || c.status === "final_year";
    case "fresher": return c.status === "final_year" || (c.status === "alumnus" && years(c) <= FRESHER_MAX_YEARS);
    case "experienced": return c.status === "alumnus" && years(c) >= role.yearsExpMin && years(c) <= role.yearsExpMax;
  }
}

/** The same rule as a query for `identity.listMatchableCandidates`: the union of these filters is the matchable set. */
export interface MatchableFilter { campusIds: string[]; statuses: CandidateStatus[]; minYears?: number; maxYears?: number }
export function candidateFilters(role: Pick<MatchingRole, "type" | "yearsExpMin" | "yearsExpMax" | "campusReach">): MatchableFilter[] {
  const campusIds = role.campusReach;
  switch (role.type) {
    case "intern": return [{ campusIds, statuses: ["student", "final_year"] }];
    case "fresher": return [{ campusIds, statuses: ["final_year"] }, { campusIds, statuses: ["alumnus"], maxYears: FRESHER_MAX_YEARS }];
    case "experienced": return [{ campusIds, statuses: ["alumnus"], minYears: role.yearsExpMin, maxYears: role.yearsExpMax }];
  }
}

/** Matched and scored at broadcast: open, verified, not blocked, campus in reach, status fits type. */
export function isMatchable(role: Pick<MatchingRole, "type" | "yearsExpMin" | "yearsExpMax" | "campusReach">, c: MatchingCandidate): boolean {
  return c.openToOpportunities && c.verificationState === "verified" && c.trustStatus !== "blocked"
    && role.campusReach.includes(c.campusId) && fitsType(role, c);
}

export type ApplyCheck = { ok: true } | { ok: false; code: "closed" | "campus" | "type" | "blocked" | "unverified"; reason: string };

/** `open_to_opportunities` is not required to apply; being blocked or unverified is disqualifying. */
export function canApply(role: MatchingRole, c: MatchingCandidate): ApplyCheck {
  if (role.status !== "broadcast") return { ok: false, code: "closed", reason: "This role is not taking applications." };
  if (!role.campusReach.includes(c.campusId)) return { ok: false, code: "campus", reason: "This role is not open to your campus." };
  if (!fitsType(role, c)) return { ok: false, code: "type", reason: `This ${role.type} role does not fit your current status.` };
  if (c.trustStatus === "blocked") return { ok: false, code: "blocked", reason: "Your account cannot apply to roles." };
  if (c.verificationState !== "verified" && c.verificationState !== "referral_pending") return { ok: false, code: "unverified", reason: "You can apply once your IIT status is verified." };
  return { ok: true };
}

/** What the candidate app lists: roles in broadcast whose reach includes the candidate's campus and whose type fits their status. */
export function listOpenRolesFor<R extends MatchingRole>(c: Pick<MatchingCandidate, "campusId" | "status" | "profile">, roles: R[]): R[] {
  return roles.filter((r) => r.status === "broadcast" && r.campusReach.includes(c.campusId) && fitsType(r, c));
}
