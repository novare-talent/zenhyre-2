# Zenhyre 2.0 — Design Spec

**Date:** 2026-11-05
**Author:** Sahil Sheoran (Novare Talent), with Claude
**Status:** Draft for review

## 1. Purpose

Zenhyre 2.0 is a three-sided hiring platform for IIT talent. It automates the work Novare Talent does by hand today: sourcing, screening, shortlisting, and collecting fees. The three sides are:

- **Candidates**: IIT students (interns, final-year freshers) and IIT alumni.
- **Companies**: post roles, pay a refundable deposit, receive a ranked shortlist, pay a success fee on hire.
- **IIT Alumni Associations**: verify alumni, broadcast roles to their networks via referral links, earn a share of attributed fees.

Novare Talent's HR-services business sits on top of the platform: staff use the admin console, and Novare's own "exceptional talent" service works from the platform's longlists. It is not a product feature.

### What the platform must do

1. Verify that every candidate is from an IIT, without making alumni associations a bottleneck.
2. Reject roles that do not fit IIT talent, with a reason, before any candidate sees them.
3. Take a refundable deposit per role before broadcast, and refund or forfeit it by rule.
4. Match every open candidate against every role, nudge the best fits, and produce a ranked shortlist of applicants.
5. Record a negotiated success fee per role and invoice it on hire.
6. Attribute hires to associations and track their payout balance.
7. Compute an internal trust score for companies and candidates, and detect off-platform hires ("leakage") from cheap signals first.

### Out of scope for v1

Association-run events, candidate-to-company messaging, ATS integrations, multi-currency, LinkedIn scraping, and any public "campus tier" labels.

## 2. Decisions already made

| Topic | Decision |
|---|---|
| Deposit | Refundable per-role deposit. Never a reusable stored balance ("wallet"). |
| Deposit pricing | By number of campuses selected: ≤5 → ₹15k, ≤12 → ₹30k, all 23 → ₹60k. Config table; staff override per role. |
| Success fee | Interns: flat ₹10–15k. Freshers and alumni: 10% of CTC, rising to 20% for 10+ years' experience. Negotiated per role by Novare's sales/success person; stored as a terms snapshot on the role. |
| Shortlist | Every open candidate is matched and nudged; only applicants enter the shortlist, ranked by fit score; a higher-scoring applicant displaces the lowest. |
| Role gate | Rules first, model second, human on borderline or appeal. |
| Association payout | Share rate from the MoU (default 15% of fee). Each association chooses cash or sponsorship credit; balance shown on their dashboard. |
| Campus reach | Company picks campuses by name from all 23; price is by count. Internal tier config is a model prior and staff reference only, never shown. |
| Trust score | Internal-only for both companies and candidates. Consequences (probation, bans) are what's visible. |
| First customers | Novare's existing pipeline (YC-cohort startups, founders hiring interns via 1.0), then growth-stage startups. |
| Codebase | Greenfield. 1.0 users migrated at launch. |
| Architecture | Modular monolith, built money-loop first. |

## 3. Architecture

### 3.1 Repository layout

```
zenhyre-2/
  apps/
    candidate/      Next.js — student & alumni app
    company/        Next.js — company portal
    association/    Next.js — association portal
    admin/          Next.js — Novare staff console
  services/
    api/            Node (TypeScript) HTTP API + job workers
  packages/
    db/             Drizzle schema, migrations, typed queries
    gate/           Role gate: rules + model + review queue
    matching/       Candidate filter, scoring, rerank, shortlist
    ledger/         Deposit, fee, attribution, payout logic
    trust/          Trust events, score computation, thresholds
    notify/         Email + in-app notifications
    shared/         Types, config loader, auth helpers
  docs/
```

### 3.2 Stack

- TypeScript monorepo (pnpm workspaces, Turborepo).
- Next.js 15 (App Router) for the four frontends; all call `services/api`.
- Node 22 + Hono for the API. Background jobs via **pg-boss** on the same Postgres (no Redis in v1).
- **Postgres 16 + pgvector** for all data, including embeddings.
- **Claude API** for the gate's model pass and the matching rerank. Calls go through one `packages/shared/llm.ts` wrapper with recorded fixtures for tests.
- **Razorpay** for deposits and refunds. Webhooks are the only thing that moves a role past `deposit_pending`.
- **Resend** for transactional email. In-app notifications stored in Postgres.
- Auth: magic-link email (no passwords). Sessions as HTTP-only cookies. One `User` can have many emails.
- Hosting: Vercel for the apps, Railway or Fly for the API + Postgres. Decided at implementation.

