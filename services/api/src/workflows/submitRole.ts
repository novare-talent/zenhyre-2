import { AppDeps } from "../context";
import { inTx, roleActor, User } from "./tx";

/** §3.3 submitRole: draft → gated, then the gate job. The gate, not this call, judges the content (§7). */
export async function submitRole(deps: AppDeps, input: { roleId: string; user: User }) {
  return inTx(deps, async (w) => {
    const role = await w.m.roles.require(input.roleId);
    const submitted = await w.m.roles.submit(role.id, await roleActor(w, input.user, role));
    w.after(() => deps.jobs.enqueue("role.gate", { roleId: role.id }));
    return submitted;
  });
}
