import { AppDeps } from "../context";
import type { CandidateProfile } from "@zenhyre/db/schema";
/** §3.3 saveProfile. Embedding job enqueue is added in Plan 1B when matching exists. */
export async function saveProfile(deps: AppDeps, userId: string, patch: CandidateProfile) {
  return deps.identity.saveProfile(userId, patch);
}
