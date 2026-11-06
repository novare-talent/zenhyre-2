import { DomainError, Invalid, NotFound } from "@zenhyre/shared";
import { AppDeps } from "../context";
import { inTx, requireStaff, User } from "./tx";

/**
 * §3.3 mergeCompanies (staff, §6.4): a duplicate company is folded into the survivor. Its roles move first, because
 * a role points at its company, then its users join the survivor as members and the absorbed company is deleted.
 */
export async function mergeCompanies(deps: AppDeps, input: { survivorId: string; absorbedId: string; user: User; note?: string }) {
  requireStaff(input.user);
  if (input.survivorId === input.absorbedId) throw new Invalid("a company cannot be merged into itself");
  return inTx(deps, async (w) => {
    const survivor = await w.m.identity.getCompany(input.survivorId);
    const absorbed = await w.m.identity.getCompany(input.absorbedId);
    if (!survivor || !absorbed) throw new NotFound("company");
    // A merge re-seats the absorbed company's users as unlocked members of the survivor, so it must not become a way
    // around a ban on either side.
    if (survivor.status === "banned" || absorbed.status === "banned") throw new DomainError("not_mergeable", "A banned company cannot be merged; lift the ban first.", 409);
    const rolesMoved = await w.m.roles.reassignCompany(absorbed.id, survivor.id);
    await w.m.identity.mergeCompanies({ survivorId: survivor.id, absorbedId: absorbed.id });
    const note = [`absorbed ${absorbed.name} (${absorbed.id}); ${rolesMoved} roles moved`, input.note?.trim()].filter(Boolean).join(". ");
    await w.m.ops.audit(input.user.id, "company.merge", "company", survivor.id, note);
    return { company: survivor, rolesMoved };
  });
}
