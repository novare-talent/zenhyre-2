# Zenhyre web app

The web app for all three sides of Zenhyre: candidates, companies and alumni associations.
One Next.js app, one seat per role, behind a real login.

## Run it

```
pnpm test:db:start                                   # local Postgres on :5433 (set PGBIN if it is not in /usr/lib/postgresql/16/bin)
export DATABASE_URL=postgres://zenhyre:zenhyre@localhost:5433/zenhyre
pnpm db:migrate && pnpm db:seed
APP_BASE_URL=http://localhost:3000 pnpm --filter @zenhyre/api dev     # API on :4000
pnpm --filter @zenhyre/prototype dev                                  # app on :3000
```

Without `RESEND_API_KEY` no email is sent: the API prints each sign-in link in its terminal.

## Logging in

Each email holds exactly one role, and a login sits in that one seat. There are no passwords:
`/login` asks who you are and for an address, the API emails a link that works once for 15
minutes, and the link opens that seat.

| Role | What they log in with | First time |
|---|---|---|
| Candidate | Their campus **LDAP ID** (the ID plus the campus mail domain) or a **personal email** on a known mailbox provider. A work address is refused | LDAP: course, graduation date, roll number, verified at once (§6.1). Personal: campus, branch, LinkedIn, then the alumni association verifies them |
| Company | A **work email** on the company's own domain. Personal mailboxes (Gmail, Outlook, Yahoo and the rest of `identity.freemail_domains`) and campus addresses are refused (§6.4) | Company name; the verified domain comes from the email |
| Association | Only a login **created by Novare** (§6.5). There is no sign-up | Nothing: they log in with the address they were given |

The rules are enforced twice: in the app when the link is requested (`src/app/api/auth/start`),
and in the API when the account is created (`services/api/src/oneRole.ts`), which is the
authority. An email that already holds one role is refused any other with `409 role_taken`.
"Personal" means a domain in the staff-editable config list `identity.freemail_domains`; add a
provider there if a real candidate is turned away.

### Creating an association login

```
pnpm --filter @zenhyre/api issue:association -- --campus IITD --email admin@alumni.example \
     --name "IIT Delhi Alumni Association" --share 0.15 --payout cash --by you@novaretalent.com
```

This creates the association for that campus if it does not exist and makes the address one of
its admins straight away. Tell them the address; they log in at `/login` as an association and
the sign-in link proves they own the mailbox. Run it again with another `--email` to add an admin.
Staff can also do this through `POST /admin/associations` with `adminEmails`.

## How the session works

- The browser never calls the API. Route handlers under `src/app/api` forward to it and hold the
  API session in an HTTP-only, SameSite=Lax cookie (`zh_session`); `zh_seat` holds the one role.
- `src/proxy.ts` turns away requests with no session cookie. Each seat layout then asks the API
  who the person is (`requireSeat`), so a stale or forged cookie gets nowhere.
- The emailed link lands on a confirm page and is redeemed by a POST, so mail scanners that
  pre-open links cannot use it up. Auth pages send no referrer and are never cached.
- Mutating handlers accept same-origin requests only.

Environment: `API_URL` (default `http://localhost:4000`), optional `COOKIE_SECURE`. See `.env.example`.

## What is live and what is sample data

| Live, from the API | Sample data, API built but not connected here | Sample data, backend not built |
|---|---|---|
| Login, sessions, logout | Roles on the board | Deposits, invoices (Slice 2) |
| Candidate sign-up, campus verification, profile, nudges switch | Applications, shortlists, company actions | Referral links, earnings ledger (Slice 2) |
| Company creation and its verified domain | Fee terms | Association verification queue: staff can resolve items through `/admin/reviews`, but there are no association routes |
| Association identity, share rate, payout mode | | |

The rules behind the sample data are real: `src/lib/config.ts` reads the config defaults from
`packages/ops`, and `src/lib/rules.ts` implements deposit tiers, fee terms, the gate's rules pass
and the stage table as the spec states them. Sample data lives in `src/data/fixtures.ts`. The
company and association seats show a "Sample" tag while they depend on it; the candidate seat
does not have one yet. The routes to connect are listed in `HANDOVER.md` at the repo root.

## Tests

```
pnpm --filter @zenhyre/prototype test       # seat decision and money rules
pnpm test                                    # everything, needs DATABASE_URL
```

## Before going live

- Rate-limit `POST /auth/magic-link` in the API (per address and per IP).
- Set `APP_BASE_URL`, `RESEND_API_KEY`, `MAIL_FROM` on the API and `API_URL` on the app; serve both over https.
- Confirm the production URL in `src/data/site.ts`.

Design decisions are recorded in `DESIGN.md`.
