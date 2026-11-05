import { and, desc, eq } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";
export function createAudit(db: DbOrTx) {
  return {
    async audit(actorUserId: string, action: string, refType: string, refId: string, note?: string) {
      await db.insert(schema.staffAction).values({ actorUserId, action, refType, refId, note });
    },
    async listAudit(f: { refType?: string; refId?: string }) {
      const conds = [];
      if (f.refType) conds.push(eq(schema.staffAction.refType, f.refType));
      if (f.refId) conds.push(eq(schema.staffAction.refId, f.refId));
      return db.select().from(schema.staffAction).where(and(...conds)).orderBy(desc(schema.staffAction.at));
    },
  };
}
