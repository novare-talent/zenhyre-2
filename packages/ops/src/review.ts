import { and, eq, inArray, isNull, lte, or, desc, sql } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";

type Kind = (typeof schema.reviewKind.enumValues)[number];

export interface OpenReviewInput {
  kind: Kind; refType: string; refId: string; associationId: string | null; payload: Record<string, unknown>;
}
export interface ListReviewsFilter {
  kind?: Kind; open?: boolean; associationId?: string;
  /** staff queue: unscoped items, scoped items older than escapeHatchDays, and items scoped to adminlessAssociationIds (§6.2) */
  staffQueue?: boolean; escapeHatchDays?: number; adminlessAssociationIds?: string[];
}

export function createReview(db: DbOrTx) {
  return {
    /** Idempotent per open kind+ref. The partial unique index makes the insert race-safe; on conflict we re-select. */
    async openReview(input: OpenReviewInput) {
      const openFor = () => db.select().from(schema.reviewItem).where(and(
        eq(schema.reviewItem.kind, input.kind), eq(schema.reviewItem.refType, input.refType),
        eq(schema.reviewItem.refId, input.refId), isNull(schema.reviewItem.resolvedAt)));
      const [inserted] = await db.insert(schema.reviewItem).values(input).onConflictDoNothing().returning();
      if (inserted) return inserted;
      const [existing] = await openFor();
      return existing!;
    },
    async resolveReview(id: string, resolvedBy: string, resolution: string) {
      const [row] = await db.update(schema.reviewItem)
        .set({ resolvedAt: new Date(), resolvedBy, resolution })
        .where(and(eq(schema.reviewItem.id, id), isNull(schema.reviewItem.resolvedAt))).returning();
      return row ?? null;
    },
    /** Merges `patch` into an open item's payload, e.g. the company's answer on a join dispute. */
    async amendReview(id: string, patch: Record<string, unknown>) {
      const [row] = await db.update(schema.reviewItem).set({ payload: sql`${schema.reviewItem.payload} || ${JSON.stringify(patch)}::jsonb` })
        .where(and(eq(schema.reviewItem.id, id), isNull(schema.reviewItem.resolvedAt))).returning();
      return row ?? null;
    },
    async getReview(id: string) {
      const [row] = await db.select().from(schema.reviewItem).where(eq(schema.reviewItem.id, id));
      return row ?? null;
    },
    async listReviews(f: ListReviewsFilter) {
      const conds = [];
      if (f.kind) conds.push(eq(schema.reviewItem.kind, f.kind));
      if (f.open) conds.push(isNull(schema.reviewItem.resolvedAt));
      if (f.associationId) conds.push(eq(schema.reviewItem.associationId, f.associationId));
      if (f.staffQueue) {
        const days = f.escapeHatchDays ?? 7;
        const cutoff = sql`now() - make_interval(days => ${days})`;
        const visible = [isNull(schema.reviewItem.associationId), lte(schema.reviewItem.openedAt, cutoff)];
        if (f.adminlessAssociationIds?.length) visible.push(inArray(schema.reviewItem.associationId, f.adminlessAssociationIds));
        conds.push(or(...visible)!);
      }
      return db.select().from(schema.reviewItem).where(and(...conds)).orderBy(desc(schema.reviewItem.openedAt));
    },
  };
}
