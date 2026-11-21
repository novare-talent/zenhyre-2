import { describe, expect, it } from "vitest";
import { ACTOR_KINDS, OPEN_STATUSES, ROLE_STATUSES, TERMINAL_STATUSES, canTransition, type ActorKind, type RoleStatus } from "../src/index";

// §5, written out by hand: every legal move and who may make it. Everything else must be refused.
const LEGAL: Array<[RoleStatus, RoleStatus, ActorKind[]]> = [
  ["draft", "gated", ["company", "staff"]],
  ["gated", "terms_pending", ["system", "staff"]],
  ["gated", "rejected", ["system", "staff"]],
  ["rejected", "gated", ["company", "staff"]],
  ["terms_pending", "deposit_pending", ["company", "staff"]],
  ["deposit_pending", "broadcast", ["staff", "system"]],
  ["broadcast", "shortlist_ready", ["system", "staff"]],
  ["shortlist_ready", "closing", ["company", "staff", "system"]],
  ["closing", "shortlist_ready", ["company", "staff", "system"]],
  ["closing", "closed", ["system", "staff"]],
  ...OPEN_STATUSES.map((s): [RoleStatus, RoleStatus, ActorKind[]] => [s, "withdrawn", ["company", "staff", "system"]]),
];
const allowed = (from: RoleStatus, to: RoleStatus) => LEGAL.find(([f, t]) => f === from && t === to)?.[2] ?? [];

describe("role lifecycle table (§5)", () => {
  for (const from of ROLE_STATUSES) for (const to of ROLE_STATUSES) for (const by of ACTOR_KINDS) {
    const legal = allowed(from, to).includes(by);
    it(`${from} → ${to} by ${by} is ${legal ? "legal" : "illegal"}`, () => {
      expect(canTransition(from, to, by)).toBe(legal);
    });
  }

  it("covers all ten statuses, six open and three terminal", () => {
    expect(ROLE_STATUSES).toHaveLength(10);
    expect([...OPEN_STATUSES].sort()).toEqual(["broadcast", "deposit_pending", "draft", "gated", "shortlist_ready", "terms_pending"]);
    expect([...TERMINAL_STATUSES].sort()).toEqual(["closed", "rejected", "withdrawn"]);
  });
  it("withdraw: every open state, never closing and never a terminal state", () => {
    for (const s of ROLE_STATUSES) expect(canTransition(s, "withdrawn", "company")).toBe(OPEN_STATUSES.includes(s));
  });
  it("closed and withdrawn have no exits; rejected has only the appeal", () => {
    for (const to of ROLE_STATUSES) for (const by of ACTOR_KINDS) {
      expect(canTransition("closed", to, by)).toBe(false);
      expect(canTransition("withdrawn", to, by)).toBe(false);
      if (to !== "gated") expect(canTransition("rejected", to, by)).toBe(false);
    }
  });
  it("a company can never waive its own deposit, decide its own gate or close a role itself", () => {
    expect(canTransition("deposit_pending", "broadcast", "company")).toBe(false);
    expect(canTransition("deposit_pending", "broadcast", "system")).toBe(true); // only on a paid deposit (service.transition checks)
    expect(canTransition("gated", "terms_pending", "company")).toBe(false);
    expect(canTransition("closing", "closed", "company")).toBe(false);
  });
});
