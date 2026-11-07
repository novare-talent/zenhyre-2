# Zenhyre 2.0 hand-over

Written 2026-11-07, at commit `4e02280` on `feat/slice-1b`. Zenhyre is a three-sided hiring platform for IIT talent, run by Novare Talent: candidates, companies and alumni associations.

The product design is in [the spec](docs/superpowers/specs/2026-11-05-zenhyre-2-design.md). Section references below (§9.2 and so on) point to it. Where this file and the spec disagree, the code decides what exists and the spec decides what was intended.

## Where things stand

The Slice 1 backend is mostly built and tested. The web app is not connected to most of it yet, and there is no staff console, so the full hiring loop can only be walked through API calls today.

| Area | State |
|---|---|
| Login, sessions, one-role rule, candidate and company sign-up | Built, and used by the web app |
| Roles, gate, fee terms, matching, shortlist, hire and join workflows | Built and tested in the API; the web app does not call them |
| Scheduled jobs | Built, on an interim in-process timer |
| Candidate and company pages for roles, applications and shortlists | Show sample data from `apps/prototype/src/data/fixtures.ts` |
| Staff console (§12) | Not built; staff use the `/admin/*` API |
| Association portal | Login only; the rest shows sample data, and the API has no association routes |
| Money (Slice 2), trust (Slice 3), migration from 1.0 (§15) | Not started |

At this commit, a fresh clone installs from the lockfile, builds, and passes all 1,637 tests against Postgres 16.

### Repo state to sort out first

- `main` is behind. All of the above is on `feat/slice-1b` until it is merged.
- There was no git remote at the time of writing.
- There is no CI and no deployment setup (no workflows, no Dockerfile). Hosting is an open choice in §16: Vercel plus Railway, or Fly.

## Get it running

You need Node 22 (the version used so far; nothing pins it), pnpm 10.28 and Postgres 16.

`scripts/test-db.sh` runs a throwaway Postgres on port 5433 with its data in `.test-pg/`. It looks for Postgres in `/usr/lib/postgresql/16/bin`, so on any other layout set `PGBIN`. With Homebrew on a Mac that is `PGBIN=$(brew --prefix postgresql@16)/bin`. Or point `DATABASE_URL` at any Postgres 16 whose user can create databases.

```bash
pnpm install --frozen-lockfile
pnpm test:db:start
export DATABASE_URL=postgres://zenhyre:zenhyre@localhost:5433/zenhyre
pnpm db:migrate && pnpm db:seed
pnpm -r build && pnpm test
```

Then, in two terminals with `DATABASE_URL` set in the first:

```bash
APP_BASE_URL=http://localhost:3000 pnpm --filter @zenhyre/api dev
```

```bash
pnpm --filter @zenhyre/prototype dev
```

The API runs on :4000 and the app on :3000. Things that catch people out:

- **Environment files are not loaded by the API.** Nothing reads `.env` for the API or the database scripts, so export variables in your shell. Next.js does read `apps/prototype/.env.local`.
- **Sign-in links print in the API terminal** when `RESEND_API_KEY` is unset.
- **Starting the API starts the scheduler,** which runs every scheduled job once at start-up against whatever database it is pointed at. Set `SCHEDULER=off` to stop that.
- **Tests make their own databases.** Each test database is created and dropped by `packages/db/src/test/setup.ts`, so a test run does not touch your dev data. `DATABASE_URL` only tells them which server to use.
- **Turbo caches test results.** Use `pnpm test --force` when you want everything to really run.

### Environment variables

| Variable | Used by | Meaning |
|---|---|---|
| `DATABASE_URL` | API, db scripts, tests | Required |
| `APP_BASE_URL` | API | Base of links in emails. Default `http://localhost:3000` |
| `PORT` | API | Default 4000 |
| `RESEND_API_KEY` | API | Sends real email. Unset in dev prints email to the log. **Unset with `NODE_ENV=production` silently drops email**, so sign-in fails with no error |
| `MAIL_FROM` | API | Default `Zenhyre <no-reply@zenhyre.com>` |
| `RESEND_WEBHOOK_SECRET` | API | Verifies `POST /webhooks/resend` |
| `GATE_MODEL` | API | `none` gives dev the production behaviour (see the gate below) |
| `SCHEDULER` | API | `off` disables the in-process timer |
| `NODE_ENV` | API | `production` turns off the dev gate fixture and the email log |
| `API_URL` | Web app | Default `http://localhost:4000` |
| `COOKIE_SECURE` | Web app | `1` or `0` overrides the automatic https detection |