### 3.3 Module boundaries

Each package exposes a small typed interface and owns its tables. Cross-module calls go through those interfaces, never through another module's tables.

| Module | Owns | Exposes |
|---|---|---|
| `db` | schema, migrations | typed query client |
| `gate` | `role_gate_decision`, rules config | `evaluate(role) → GateDecision` |
| `matching` | `match`, embeddings | `broadcast(roleId)`, `apply(roleId, candidateId)`, `freeze(roleId)` |
| `ledger` | `ledger_entry` | `recordDeposit`, `refund`, `forfeit`, `recordFeeDue`, `recordFeePaid`, `accrueShare`, `payShare`, `balanceOf(subject)` |
| `trust` | `trust_event` | `record(event)`, `scoreOf(subject)`, `statusOf(subject)` |
| `notify` | `notification` | `send(userId, template, data)` |

Every state change on `Role`, `Match`, and the ledger is an append-only event row. Balances, scores, and dashboards are derived from history, never hand-updated.

## 4. Data model

Core entities (Postgres tables; names in snake_case in the schema):

**Campus**: id, name, short code, email domains[], association_id, internal tier config (JSON, never exposed).

**User**: id, created_at. Role flags: candidate, company_user, association_admin, novare_staff.
**UserEmail**: user_id, email, verified_at, is_primary, campus_id (set when the domain matches a campus).

**Candidate**: user_id, campus_id, grad_year, course, status (`student` | `final_year` | `alumnus`), verification_state (`verified` | `referral_pending` | `verification_pending`), verification_source (`ldap` | `referral` | `association` | `staff`), verified_by, open_to_opportunities (bool), profile JSON (parsed CV, skills, preferred roles/locations, notice period, optional current CTC), embedding vector(1536), name_visible_to_association (bool, default false).

**Company**: id, name, verified_domain, status (`active` | `probation` | `banned`), created_at.
**CompanyUser**: user_id, company_id, role.

**Role**: id, company_id, title, jd, type (`intern` | `fresher` | `experienced`), ctc_min, ctc_max, years_exp_min, years_exp_max, locations[], campus_reach (campus_id[]), status (see §5), gate_decision_id, fee_terms JSON (snapshot: kind `flat` | `percent`, amount, replacement_guarantee_days default 90), fee_terms_accepted_at, deposit_amount, deposit_order_id, broadcast_opens_at, broadcast_closes_at, shortlist_cap (default 25), nudge_cap (default 150), created_at.

**RoleGateDecision**: id, role_id, stage (`rules` | `model` | `human`), outcome (`accept` | `reject` | `needs_review`), reason, suggested_reach (campus_id[]), model_score, decided_by (user_id or `system`), decided_at.

**Match**: id, role_id, candidate_id, fit_score (0–100), fit_reason, nudged_at, applied_at, rank (nullable), in_shortlist (bool), outcome (`none` | `shortlisted` | `viewed` | `interviewed` | `offered` | `hired` | `rejected`), outcome_reason, joined_on (date, set on hire), updated_at. Unique on (role_id, candidate_id).

**MatchEvent**: id, match_id, from_outcome, to_outcome, actor_user_id, at, note. Append-only.

**Association**: id, campus_id, name, contacts JSON, share_rate (decimal, default 0.15), payout_mode (`cash` | `sponsorship_credit`), mou_signed_at.

**Referral**: id, association_id, role_id (nullable for general links), token (unique), created_at.
**ReferralSignup**: referral_id, candidate_id, at.

**LedgerEntry**: id, type, subject_type (`company` | `association`), subject_id, role_id (nullable), match_id (nullable), amount (paise, positive), currency `INR`, external_ref (Razorpay id or invoice number), note, created_by, created_at. Append-only; never updated or deleted.

Entry types: `deposit_received`, `deposit_refunded`, `deposit_forfeited`, `fee_due`, `fee_paid`, `association_share_accrued`, `association_share_paid_cash`, `association_share_paid_credit`.

**TrustEvent**: id, subject_type (`company` | `candidate`), subject_id, type, weight (signed integer), evidence JSON, source (`system` | `staff` | `candidate_report` | `association_tip`), occurred_at, recorded_by. Append-only.

**Notification**: id, user_id, template, data JSON, channel (`email` | `in_app`), sent_at, read_at, bounce_reason.

**ConfigValue**: key, value JSON, updated_by, updated_at. Holds deposit tiers, fee defaults, minimum CTCs, blocklists, thresholds.

## 5. Role lifecycle

