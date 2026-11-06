export type Seat = "candidate" | "company" | "association";
export type SeatDecision =
  | { kind: "seat"; seat: Seat; notice: boolean } // seated; notice when they asked for a role this email does not hold
  | { kind: "setup"; seat: Seat | null }           // signed in, no role yet: first-time setup (or the chooser when null)
  | { kind: "refuse" };                            // asked for the association seat without access issued by Novare

/**
 * One login, one seat. `intent` is the role picked on the login form (or implied by an invite link);
 * `held` is what the API says this person actually is.
 */
export function decideSeat(intent: Seat | null, held: Seat[]): SeatDecision {
  if (intent && held.includes(intent)) return { kind: "seat", seat: intent, notice: false };
  if (held.length) return { kind: "seat", seat: held[0]!, notice: intent !== null };
  if (intent === "association") return { kind: "refuse" };
  return { kind: "setup", seat: intent };
}
