import { eq, sql } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";

export function createCampus(db: DbOrTx) {
  return {
    async seedCampuses(rows: Array<{ name: string; shortCode: string; emailDomains: string[]; rollNumberRegex: string | null; internalTier: number }>) {
      for (const r of rows) await db.insert(schema.campus).values(r).onConflictDoNothing();
    },
    async campusForEmail(email: string) {
      const domain = email.toLowerCase().split("@")[1] ?? "";
      const [row] = await db.select().from(schema.campus).where(sql`${domain} = ANY(${schema.campus.emailDomains})`);
      return row ?? null;
    },
    async campusByShortCode(code: string) {
      const [row] = await db.select().from(schema.campus).where(eq(schema.campus.shortCode, code));
      return row ?? null;
    },
    async listCampuses() { return db.select().from(schema.campus); },
  };
}