```
draft → gated → terms_pending → deposit_pending → broadcast → shortlist_ready → closing → closed
                  ↘ rejected
```

| State | Entered when | Exit |
|---|---|---|
| `draft` | Company creates the role | Company submits |
| `gated` | Submitted; gate job runs | Gate accepts → `terms_pending`; rejects → `rejected`; needs_review → stays `gated` with a review-queue item |
| `terms_pending` | Gate accepted | Company accepts fee terms in the portal → `deposit_pending` |
| `deposit_pending` | Terms accepted; Razorpay order created | Razorpay `payment.captured` webhook → `broadcast` |
| `broadcast` | Deposit captured | `broadcast_closes_at` reached → `shortlist_ready` |
| `shortlist_ready` | Window closed, shortlist frozen | Company marks a hire → `closing`; or 30 days of no action → `closing` (dark) |
| `closing` | Hire recorded or role abandoned | Deposit resolved (refund/forfeit/net) → `closed` |
| `closed` | Terminal | — |

Staff can extend `broadcast` once (default +7 days) if fewer than 10 candidates have applied.

## 6. Candidate identity and onboarding

### 6.1 Entry paths

**Student via campus email.** Sign-up with an email whose domain matches a `Campus`. Magic link verifies ownership. `campus_id` is set from the domain. Grad year and course are self-declared; a per-campus roll-number regex is a second check. `status` flips `student → final_year` 12 months before grad date and `→ alumnus` on grad date, via a nightly job. Candidate is `verified` with source `ldap` immediately.

**Graduation handoff.** 60 days before grad date, and again 30 days after, the candidate gets a nudge to add a personal email. Both emails stay attached to the `User`. The campus email remains as campus proof after it stops working.

**Alumnus via referral link.** Link token encodes `association_id` and optional `role_id`. Sign-up creates the candidate as `referral_pending` with `verification_source = referral`. They can view and apply to the linked role immediately; their application enters a shortlist only once `verified`. The association's queue shows: name, claimed batch, claimed branch, LinkedIn URL. One-click approve sets `verified`. A `ReferralSignup` row is written for attribution.

**Alumnus via direct request.** Same as above with no role attached; lands in the association queue as `verification_pending`.

### 6.2 Verification escape hatch

If a request sits in an association's queue for more than 7 days, `novare_staff` can approve it from the admin console with evidence noted (degree certificate, LinkedIn). `verified_by` records who approved, so associations can audit.

### 6.3 Profile

CV upload → parsed to structured fields (Claude call) → candidate reviews and edits → saved to `profile`. The embedding is regenerated on every profile save. One toggle controls nudges: `open_to_opportunities`. Nudges go only to open, verified candidates.

## 7. Role gate

Runs as a job when a role enters `gated`. Three stages, in order; the first stage that decides, decides.

**Stage 1 — Rules.** From `ConfigValue`:
- Role-category blocklist (field sales, BPO, data entry, unpaid). Matched against title + JD keywords.
- Minimum CTC by type (defaults: intern ₹20k/month, fresher 6 LPA, experienced 10 LPA).
- Required fields present (JD ≥ 200 chars, CTC band, type, at least one location).

A rules reject is instant and names the rule. A rules pass goes to stage 2.

**Stage 2 — Model.** Claude reads the JD and role fields and returns JSON: `{ fit_score: 0-100, suggested_reach: campus_id[], concerns: string[], reason: string }`. The prompt includes the internal tier config as a prior. Thresholds from config (defaults: ≥70 accept, <40 reject, else `needs_review`). If the company's chosen `campus_reach` is broader than `suggested_reach`, the outcome is `needs_review` regardless of score.

**Stage 3 — Human.** `needs_review` roles, company appeals of a rejection, and reach mismatches appear in the admin review queue. Staff accept (optionally adjusting reach), or reject with a reason. Every decision is a `RoleGateDecision` row.

On acceptance, `fee_terms` is prefilled from defaults by role type and CTC. Staff may edit it before the company sees it. The company accepts terms in the portal; the snapshot and `fee_terms_accepted_at` are stored.

## 8. Matching and shortlist

Runs when a role enters `broadcast`, and incrementally on each new applicant.

