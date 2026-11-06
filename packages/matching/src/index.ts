import { DbOrTx } from "@zenhyre/db";
import { Clock, systemClock } from "@zenhyre/shared";
import { CandidateDirectory, createMatchingModule } from "./service";
import { Scorer, deterministicScorer } from "./scorer";
export * from "./stages";
export * from "./filter";
export * from "./scorer";
export type { Match, MatchEvent, CandidateDirectory, RoleContext, StageData, RerankResult, ApplyResult } from "./service";

export interface MatchingDeps {
  /** `identity`, or anything else that can report candidates' verification and trust state. */
  candidates: CandidateDirectory;
  clock?: Clock;
  /** Defaults to the deterministic rubric scorer; the embedding + rerank scorer replaces it in a later slice. */
  scorer?: Scorer;
}
export type Matching = ReturnType<typeof createMatchingModule> & { withDb(tx: DbOrTx): Matching };
export function createMatching(db: DbOrTx, deps: MatchingDeps): Matching {
  return {
    ...createMatchingModule(db, deps.clock ?? systemClock, deps.scorer ?? deterministicScorer, deps.candidates),
    withDb: (tx) => createMatching(tx, { ...deps, candidates: deps.candidates.withDb(tx) }),
  };
}
