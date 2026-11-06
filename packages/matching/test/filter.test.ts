import { describe, expect, it } from "vitest";
import { canApply, candidateFilters, deterministicScorer, fitsType, fixedScorer, isMatchable, listOpenRolesFor,
  type CandidateStatus, type MatchingCandidate, type MatchingRole, type RoleType } from "../src/index";

const A = "campus-a", B = "campus-b";
const role = (over: Partial<MatchingRole> = {}): MatchingRole => ({
  id: "r1", status: "broadcast", type: "fresher", title: "Backend engineer", jd: "Go and PostgreSQL services.", yearsExpMin: 0, yearsExpMax: 1,
  locations: ["Bengaluru"], campusReach: [A], shortlistCap: 25, nudgeCap: 150, ...over });
const cand = (over: Partial<MatchingCandidate> = {}): MatchingCandidate => ({
  userId: "u1", campusId: A, status: "final_year", verificationState: "verified", trustStatus: "ok", openToOpportunities: true, profile: {}, ...over });

describe("status fits type (§8 step 2)", () => {
  const cases: Array<[RoleType, CandidateStatus, number | undefined, boolean]> = [
    ["intern", "student", undefined, true], ["intern", "final_year", undefined, true], ["intern", "alumnus", 0, false],
    ["fresher", "student", undefined, false], ["fresher", "final_year", undefined, true],
    ["fresher", "alumnus", undefined, true], ["fresher", "alumnus", 1, true], ["fresher", "alumnus", 1.5, false],
    ["experienced", "student", 5, false], ["experienced", "final_year", 5, false],
    ["experienced", "alumnus", 2.9, false], ["experienced", "alumnus", 3, true], ["experienced", "alumnus", 6, true], ["experienced", "alumnus", 6.1, false],
  ];
  it.each(cases)("%s role, %s with %s years → %s", (type, status, years, fits) => {
    const r = role({ type, yearsExpMin: type === "experienced" ? 3 : 0, yearsExpMax: type === "experienced" ? 6 : 1 });
    expect(fitsType(r, cand({ status, profile: years === undefined ? {} : { years_experience: years } }))).toBe(fits);
  });
  it("gives identity the same rule as query filters", () => {
    expect(candidateFilters(role({ type: "intern" }))).toEqual([{ campusIds: [A], statuses: ["student", "final_year"] }]);
    expect(candidateFilters(role({ type: "fresher" }))).toEqual([{ campusIds: [A], statuses: ["final_year"] }, { campusIds: [A], statuses: ["alumnus"], maxYears: 1 }]);
    expect(candidateFilters(role({ type: "experienced", yearsExpMin: 3, yearsExpMax: 6, campusReach: [A, B] })))
      .toEqual([{ campusIds: [A, B], statuses: ["alumnus"], minYears: 3, maxYears: 6 }]);
  });
});

describe("who is matched at broadcast", () => {
  it("open, verified, not blocked, campus in reach, status fits type", () => {
    expect(isMatchable(role(), cand())).toBe(true);
    expect(isMatchable(role(), cand({ trustStatus: "restricted" }))).toBe(true); // scored, though never nudged
    expect(isMatchable(role(), cand({ openToOpportunities: false }))).toBe(false);
    expect(isMatchable(role(), cand({ verificationState: "verification_pending" }))).toBe(false);
    expect(isMatchable(role(), cand({ verificationState: "referral_pending" }))).toBe(false);
    expect(isMatchable(role(), cand({ trustStatus: "blocked" }))).toBe(false);
    expect(isMatchable(role(), cand({ campusId: B }))).toBe(false);
    expect(isMatchable(role(), cand({ status: "student" }))).toBe(false);
  });
});