1. **Filter.** Candidates where `open_to_opportunities`, `verification_state = verified`, `campus_id ∈ campus_reach`, `status` matches role type (intern → student; fresher → final_year or alumnus with ≤1 year; experienced → alumnus within the exp band).
2. **Score.** Cosine similarity between candidate embedding and role embedding selects the top 200. A Claude rerank over those 200 applies a structured rubric (skills, seniority, domain, location) and returns `fit_score` and a one-line `fit_reason` per candidate. A `Match` row is written for every scored candidate.
3. **Nudge.** Top `nudge_cap` by `fit_score` receive email + in-app notification. The same hour, every association whose campus is in reach gets the role brief and a `Referral` link.
4. **Apply.** A candidate applies from the nudge or from the open-roles list. `applied_at` is set. If the candidate was not in the scored set (e.g. joined after broadcast), they are scored on apply. Applicants are ranked by `fit_score`; the top `shortlist_cap` have `in_shortlist = true`. A new applicant with a higher score displaces the lowest; the displaced candidate keeps `applied_at` and stays visible to staff in the longlist.
5. **Freeze.** At `broadcast_closes_at`, the shortlist is frozen: no further rank changes. The role moves to `shortlist_ready` and the company is notified.

**Company view.** Ranked shortlist, each profile, `fit_reason`, and actions: view → interview → offer → hired / rejected (reason required). Every action writes a `MatchEvent`. Marking `hired` requires a joining date.

**Candidate view.** Their applications and outcome state. Rejected candidates see the company's reason category, not free text.

## 9. Ledger, deposit, fees, payouts

### 9.1 Deposit

- Amount from the config tier table by `campus_reach` length; staff can override on the role.
- Razorpay order created at `terms_pending → deposit_pending`. The `payment.captured` webhook (idempotent on `order_id`) writes `deposit_received` and moves the role to `broadcast`. Nothing else moves a role past `deposit_pending`.
- **Refund** (`deposit_refunded`) when: a hire is recorded (netted against the fee invoice), or the window closes with no hire and the company engaged (viewed the shortlist and actioned ≥50% of shortlisted candidates; threshold in config). Refunds go through Razorpay to the original instrument within 7 days of the trigger.
- **Forfeit** (`deposit_forfeited`) when: the company goes dark (no shortlist action within 30 days of `shortlist_ready`), or a verified off-platform hire of a shortlisted candidate within 12 months of `shortlist_ready`. Forfeit always requires a staff decision with evidence in `note`; it is never automatic.

### 9.2 Success fee

- `hired` event → `fee_due` entry computed from the role's `fee_terms` snapshot and the recorded CTC. An invoice PDF is generated on Novare letterhead. Due 30 days after `joined_on`.
- The candidate confirms joining in-app on `joined_on`; if the candidate reports they did not join, the match is reopened and no `fee_due` is written (or an existing one is noted as disputed for staff).
- `fee_paid` written by staff on bank reconciliation.
- Replacement guarantee (default 90 days, in `fee_terms`): if the hire leaves inside the window, staff open a replacement role for the company at zero deposit and zero additional fee, linked to the original role.

### 9.3 Association attribution

Precedence per hired candidate, evaluated on `fee_paid`:
1. `ReferralSignup` for a referral tied to this role.
2. `ReferralSignup` for any earlier referral from an association.
3. `verification_source = association` (the association verified them).
4. None.

Students who joined via campus email and are hired as freshers earn no association share.

`association_share_accrued` is written on `fee_paid`, never on `hired`, so Novare never owes a share on uncollected fees. Amount = fee × `share_rate` from the `Association` record.

### 9.4 Payout

- `payout_mode = cash`: monthly statement generated; the association invoices Novare; staff write `association_share_paid_cash` on payment.
- `payout_mode = sponsorship_credit`: balance accrues; staff write `association_share_paid_credit` for each sponsorship draw (event, merch, reunion) with a note.
- Association portal shows: attributed hires (candidate shown by batch and role unless `name_visible_to_association`), accrued, paid, balance.

### 9.5 Invariants

- Balances are always `SUM(entries)` by subject; no balance column exists.
- A write that would make any subject's balance negative is rejected.
- `fee_paid` cannot exceed `fee_due` for the same match.
- `deposit_refunded + deposit_forfeited` for a role cannot exceed `deposit_received`.
- Admin console has a ledger view per company and per association, and a month-end CSV export.

## 10. Trust and leakage

### 10.1 Trust score

Both companies and candidates start at 100. `score = 100 + Σ (weight × decay(age))`, clamped 0–100, where decay is linear to zero over 12 months. Recomputed on every `TrustEvent` write. Internal-only; shown in the admin console; never exposed to the subject or to other sides.

**Company events** (default weights in config): hire closed +5; fee paid on time +3; shortlist actioned within 7 days +2; went dark −15; fee overdue 30 days −15; verified off-platform hire −40; appeal upheld against them −10.