### Becoming staff and walking the loop

There is no staff sign-up. Sign in once, then:

```sql
update "user" set is_staff = true where id = (select user_id from user_email where email = 'you@example.com');
```

To take a role from draft to a shortlist:

1. A company creates and submits a role. In dev, a fixture gate model accepts whatever passes the rules.
2. Staff: `POST /admin/roles/:id/release-terms`. Company: `POST /roles/:id/terms/accept`.
3. Staff: `POST /admin/roles/:id/waive-deposit` with `{ "note": "…" }`. The broadcast job then scores candidates and sends nudges.
4. Candidates apply. Staff: `POST /admin/roles/:id/close-broadcast` with `{ "note": "…" }` to freeze without waiting for the window.
5. The company works the shortlist through `GET /roles/:id/shortlist` and `POST /matches/:id/actions`.

Association logins are created with a script; see `apps/prototype/README.md`.

## How the code is organised

| Where | What |
|---|---|
| `packages/shared` | Clock, domain errors |
| `packages/db` | Drizzle schema, migrations in `drizzle/`, seed, test database setup |
| `packages/ops` | Config keys and defaults (§17), review queue, audit |
| `packages/identity` | Users, magic links, sessions, candidates, companies, associations |
| `packages/notify` | Email and in-app templates, transports |
| `packages/gate` | Role gate rules and the model interface. Pure, no dependencies |
| `packages/roles` | Role lifecycle table, fee terms, deposit waiver |
| `packages/matching` | Filter, apply, ranking, freeze, stage table, the `Scorer` interface |
| `services/api` | Hono API: routes, `workflows/`, `jobs.ts`, `scheduler.ts`, `oneRole.ts` |
| `apps/prototype` | Next.js web app. See its `README.md` and `DESIGN.md` |

Conventions to keep:

- **Anything spanning several packages is a workflow** in `services/api/src/workflows/`. A package owns its tables, and others reach them only through its interface (§3).
- **`inTx` in `workflows/tx.ts`** runs one transaction, then sends email and starts jobs after commit.
- **`closeRole` is the only path into `closed`.** Every role transition writes a `RoleEvent`, and every match move writes a `MatchEvent`.
- **Money is integer paise** (`bigint` in the database). Durations are days unless named otherwise.
- **Tunable numbers live in config** (`packages/ops/src/defaults.ts`), and staff can edit them through `/admin/config`.
- **Candidates never see fit score or rank, and `internal_tier` is never exposed** (§4.1). The view functions in `routes/views.ts` enforce this.
- **The browser never calls the API.** The app's route handlers forward to it and hold the session cookie.

## API reference

All routes need the `zh_session` cookie unless noted. Errors are `{ error, message }` with status 400, 401, 403, 404 or 409, and validation errors are `{ error: "invalid", issues }`.

### Sign-in and account

| Route | Body | Notes |
|---|---|---|
| `POST /auth/magic-link` | `{ email }` | No session needed. Not rate-limited yet |
| `GET /auth/redeem?t=` | | No session needed. Sets the cookie and accepts any invite in the token. Gives no second kind of account: an email that holds one role is not added to another |
| `POST /auth/signout` | | |
| `GET /me` | | User, emails, candidate, campus, membership, company, associations |
| `POST /webhooks/resend` | Resend payload | Signed with `RESEND_WEBHOOK_SECRET` |

An email holds one role: creating a second kind of account returns `409 role_taken`. Candidates use a campus or personal address, and companies use a work address (`services/api/src/oneRole.ts`).

### Candidate

| Route | Body | Returns |
|---|---|---|
| `POST /candidates` | `{ gradDate, course, rollNumber?, campusShortCode?, claimed? }` | `201 { candidate }` |
| `GET /me/profile`, `PUT /me/profile` | profile fields, snake_case | `{ candidate }`, `{ profile }` |
| `PUT /me/open` | `{ open }` | `{ ok }` |
| `POST /me/verification/retry` | | `{ candidate }` |
| `GET /campuses` | | `{ campuses }`, public fields only |
| `GET /me/roles` | | Roles in broadcast that reach my campus and fit my status; nudged first, then closing soonest |
| `GET /me/roles/:id` | | `{ role }`; 404 unless open to me or I applied |
| `POST /me/roles/:id/apply` | | `201 { application }`; 403 with the reason if not eligible, 409 `already_applied` |
| `GET /me/applications` | | `{ applications }`, newest first |
| `POST /me/applications/:id/withdraw` | | `withdrawn`, or `offer_reneged` from `offer_accepted` |
| `POST /me/applications/:id/join` | `{ joined }` | The hired candidate answers the join prompt; 409 `not_actionable` before the prompt, after an answer, or once confirmed |

