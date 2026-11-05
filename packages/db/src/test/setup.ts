import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, Db } from "../index";

const DEFAULT_URL = "postgres://zenhyre:zenhyre@localhost:5433/zenhyre";

/**
 * Creates a fresh *database* per test file so files can run in parallel.
 * (Per-schema isolation does not work: drizzle-kit's generated SQL hard-codes `"public".` on enums and FK targets.)
 */
export async function testDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const name = "t_" + Math.random().toString(36).slice(2, 10);
  const baseUrl = process.env.DATABASE_URL ?? DEFAULT_URL;
  const admin = createDb(baseUrl);
  await admin.db.execute(sql.raw(`CREATE DATABASE ${name}`));
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  const { db, close } = createDb(url.toString());
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  return {
    db,
    close: async () => {
      await close();
      await admin.db.execute(sql.raw(`DROP DATABASE ${name}`));
      await admin.close();
    },
  };
}
