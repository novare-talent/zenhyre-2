import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export const DB_SCHEMA = "zenhyre2";

export function createDb(url = process.env.DATABASE_URL!): { db: Db; close: () => Promise<void> } {
  // Supabase's transaction pooler (port 6543) does not support prepared statements.
  const prepare = new URL(url).port !== "6543";
  const client = postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    prepare,
    onnotice: () => {},
    // Raw SQL that names a table without a schema resolves to Zenhyre's schema first.
    connection: { search_path: `${DB_SCHEMA},public` },
  });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

export { schema };