### Company

An unlocked member of the role's company. Staff pass the access check on role routes such as create, read, edit and withdraw, but cannot act on a shortlist.

| Route | Body | Returns |
|---|---|---|
| `POST /companies` | `{ name }` | `201` |
| `GET /companies/:id` | | `{ company, users }` |
| `POST /companies/:id/invites` | `{ email }` | `{ ok }` |
| `POST /companies/:id/roles` | `{ title, type, jd?, ctcMin?, ctcMax?, yearsExpMin?, yearsExpMax?, locations?, campusReach? }` | `201 { role }`, a draft. `type` is `intern`, `fresher` or `experienced`. `campusReach` takes campus ids or short codes |
| `GET /companies/:id/roles` | | `{ roles }`, newest first |
| `GET /roles/:id` | | `{ role }` |
| `PATCH /roles/:id` | any create field | 409 `not_editable` once submitted |
| `POST /roles/:id/submit` | | `{ role }` after the gate job ran |
| `POST /roles/:id/appeal` | `{ note? }` | Once, within 14 days of rejection |
| `POST /roles/:id/terms/accept` | | `{ role }`; 400 until staff release the terms |
| `POST /roles/:id/withdraw` | `{ note? }` | Also staff. 409 `illegal_transition` from `closing` and terminal states |
| `GET /roles/:id/shortlist` | | `{ role, shortlist }`; 409 `shortlist_not_ready` before `shortlist_ready` |
| `POST /matches/:id/actions` | `{ stage, offeredCtc?, hiredCtc?, joinedOn?, rejectionCategory?, rejectionNote? }` | `{ match, role }`, plus `replacement` on `left_early` |
| `POST /matches/:id/confirm-join` | | `{ ok }`. The company stands by a hire the candidate disputes; 409 if no dispute is open |

Action stages: `viewed`, `interviewed`, `offered` (`offeredCtc`), `offer_accepted`, `offer_reneged`, `hired` (`hiredCtc`, `joinedOn` as YYYY-MM-DD), `rejected` (`rejectionCategory`, optional note), `did_not_join`, `left_early`. An out-of-order move is 409 `illegal_transition`, acting while a hire is recorded is 409 `not_actionable`, and a second hire is 409 `one_hire`.

### Staff

Requires `user.is_staff`.

| Route | Body | Notes |
|---|---|---|
| `GET /admin/roles?status=` | | With applicant counts |
| `GET /admin/roles/:id` | | Row, events, gate decisions, full longlist |
| `PUT /admin/roles/:id/fee-terms` | `{ kind, amount, replacement_guarantee_days, notes? }` | `kind` is `flat` or `percent` |
| `POST /admin/roles/:id/release-terms` | | |
| `POST /admin/roles/:id/waive-deposit` | `{ note }` | Starts the broadcast |
| `POST /admin/roles/:id/extend-broadcast` | `{ note? }` | Once per role; 409 `not_extendable` at or above the applicant threshold |
| `POST /admin/roles/:id/close-broadcast` | `{ note }` | Freezes the shortlist now |
| `POST /admin/companies/:id/merge` | `{ into, note? }` | `:id` is the duplicate. A banned company cannot be merged |
| `GET /admin/reviews?kind=` | | Open review items |
| `POST /admin/reviews/:id/resolve` | `{ resolution, note?, campusReach? }` | `gate`: `accept` or `reject`. `join_dispute`: `joined` or `did_not_join`. `verification`: `approve`, `reject`, `reject_fraud` or `clear_flag` |
| `GET /admin/config`, `PUT /admin/config/:key` | `{ value }` | |
| `POST /admin/associations` | `{ campusShortCode, name, shareRate?, payoutMode, adminEmails }` | |
| `POST /admin/jobs/:name/run` | `{ roleId }` for `role.gate` and `role.broadcast` | Runs any job below once |

## Scheduled jobs

`services/api/src/scheduler.ts` runs these on a timer, hourly or nightly per §18, and all of them once at start-up:

