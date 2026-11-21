# Zenhyre 2.0 on the shared Supabase project: what to run, in order

Project `NovareTalent` (`mfkmwkyatoczkrqawffk`, ap-southeast-1). 1.0 lives in `public` and is never changed by any of
this: 2.0 only ever reads it, once, during the import. Everything 2.0 owns is in `zenhyre2`.

State on 2026-11-21 (from a schema dump): `setup.sql` done, migrations 0000–0002 applied, 23 campuses seeded, one 2.0 user.
Still to do: migrations 0003 (payments), 0004 (legacy 1.0 tables) and 0005 (person columns on `user`, the `profiles` view), then the 1.0 import.

| # | File | Run as | What it does | Re-runnable |
|---|---|---|---|---|
| 1 | `setup.sql` | `postgres`, SQL editor | The `zenhyre_api` role and the `zenhyre2` / `pgboss` schemas. **Already done**; skip unless setting up a new project | yes |
| 2 | `apply-migrations.sql` | `postgres`, SQL editor | All 2.0 migrations (0000–0005), skipping those already applied: payments tables (`payment_order`, `deposit_settlement`, `ledger_entry`, `invoice`, `invoice_counter`, `company_billing`, `payment_webhook_event`, `user.is_finance`, `request_deposit_settlement()`) the legacy tables, and the person columns on `user` (`first_name`, `last_name`, `phone`, `github_link`, `linkedin_link`, `profile_image`, `resume_url`, `is_subscribed`, `updated_at`, as in 1.0) plus the `zenhyre2.profiles` view in exactly 1.0's `public.profiles` shape. Creates them as `zenhyre_api`. Same result as `pnpm db:migrate` (step 2 alternative) | yes |
| 3 | `import-from-1.0.sql` | `postgres`, SQL editor | Creates `zenhyre2.import_from_v1()`. Creating it changes no data | yes |
| 4 | `select zenhyre2.import_from_v1();` | `postgres`, SQL editor | **Dry run**: imports nothing, returns the report (counts, conflicts, clients on personal email, admins). Check it | yes |
| 5 | `select zenhyre2.import_from_v1(p_dry_run => false);` | `postgres`, SQL editor | The import. Add `, p_grant_staff => true` to make 1.0 admins 2.0 staff. Run again just before switching over to pick up new 1.0 sign-ups | yes |
| 6 | the SQL below | `postgres`, SQL editor | Make yourself staff with finance access | yes |

Step 2 alternative, from a terminal: put the `zenhyre_api` `DATABASE_URL` in `services/api/.env`, then
`pnpm db:migrate`. Do not use both at the same moment; one after the other is fine.

Step 6:

```sql
update zenhyre2."user" set is_staff = true, is_finance = true
where id = (select user_id from zenhyre2.user_email where email = 'you@novaretalent.com');
```

Check afterwards:

```sql
select count(*) from zenhyre2.__drizzle_migrations;              -- 6
select * from zenhyre2.profiles limit 5;                         -- same columns as public.profiles
select report from zenhyre2.legacy_import_run order by started_at desc limit 1;
select legacy_role, count(*) from zenhyre2.legacy_profile group by 1;
```

## What the import does with 1.0's data

- **profiles + auth.users** become `user` and `user_email`. The ids are the same Supabase Auth ids, so people sign in to 2.0 with the same account. Emails are verified exactly as Supabase had them.
- **Clients on a work domain** become one `company` per domain. The earliest client is the owner and the rest are members.
- **Clients on a personal address** (Gmail and the like) are listed in the report. 2.0 needs a work domain to verify a company, so they are imported as users only.
- **Candidates** get no `candidate` row. 2.0 needs a campus, graduation date and course, which 1.0 never asked for. Their names, phone, links, resume text and campus hint go to `legacy_profile` for onboarding.
- **jobs + forms + evaluations** become `legacy_job`, and **responses** become `legacy_application`. They are kept as history, not live roles.
- **onboarding, client_submission, signed_contracts, bot_fulltime_leads, subscriptions and assignments** are copied row for row to `legacy_record`.
- **Not imported:**
  - `job_email_queue`, `rankings_sighire` and `candidate_mappings`, which are 1.0's working state.
  - Resume embeddings; 2.0 recomputes them.
- **People whose email already belongs to a different 2.0 user** are left out and listed under `conflicts`.

Tests: `packages/db/test/import-v1.test.ts` (a stand-in 1.0 database) and `packages/db/test/bundle.test.ts`. If a
migration is added, regenerate step 2's file with `pnpm --filter @zenhyre/db sql:bundle`.
