// §8 step 3 behind an interface. The spec's scorer is cosine similarity over pgvector embeddings followed by a
// Claude rerank; Slice 1 has neither, so matching depends on this Scorer and ships a deterministic one. The
// embedding + rerank implementation replaces `deterministicScorer` without touching ranking, displacement or freeze.
import type { MatchingCandidate, MatchingRole } from "./filter";

export interface Fit { fitScore: number; fitReason: string }
export type ScoringRole = Pick<MatchingRole, "id" | "type" | "title" | "jd" | "yearsExpMin" | "yearsExpMax" | "locations">;
export type ScoringCandidate = Pick<MatchingCandidate, "userId" | "status" | "profile">;
export interface Scorer { score(role: ScoringRole, candidate: ScoringCandidate): Promise<Fit> }

/** Lowercase terms separated by single spaces. Keeps the characters skill names use ("c++", "c#", "node.js") but not sentence punctuation. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\.+(?= |$)/g, "").replace(/ +/g, " ").trim();
const has = (haystack: string, phrase: string) => phrase.length > 0 && ` ${haystack} `.includes(` ${phrase} `);
const tokens = (s: string) => norm(s).split(" ").filter((t) => t.length > 2);

/**
 * A fixed rubric over the structured profile: skills named in the role (50), experience against the band (20),
 * location (15), and how close the candidate's titles and preferred roles are to the role title (15).
 * The same inputs always give the same score and reason.
 */
export const deterministicScorer: Scorer = {
  async score(role, c) {
    const text = norm(`${role.title} ${role.jd}`);
    const skills = c.profile.skills ?? [];
    const matched = skills.filter((s) => has(text, norm(s)));
    const skillPts = Math.round((Math.min(matched.length, 4) / 4) * 50);

    const yrs = c.profile.years_experience ?? 0;
    let expPts = 20;
    if (role.type === "experienced") {
      const gap = yrs < role.yearsExpMin ? role.yearsExpMin - yrs : yrs > role.yearsExpMax ? yrs - role.yearsExpMax : 0;
      expPts = Math.max(0, Math.round(20 - gap * 5));
    }

    const wanted = (c.profile.preferred_locations ?? []).map(norm);
    const offered = role.locations.map(norm);
    const sharedLocation = offered.find((l) => wanted.includes(l));
    const locPts = sharedLocation || offered.includes("remote") ? 15 : wanted.length === 0 ? 8 : 0;

    const titleWords = new Set(tokens(role.title));
    const own = tokens([c.profile.headline, c.profile.current_title, ...(c.profile.preferred_roles ?? [])].filter(Boolean).join(" "));
    const overlap = new Set(own.filter((t) => titleWords.has(t))).size;
    const titlePts = titleWords.size ? Math.round((Math.min(overlap, 2) / 2) * 15) : 0;

    const fitScore = Math.max(0, Math.min(100, skillPts + expPts + locPts + titlePts));
    const parts = [
      matched.length ? `Lists ${matched.slice(0, 4).join(", ")} from the role` : "No listed skill appears in the role",
      role.type === "experienced" ? `${yrs} years against a ${role.yearsExpMin} to ${role.yearsExpMax} band` : null,
      sharedLocation ? `prefers ${role.locations.find((l) => norm(l) === sharedLocation)}` : offered.includes("remote") ? "role is remote" : null,
    ].filter(Boolean);
    return { fitScore, fitReason: parts.join("; ") + "." };
  },
};

/** For tests and fixtures: a fixed score per candidate id. */
export function fixedScorer(scores: Record<string, number>, fallback = 50): Scorer {
  return { score: async (_role, c) => ({ fitScore: scores[c.userId] ?? fallback, fitReason: `Fixture score ${scores[c.userId] ?? fallback}.` }) };
}
