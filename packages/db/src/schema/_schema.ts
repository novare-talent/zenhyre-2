import { pgSchema } from "drizzle-orm/pg-core";

/**
 * Zenhyre 2.0 lives in its own Postgres schema so it can share the Supabase project with 1.0
 * (which owns `public`) without name clashes, and so nothing here is exposed through PostgREST.
 */
export const z2 = pgSchema("zenhyre2");
