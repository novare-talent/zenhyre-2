-- One-time setup of Zenhyre 2.0 inside the shared Supabase project (1.0 keeps `public`).
-- Run as `postgres` in the Supabase SQL editor. Replace the password first, and keep it out of git.
-- Idempotent: safe to run again.

-- 1. The API's own login. It owns the zenhyre2 schema and nothing else.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'zenhyre_api') then
    create role zenhyre_api login password 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';
  end if;
end $$;
-- Let `postgres` manage objects zenhyre_api owns (needed to run the schema creation below as postgres).
grant zenhyre_api to postgres;

-- 2. The schema. Migrations (`pnpm db:migrate`, run as zenhyre_api) create every table inside it.
create schema if not exists zenhyre2 authorization zenhyre_api;
-- pg-boss keeps its job tables in its own schema, also owned by the API.
create schema if not exists pgboss authorization zenhyre_api;

-- 3. Nothing in these schemas is reachable through Supabase's REST/GraphQL APIs (anon/authenticated keys).
--    They are not in the API's exposed schemas either; this is the second lock.
revoke all on schema zenhyre2 from public, anon, authenticated;
revoke all on schema pgboss from public, anon, authenticated;
alter default privileges for role zenhyre_api in schema zenhyre2 revoke all on tables from public, anon, authenticated;
alter default privileges for role zenhyre_api in schema zenhyre2 revoke all on sequences from public, anon, authenticated;
alter default privileges for role zenhyre_api in schema zenhyre2 revoke all on functions from public, anon, authenticated;

-- 4. zenhyre_api must not touch 1.0's data. The 1.0 -> 2.0 migration (spec §15) will get its own read-only grant then.
revoke all on all tables in schema public from zenhyre_api;
