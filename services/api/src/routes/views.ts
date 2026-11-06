// What each seat is allowed to see of a role and a match. Routes return these, never raw rows.
import { NotFound, Invalid } from "@zenhyre/shared";
import type { Role, RoleGateDecision } from "@zenhyre/roles";
import type { Match } from "@zenhyre/matching";
import { withdrawTarget } from "@zenhyre/matching";
import type { AppDeps } from "../context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** A path id that is not a uuid cannot name anything: 404, not a database error. */
export function uuidParam(value: string, what: string): string {
  if (!UUID.test(value)) throw new NotFound(what);
  return value;
}

export interface PublicCampus { id: string; name: string; shortCode: string }
/** §4.1: `internal_tier` is never exposed. */
export async function publicCampuses(deps: AppDeps): Promise<Map<string, PublicCampus>> {
  return new Map((await deps.identity.listCampuses()).map(({ id, name, shortCode }) => [id, { id, name, shortCode }]));
}
/** Accepts campus ids or short codes ("IITD") and returns ids. An unknown campus is refused rather than dropped. */
export async function resolveCampusIds(deps: AppDeps, values: string[]): Promise<string[]> {
  const all = await deps.identity.listCampuses();
  const ids = values.map((v) => {
    const hit = all.find((c) => c.id === v || c.shortCode.toLowerCase() === v.toLowerCase());
    if (!hit) throw new Invalid(`unknown campus: ${v}`);
    return hit.id;
  });
  return [...new Set(ids)];
}

/**
 * A role as its company sees it. Fee terms appear only once staff have released them (§7). The model's score and
 * suggested reach, the nudge cap and job errors are internal.
 */
export function companyRoleView(role: Role, extra: { gate: RoleGateDecision | null; applicants: number; appealed: boolean }) {
  return {
    id: role.id, companyId: role.companyId, title: role.title, jd: role.jd, type: role.type,
    ctcMin: role.ctcMin, ctcMax: role.ctcMax, yearsExpMin: role.yearsExpMin, yearsExpMax: role.yearsExpMax,
    locations: role.locations, campusReach: role.campusReach, status: role.status,
    gate: extra.gate ? { stage: extra.gate.stage, outcome: extra.gate.outcome, reason: extra.gate.reason, rule: extra.gate.rule, decidedAt: extra.gate.decidedAt } : null,
    appealed: extra.appealed,
    feeTerms: role.feeTermsReleasedAt ? role.feeTerms : null,
    feeTermsReleasedAt: role.feeTermsReleasedAt, feeTermsAcceptedAt: role.feeTermsAcceptedAt,
    depositAmount: role.depositAmount, depositMode: role.depositMode,
    broadcastOpensAt: role.broadcastOpensAt, broadcastClosesAt: role.broadcastClosesAt,
    shortlistReadyAt: role.shortlistReadyAt, shortlistCap: role.shortlistCap,
    hiredMatchId: role.hiredMatchId, hiredAt: role.hiredAt, applicants: extra.applicants, createdAt: role.createdAt,
  };
}

/** A role as a candidate sees it on the board. Their own application is attached; fit score and rank are never shown to candidates. */
export function candidateRoleView(role: Role, extra: { companyName: string; match: Match | null }) {
  const applied = extra.match?.appliedAt ? extra.match : null;
  return {
    id: role.id, title: role.title, jd: role.jd, type: role.type, ctcMin: role.ctcMin, ctcMax: role.ctcMax,
    yearsExpMin: role.yearsExpMin, yearsExpMax: role.yearsExpMax, locations: role.locations, campusReach: role.campusReach,
    company: { id: role.companyId, name: extra.companyName },
    open: role.status === "broadcast", broadcastClosesAt: role.broadcastClosesAt,
    nudged: !!extra.match?.nudgedAt,
    application: applied ? { id: applied.id, stage: applied.stage, appliedAt: applied.appliedAt } : null,
  };
}

/** §8 candidate view: their applications and stage. A rejected candidate sees the category only, never the note. */
export function applicationView(match: Match, role: Role, companyName: string) {
  return {
    id: match.id, stage: match.stage, appliedAt: match.appliedAt, updatedAt: match.updatedAt,
    rejectionCategory: match.stage === "rejected" ? match.rejectionCategory : null,
    joinedOn: match.stage === "hired" ? match.joinedOn : null,
    // §9.2: a hired candidate is asked whether they joined; these say whether the question is out and whether it is settled.
    joinPromptSentAt: match.stage === "hired" ? match.joinPromptSentAt : null,
    joinConfirmedAt: match.stage === "hired" ? match.joinConfirmedAt : null,
    canWithdraw: withdrawTarget(match.stage) !== null,
    role: { id: role.id, title: role.title, type: role.type, locations: role.locations, ctcMin: role.ctcMin, ctcMax: role.ctcMax },
    company: { id: role.companyId, name: companyName },
  };
}

type CandidateRow = NonNullable<Awaited<ReturnType<AppDeps["identity"]["getCandidate"]>>>;
/**
 * A shortlist row as the company sees it (§8 company view): rank, fit, stage and the candidate's profile.
 * Left out: trust status, verification details, the parsed CV, what an alum claimed at sign-up, and current CTC.
 */
export function shortlistRowView(match: Match, candidate: CandidateRow | undefined, campus: PublicCampus | undefined) {
  const p = candidate?.profile ?? {};
  return {
    id: match.id, rank: match.rank, stage: match.stage, fitScore: match.fitScore, fitReason: match.fitReason, appliedAt: match.appliedAt,
    offeredCtc: match.offeredCtc, hiredCtc: match.hiredCtc, joinedOn: match.joinedOn,
    rejectionCategory: match.rejectionCategory, rejectionNote: match.rejectionNote, joinConfirmedAt: match.joinConfirmedAt,
    candidate: candidate ? {
      id: candidate.userId, campus: campus ?? null, course: candidate.course, gradDate: candidate.gradDate, status: candidate.status,
      profile: {
        headline: p.headline ?? null, skills: p.skills ?? [], yearsExperience: p.years_experience ?? null,
        currentCompany: p.current_company ?? null, currentTitle: p.current_title ?? null,
        preferredRoles: p.preferred_roles ?? [], preferredLocations: p.preferred_locations ?? [],
        noticePeriodDays: p.notice_period_days ?? null, linkedinUrl: p.linkedin_url ?? null, cvUrl: p.cv_url ?? null,
      },
    } : null,
  };
}