- **Hourly:** `role.close_broadcast`, `role.terms_auto_release`
- **Nightly:** `role.terms_timeout`, `role.dark_check`, `role.join_prompt`, `role.join_grace`, `role.guarantee_expiry`, `candidate.status_flip`

The nightly order matters: prompt, then grace, then guarantee expiry. pg-boss is still the plan (§3.2) and replaces this file. The timer has no persistence and no retry backoff, and running two API instances would run every job twice.

`role.gate` and `role.broadcast` are not on the timer. They go through the `JobQueue` interface in `jobs.ts`, and the default queue, `inlineJobs`, runs them right after commit and inside the request. So waiving a deposit sends up to `nudge_cap` emails before it responds.

## Decisions worth knowing

- **Replacement guarantee is 60 days by default** (`fee.replacement_days`, previously 90), until Novare's sales rep agrees otherwise and staff edit the role's fee terms before the company accepts. Roles prefilled before this change keep 90.
- **No gate model means no auto-accept.** In production, every role that passes the rules waits in the staff queue. There is no live model yet (§14).
- **`deposit_mode`** is null until staff waive, then `waived`. Razorpay arrives in Slice 2.
- **Rank persists after freeze,** so the shortlist keeps its frozen order. During broadcast, displacement and withdrawal clear it. Equal scores do not displace: ties go to the earlier application.
- **Fit scores are a placeholder.** `deterministicScorer` stands in for embeddings and a reranker behind the `Scorer` interface, and there are no `embedding` columns yet.
- **The gate blocklist matches whole phrases,** so "bpo" no longer fires inside another word.
- **Join confirmation is required before guarantee expiry.** Late answers are checked against the 7-day grace and 3-day dispute windows when they arrive, not only by the nightly job. A dispute the company contests waits for staff indefinitely.
- **A replacement role** copies content, reach, caps and the gate decision pointer, with fee and deposit 0, and starts in `broadcast`.
- **A company gets one message when a role ends:** `terms_expired` on a terms timeout, `role_closed` otherwise, including a withdrawal.

## Not done

### Slice 1 work still open

1. **Connect the seat pages to the API.** Roles, applications and shortlists read fixtures. The candidate seat shows this sample data with no "Sample" tag, unlike the company and association seats.
2. **Staff console** (§12): gate, verification, join-dispute and alert queues, role transitions, fee terms, config. Today this is API only, and production depends on it because every role waits for staff.
3. **Association routes.** `resolveVerification` accepts an association as the actor, but no route exposes the association's verification queue. Staff can resolve items through `/admin/reviews`.
4. **In-app notifications.** Rows are written to `notification`, but no route reads them.
5. **`candidate.grad_nudge` job.** It needs an identity query and a way not to nudge twice.
6. **pg-boss,** replacing the interim timer and inline queue.
7. **Candidate name and contact on the shortlist.** The `candidate` table has no name column, and the spec does not say how a company reaches a shortlisted candidate. Needs a product decision.
8. **Smaller gaps:**
   - A company cannot open the shortlist of a `withdrawn` role.
   - `resolveVerification` still sends email inside its transaction; it can move to `inTx`.
   - `resolveVerification` does not re-rank after an approval. That is unreachable today, because only verified candidates can apply, but it is needed once referral sign-up lands.

### Before going live

- Rate-limit `POST /auth/magic-link`, per address and per IP.
- Set `APP_BASE_URL`, `RESEND_API_KEY` and `MAIL_FROM` on the API and `API_URL` on the app, and serve both over https.
- Confirm the production URL in `apps/prototype/src/data/site.ts`; `https://zenhyre.com` is a placeholder.
- Ignore `.env.local` files: the root `.gitignore` only covers `.env`.
- Choose hosting, and add CI and deployment.

### Later slices (§15)

- **Slice 2, ledger:** Razorpay, `resolveDeposit`, full `recordHire` / `didNotJoin` / `leftEarly`, invoices, reconciliation, association portal, referrals, payouts.
- **Slice 3, trust:** trust events and score, candidate approval, bans, leakage signals and queue.
- **Migration:** import 1.0 users and assessed candidates.

### Open decisions for the owner

- **Guarantee end date.** A guarantee runs to the end of day `joined_on + replacement_guarantee_days` (UTC), one calendar day longer than a strict count. To change it, edit `guaranteeEndsAt` in `packages/matching/src/stages.ts`; both callers follow.
- **§16 items:** contract language for deposit forfeiture and the 12-month ownership of an introduction, and the Razorpay and invoicing entity.
