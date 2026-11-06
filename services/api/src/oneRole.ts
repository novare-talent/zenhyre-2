import type { Identity } from "@zenhyre/identity";
import { DomainError, Invalid } from "@zenhyre/shared";

export type RoleName = "candidate" | "company" | "association";
const A: Record<RoleName, string> = { candidate: "a candidate", company: "a company", association: "an association" };

/** The single role a user holds, from their membership rows (§4.1), or null if they have none yet. */
export async function roleOf(identity: Identity, userId: string): Promise<RoleName | null> {
  const [candidate, membership, associations] = await Promise.all([
    identity.getCandidate(userId), identity.membershipFor(userId), identity.associationsForUser(userId)]);
  return candidate ? "candidate" : membership ? "company" : associations.length ? "association" : null;
}

export class RoleTaken extends DomainError {
  constructor(public readonly held: RoleName) { super("role_taken", `This email is already registered as ${A[held]} account. One email holds one role.`, 409); }
}
/** One email, one role: refuse to give a user a second kind of account. */
export async function assertFreeFor(identity: Identity, userId: string, wanted: RoleName) {
  const held = await roleOf(identity, userId);
  if (held && held !== wanted) throw new RoleTaken(held);
}

const domainOf = (email: string) => email.toLowerCase().split("@")[1] ?? "";
export type EmailKind = "campus" | "personal" | "work";
/** Campus LDAP address, personal mailbox (the configured free-mail providers), or anything else: a work address. */
export async function emailKind(identity: Identity, freemailDomains: readonly string[], email: string): Promise<EmailKind> {
  if (await identity.campusForEmail(email)) return "campus";
  return freemailDomains.includes(domainOf(email)) ? "personal" : "work";
}
/** Candidates sign in with their campus LDAP address or a personal mailbox, never a work address. */
export function assertCandidateEmail(kind: EmailKind) {
  if (kind === "work") throw new Invalid("Candidates log in with a campus LDAP ID or a personal email such as Gmail, Outlook or Yahoo, not a work address.");
}
/** Companies sign in with a work address on their own domain, never a personal mailbox or a campus address. */
export function assertCompanyEmail(kind: EmailKind) {
  if (kind !== "work") throw new Invalid("Companies log in with a work email on the company's own domain. Personal mailboxes and campus addresses are not accepted.");
}
