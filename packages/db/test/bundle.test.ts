// supabase/apply-migrations.sql (the SQL-editor route) against a fresh database set up like Supabase: idempotent,
// owned by zenhyre_api, and indistinguishable from `pnpm db:migrate` afterwards.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, DB_SCHEMA } from "../src/index";

const baseUrl = process.env.DATABASE_URL ?? "postgres://zenhyre:zenhyre@localhost:5433/zenhyre";
const name = "b_" + Math.random().toString(36).slice(2, 10);
const admin = createDb(baseUrl);
let target: ReturnType<typeof createDb>;
const rows = async (q: string) => (await target.db.execute(sql.raw(q))) as unknown as Array<Record<string, any>>;

beforeAll(async () => {
  // Regenerate first, so the test checks the bundle that matches the migrations on disk.
  execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/bundle-sql.mjs", import.meta.url))]);
  await admin.db.execute(sql.raw(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'zenhyre_api') then create role zenhyre_api login; end if; end $$`));
  await admin.db.execute(sql.raw(`create database ${name}`));
  const url = new URL(baseUrl); url.pathname = `/${name}`;
  target = createDb(url.toString());
  // As setup.sql does on Supabase.
  await target.db.execute(sql.raw(`grant zenhyre_api to current_user; grant create on database ${name} to zenhyre_api;
    create schema if not exists zenhyre2 authorization zenhyre_api;`));
});
afterAll(async () => {
  await target?.close();
  await admin.db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  await admin.close();
});

describe("apply-migrations.sql", () => {
  const bundle = () => readFileSync(new URL("../supabase/apply-migrations.sql", import.meta.url), "utf8");
  it("applies every migration once, as zenhyre_api", async () => {
    await target.db.execute(sql.raw(bundle()));
    await target.db.execute(sql.raw(bundle())); // second run: everything skipped
    const journal = await rows(`select count(*) as n from zenhyre2.__drizzle_migrations`);
    const entries = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")).entries;
    expect(Number(journal[0]!.n)).toBe(entries.length);
    const owners = await rows(`select distinct tableowner from pg_tables where schemaname = 'zenhyre2'`);
    expect(owners.map((o) => o.tableowner)).toEqual(["zenhyre_api"]);
    const tables = (await rows(`select tablename from pg_tables where schemaname = 'zenhyre2'`)).map((t) => t.tablename);
    expect(tables).toEqual(expect.arrayContaining(["payment_order", "deposit_settlement", "ledger_entry", "invoice", "company_billing", "legacy_profile", "legacy_job"]));
  });
  it("leaves nothing for `pnpm db:migrate` to do", async () => {
    await migrate(target.db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)), migrationsSchema: DB_SCHEMA });
    const journal = await rows(`select count(*) as n from zenhyre2.__drizzle_migrations`);
    const entries = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")).entries;
    expect(Number(journal[0]!.n)).toBe(entries.length);
  });
});
