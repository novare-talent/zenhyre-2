// §5 role lifecycle as data: which status may follow which, and who may make the move. Pure.

export const ROLE_STATUSES = [
  "draft", "gated", "rejected", "terms_pending", "deposit_pending", "broadcast", "shortlist_ready", "closing", "closed", "withdrawn"] as const;
export type RoleStatus = (typeof ROLE_STATUSES)[number];

/** Who is making the move. Staff may make any legal move (§12: "every role transition" is a staff action). */
export const ACTOR_KINDS = ["company", "staff", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];
export interface Actor { kind: ActorKind; userId?: string }
export const SYSTEM: Actor = { kind: "system" };
/** What goes in an event's `actor` column: the user id, or "system". */
export const actorRef = (a: Actor): string => (a.kind === "system" ? "system" : a.userId ?? a.kind);

/** Can be withdrawn. `closing` is neither open nor terminal: it resolves on its own. */
export const OPEN_STATUSES: readonly RoleStatus[] = ["draft", "gated", "terms_pending", "deposit_pending", "broadcast", "shortlist_ready"];
/** `rejected` leaves only by appeal; `closed` and `withdrawn` never leave. */
export const TERMINAL_STATUSES: readonly RoleStatus[] = ["closed", "withdrawn", "rejected"];

const ANYONE: readonly ActorKind[] = ["company", "staff", "system"];

/**
 * Every legal move and who may make it. Anything not listed is illegal.
 * `deposit_pending → broadcast`: staff by the waiver, or `system` when the gateway confirms the deposit is paid.
 */
export const TRANSITIONS: Readonly<Record<RoleStatus, Partial<Record<RoleStatus, readonly ActorKind[]>>>> = {
  draft: { gated: ["company", "staff"], withdrawn: ANYONE },
  gated: { terms_pending: ["system", "staff"], rejected: ["system", "staff"], withdrawn: ANYONE },
  rejected: { gated: ["company", "staff"] },
  terms_pending: { deposit_pending: ["company", "staff"], withdrawn: ANYONE },
  deposit_pending: { broadcast: ["staff", "system"], withdrawn: ANYONE },
  broadcast: { shortlist_ready: ["system", "staff"], withdrawn: ANYONE },
  shortlist_ready: { closing: ANYONE, withdrawn: ANYONE },
  closing: { shortlist_ready: ANYONE, closed: ["system", "staff"] },
  closed: {},
  withdrawn: {},
};

export function canTransition(from: RoleStatus, to: RoleStatus, by: ActorKind): boolean {
  return TRANSITIONS[from][to]?.includes(by) ?? false;
}