Thresholds: score <70 → `probation` (deposit doubles, every role goes to human review); <40 → `banned` (company users locked, open roles closed, outstanding deposits refunded).

**Candidate events**: joined after offer +5; interview no-show −10; offer reneged after acceptance −25; profile found false on verification −50.

Thresholds: <60 → nudges stop and applications require staff approval; <30 → removed from all shortlists and cannot apply.

### 10.2 Leakage detection

Signals, cheapest first. Every signal creates a review item; a human confirms before any forfeit or negative trust event is written.

1. **Candidate self-report.** 30 and 90 days after a role reaches `shortlist_ready`, every shortlisted candidate not marked `hired` gets a one-tap "Did this company hire you?" A yes creates a review item; the candidate earns a small positive trust event for responding.
2. **Company declaration.** The hiring terms require reporting any hire of a shortlisted candidate within 12 months. A declared hire writes `fee_due` through the normal path.
3. **Association tips.** Associations see outcomes for their own alumni and can flag a suspected off-platform hire.
4. **Public-profile check.** A weekly job compares each shortlisted candidate's self-updated current company on Zenhyre, plus any public source legal counsel clears in writing, against the companies that shortlisted them in the last 12 months. Matches become review items. No LinkedIn scraping in v1.

## 11. Notifications

Templates (email + in-app unless noted): magic link (email only); add-personal-email nudge; role nudge; application received; shortlist ready (company); verification request (association); verification approved; outcome change (candidate); deposit captured / refunded / forfeited (company); fee invoice (company, email with PDF); monthly statement (association); self-report prompt (candidate).

Email bounces mark the `UserEmail` and the next send falls back to the user's other verified email.

## 12. Admin console (Novare staff)

Queues: gate review, verification escape hatch, leakage review, deposit resolution. Views: roles by state, companies with trust score and status, associations with balances, ledger per subject, config editor, month-end exports. Every staff action records `actor_user_id`.

## 13. Error handling

- **Razorpay webhooks**: verified by signature; idempotent on `order_id`/`payment_id`; retried by Razorpay. A role stuck in `deposit_pending` for >24h with a captured payment on Razorpay's side surfaces in an admin alert.
- **Gate and matching jobs**: pg-boss retries (3 attempts, exponential backoff). A final failure writes `job_error` on the role and raises an admin alert within the hour.
- **LLM calls**: timeouts (30s), one retry, structured-output validation; an invalid response counts as a failure, never as a decision.
- **Email**: bounces recorded; fallback email used; two bounces on all emails flags the user for staff.
- **Ledger**: invariant violations (§9.5) are rejected at the service layer and logged.
- **Auth**: magic links expire in 15 minutes and are single-use.

## 14. Testing

**Unit** (per package): gate rules table; model-threshold routing with fixture responses; matching filter, ranking, displacement, freeze; ledger invariants and attribution precedence; trust decay, thresholds, and status transitions.

**Integration** (`services/api`, seeded Postgres): the full loop — post role → rules pass → model accept (fixture) → terms accepted → Razorpay webhook (simulated) → broadcast → nudge → apply × N → displacement → freeze → company actions → hired → `fee_due` → `fee_paid` → `association_share_accrued` → statement. Also: referral sign-up → association approve → apply enters shortlist; escape-hatch approval; dark company → forfeit path; probation and ban thresholds.

**Fixtures**: every Claude call is recorded once and replayed in tests; a `LLM_RECORD=1` flag refreshes them.

**Manual acceptance** before launch: one real role from a Novare pipeline client run end-to-end on staging with a real Razorpay test-mode payment.

## 15. Build order

1. **Slice 1 — Core loop, no money.** `db`, auth, candidate app (student sign-up, profile), company portal (post role), `gate`, `matching`, admin review queue, shortlist view. Deposit and fee tracked manually by staff outside the system.
2. **Slice 2 — Ledger.** Razorpay deposit, refund/forfeit flows, fee terms, invoice, association portal, referral links, attribution, payouts.
3. **Slice 3 — Trust.** Trust events, score, thresholds, leakage signals, review queues.
4. **Migration.** Import 1.0 users and assessed candidates; invite them to complete 2.0 profiles.

## 16. Open items for Sahil

- Legal: contract language for deposit forfeiture, 12-month ownership of introduction, and company reporting duty. Counsel to clear any public-profile source for §10.2 signal 4.
- Entity for Razorpay and invoicing: Novare Talent Private Limited.
- Hosting choice (Vercel + Railway vs. Fly) at implementation.
- Headcount: one sales-plus-success person per ~20 active companies, to be validated after Slice 2.
