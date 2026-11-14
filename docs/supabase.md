# Running Zenhyre 2.0 on Supabase

Zenhyre 2.0 shares the Supabase project with 1.0 (Singapore, `ap-southeast-1`; Postgres 17) without touching 1.0. Host the API in the same region:

| | 1.0 | 2.0 |
|---|---|---|
| Tables | `public` | `zenhyre2` (owned by the `zenhyre_api` role) |
| Reachable through Supabase's REST API | yes (RLS) | no: not exposed, and `anon`/`authenticated` are revoked |
| Users | Supabase Auth (`auth.users`) | the same Supabase Auth: `zenhyre2.user.id` = `auth.users.id` |
| Emails | Supabase templates / Resend | Resend, sent by the 2.0 API with its own templates |

Because the users are shared, anyone with a 1.0 account signs in to 2.0 with the same address and gets the same id. 2.0 never asks Supabase to send an email and never changes the project's email templates, redirect URLs or auth settings, all of which 1.0 depends on.

## How sign-in works

1. `POST /auth/magic-link` (API) asks Supabase for a one-time token with the admin `generateLink` call (creating the auth user if the address is new) and emails `APP_BASE_URL/auth/redeem?t=…` through Resend. Limited to 5 links per address and 30 per client IP per 15 minutes.
2. The person presses "Finish logging in". The web app posts the token to `POST /auth/redeem`, which calls Supabase `verifyOtp`, creates the `zenhyre2.user` on first sign-in, and accepts any company or association invite waiting for that address (one email, one role).
3. The web app stores the access token (`zh_session`, one hour), the refresh token (`zh_refresh`) and the expiry (`zh_exp`) as HTTP-only cookies. `apps/prototype/src/proxy.ts` refreshes through `POST /auth/refresh` shortly before expiry.
4. The API verifies each access token by its algorithm. Asymmetric tokens are checked locally against the project's JWKS. HS256 tokens (this project, as of 2026-11-14: it still signs with the legacy JWT secret and publishes no signing keys) are checked locally if `SUPABASE_JWT_SECRET` is set, and otherwise by asking Supabase (`GET /auth/v1/user`, cached for a minute). Set the secret, or move the project to signing keys, to avoid that round trip. The browser never talks to the API or to Supabase.

The code is in `services/api/src/auth/`. `AUTH_PROVIDER=fake` swaps in an in-memory provider for offline dev; the tests use the same fake.

## Status (2026-11-14)

`setup.sql` has been run, the migrations and seed are applied (19 tables in `zenhyre2`, 23 campuses), 1.0's `public` tables were compared before and after and are unchanged, and a real sign-in (link → redeem → `/me` → refresh → sign-out) was tested against the project and its test user removed.

## First-time setup

1. **Rotate the project's keys first** if they may have leaked (1.0's repo shipped malware that read env vars, see novare-talent/Frontend_Only PR #19): new service role key / JWT signing key and a new database password.
2. In the SQL editor, run [`packages/db/supabase/setup.sql`](../packages/db/supabase/setup.sql) as `postgres`, with a long random password in place of the placeholder.
3. Point `DATABASE_URL` at the `zenhyre_api` role through the **session pooler** (port 5432), which works over IPv4:
   `postgres://zenhyre_api.<project-ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`
   URL-encode the password (`+` → `%2B`, `/` → `%2F`, `=` → `%3D`).
   The transaction pooler (port 6543) also works for the API (prepared statements are switched off automatically), but run migrations through the session pooler or a direct connection.
4. `pnpm db:migrate && pnpm db:seed` with that `DATABASE_URL`.
5. Make yourself staff after your first sign-in:
   ```sql
   update zenhyre2."user" set is_staff = true
   where id = (select user_id from zenhyre2.user_email where email = 'you@novaretalent.com');
   ```

## Checked 2026-11-14: 1.0 has no sign-up trigger

`auth.users` has no user-defined triggers, so 2.0 sign-ups do not create 1.0 `profiles` rows. Re-check if 1.0 adds one.

### How to re-check

If 1.0 has a trigger on `auth.users` that creates a `public.profiles` row for every new user, every new 2.0 sign-up will also get a 1.0 profile. Check with:

```sql
select tgname, pg_get_triggerdef(t.oid) from pg_trigger t
join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal;
```

If there is one, decide whether 2.0 users should appear in 1.0 (probably not): the trigger can skip users whose `raw_user_meta_data->>'app'` is `'zenhyre2'`, which the API would then set when it creates a user.

## Tests never touch Supabase

`pnpm test` creates and drops throwaway databases on the server in `DATABASE_URL`. Point it at the local Postgres from `scripts/test-db.sh`, never at Supabase.
