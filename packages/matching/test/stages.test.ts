import { describe, expect, it } from "vitest";
import { MATCH_ACTOR_KINDS, MATCH_STAGES, QUALIFYING_STAGES, SETTLED_STAGES, allowedActors, canMove, guaranteeEndsAt, isSettled, withdrawTarget,
  type MatchActorKind, type MatchStage } from "../src/index";

// §4.3, written out by hand row by row. Everything not produced here must be refused.
const OPEN: MatchStage[] = ["scored", "applied", "pending_approval", "shortlisted", "viewed", "interviewed", "offered", "offer_accepted"];
const rows: Array<[MatchStage | MatchStage[], MatchStage, MatchActorKind[]]> = [
  ["scored", "applied", ["candidate"]],
  ["applied", "pending_approval", ["system"]],
  ["pending_approval", "applied", ["staff"]],
  ["pending_approval", "declined_by_staff", ["staff"]],
  ["applied", "shortlisted", ["system"]],
  ["shortlisted", "applied", ["system"]],
  ["shortlisted", "viewed", ["company"]],
  ["viewed", "interviewed", ["company"]],
  ["interviewed", "offered", ["company"]],
  ["offered", "offer_accepted", ["company"]],
  ["offer_accepted", "hired", ["company"]],
  ["offer_accepted", "offer_reneged", ["company", "candidate"]],
  [["shortlisted", "viewed", "interviewed", "offered", "offer_accepted"], "rejected", ["company"]],
  [["applied", "shortlisted", "viewed", "interviewed", "offered"], "withdrawn", ["candidate"]],
  ["hired", "did_not_join", ["company", "staff", "system"]],
  ["hired", "left_early", ["company"]],
  [OPEN, "declined_by_staff", ["staff", "system"]],
  [OPEN, "role_closed", ["system"]],
  [MATCH_STAGES.filter((s) => s !== "hired"), "hired", ["staff"]],
];
function expected(from: MatchStage, to: MatchStage): Set<MatchActorKind> {
  const kinds = new Set<MatchActorKind>();
  for (const [froms, t, who] of rows) if (t === to && (Array.isArray(froms) ? froms : [froms]).includes(from)) who.forEach((k) => kinds.add(k));
  return kinds;
}

describe("match stage table (§4.3)", () => {
  for (const from of MATCH_STAGES) for (const to of MATCH_STAGES) for (const by of MATCH_ACTOR_KINDS) {
    const legal = expected(from, to).has(by);
    it(`${from} → ${to} by ${by} is ${legal ? "legal" : "illegal"}`, () => {
      expect(canMove(from, to, by)).toBe(legal);
    });
  }

  it("has sixteen stages, eight of them settled", () => {
    expect(MATCH_STAGES).toHaveLength(16);
    expect([...SETTLED_STAGES].sort()).toEqual(["declined_by_staff", "did_not_join", "hired", "left_early", "offer_reneged", "rejected", "role_closed", "withdrawn"]);
    expect(MATCH_STAGES.filter((s) => !isSettled(s)).sort()).toEqual([...OPEN].sort());
  });
  it("settled stages are never closed or declined", () => {
    for (const s of SETTLED_STAGES) {
      expect(allowedActors(s, "role_closed")).toEqual([]);
      expect(allowedActors(s, "declined_by_staff")).toEqual([]);
    }
  });
  it("only hired has an exit among settled stages, apart from the staff override to hired", () => {
    for (const s of SETTLED_STAGES) for (const to of MATCH_STAGES) {
      if (s === "hired" && (to === "did_not_join" || to === "left_early")) continue;
      expect(allowedActors(s, to)).toEqual(to === "hired" && s !== "hired" ? ["staff"] : []);
    }
  });
  it("no stage moves to itself", () => {
    for (const s of MATCH_STAGES) expect(allowedActors(s, s)).toEqual([]);
  });
  it("qualifying actions are interviewed, offered and rejected; viewed does not count", () => {
    expect([...QUALIFYING_STAGES].sort()).toEqual(["interviewed", "offered", "rejected"]);
  });
  it("a candidate's withdraw becomes offer_reneged from offer_accepted, and is unavailable where the table has no row", () => {
    expect(withdrawTarget("offer_accepted")).toBe("offer_reneged");
    for (const s of ["applied", "shortlisted", "viewed", "interviewed", "offered"] as const) expect(withdrawTarget(s)).toBe("withdrawn");
    for (const s of ["scored", "pending_approval", "hired", "rejected", "withdrawn", "role_closed", "did_not_join"] as const) expect(withdrawTarget(s)).toBeNull();
  });
  it("a replacement guarantee runs to the end of its last day, joined_on + days, in UTC", () => {
    expect(guaranteeEndsAt("2026-11-10", 90).toISOString()).toBe("2027-02-09T00:00:00.000Z"); // 8 February is day 90
    expect(guaranteeEndsAt("2026-12-01", 0).toISOString()).toBe("2026-12-02T00:00:00.000Z");
  });
});