describe("who may apply (§8 step 5)", () => {
  it("accepts a verified candidate in reach, even with open_to_opportunities off", () => {
    expect(canApply(role(), cand({ openToOpportunities: false }))).toEqual({ ok: true });
    expect(canApply(role(), cand({ verificationState: "referral_pending" }))).toEqual({ ok: true });
    expect(canApply(role(), cand({ trustStatus: "restricted" }))).toEqual({ ok: true });
  });
  it.each([
    ["a role that is not in broadcast", role({ status: "shortlist_ready" }), cand(), "closed"],
    ["a draft role", role({ status: "draft" }), cand(), "closed"],
    ["a campus outside the reach", role(), cand({ campusId: B }), "campus"],
    ["a status that does not fit the type", role({ type: "intern" }), cand({ status: "alumnus" }), "type"],
    ["a blocked candidate", role(), cand({ trustStatus: "blocked" }), "blocked"],
    ["an unverified candidate", role(), cand({ verificationState: "verification_pending" }), "unverified"],
    ["a rejected candidate", role(), cand({ verificationState: "rejected" }), "unverified"],
  ] as const)("refuses %s", (_what, r, c, code) => {
    expect(canApply(r, c)).toMatchObject({ ok: false, code });
  });
});

describe("the candidate's role board", () => {
  it("lists roles in broadcast that reach the candidate's campus and fit their status", () => {
    const roles = [role({ id: "ok" }), role({ id: "other-campus", campusReach: [B] }), role({ id: "frozen", status: "shortlist_ready" }),
      role({ id: "intern", type: "intern" }), role({ id: "senior", type: "experienced", yearsExpMin: 3, yearsExpMax: 6 })];
    expect(listOpenRolesFor(cand(), roles).map((r) => r.id)).toEqual(["ok", "intern"]);
    expect(listOpenRolesFor(cand({ status: "alumnus", profile: { years_experience: 4 } }), roles).map((r) => r.id)).toEqual(["senior"]);
  });
});

describe("deterministic scorer", () => {
  const r = role({ type: "experienced", yearsExpMin: 3, yearsExpMax: 6, title: "Backend engineer, payments", jd: "You will build ledgers in Go and PostgreSQL with Kafka.", locations: ["Bengaluru"] });
  const strong = cand({ userId: "s", status: "alumnus", profile: { skills: ["Go", "PostgreSQL", "Kafka", "Ledgers"], years_experience: 4, preferred_locations: ["Bengaluru"], current_title: "Backend engineer" } });
  const weak = cand({ userId: "w", status: "alumnus", profile: { skills: ["Figma"], years_experience: 9, preferred_locations: ["Delhi"], current_title: "Designer" } });

  it("scores 0 to 100, higher for a closer profile, with a one-line reason", async () => {
    const [a, b] = [await deterministicScorer.score(r, strong), await deterministicScorer.score(r, weak)];
    expect(a.fitScore).toBe(100);
    expect(b.fitScore).toBeGreaterThanOrEqual(0);
    expect(a.fitScore).toBeGreaterThan(b.fitScore);
    expect(a.fitReason).toBe("Lists Go, PostgreSQL, Kafka, Ledgers from the role; 4 years against a 3 to 6 band; prefers Bengaluru.");
    expect(b.fitReason).toContain("No listed skill appears in the role");
  });
  it("is deterministic", async () => {
    expect(await deterministicScorer.score(r, strong)).toEqual(await deterministicScorer.score(r, strong));
  });
  it("matches skills as whole terms and copes with an empty profile", async () => {
    const java = await deterministicScorer.score(role({ jd: "We write JavaScript." }), cand({ profile: { skills: ["Java"] } }));
    expect(java.fitReason).toContain("No listed skill");
    const empty = await deterministicScorer.score(r, cand({ status: "alumnus" }));
    expect(empty.fitScore).toBeGreaterThanOrEqual(0);
    expect(empty.fitScore).toBeLessThanOrEqual(100);
  });
  it("fixedScorer replays fixture scores", async () => {
    const s = fixedScorer({ s: 91 }, 40);
    expect((await s.score(r, strong)).fitScore).toBe(91);
    expect((await s.score(r, weak)).fitScore).toBe(40);
  });
});
