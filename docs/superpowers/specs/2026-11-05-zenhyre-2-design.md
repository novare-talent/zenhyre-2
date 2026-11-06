# Zenhyre 2.0 — Design Spec

**Date:** 2026-11-05
**Author:** Sahil Sheoran (Novare Talent), with Claude
**Status:** Reviewed (rev 6) — awaiting founder sign-off

## 1. Purpose

Zenhyre 2.0 is a three-sided hiring platform for IIT talent. It automates the work Novare Talent does by hand today: sourcing, screening, shortlisting, and collecting fees. The three sides are:

- **Candidates**: IIT students (interns, final-year freshers) and IIT alumni.
- **Companies**: post roles, pay a refundable deposit, receive a ranked shortlist, pay a success fee on hire.
- **IIT Alumni Associations**: verify alumni, broadcast roles to their networks via referral links, earn a share of attributed fees.

Novare Talent's HR-services business sits on top of the platform: staff use the admin console, and Novare's own "exceptional talent" service works from the platform's longlists. It is not a product feature.

### What the platform must do

1. Verify that every candidate is from an IIT, without making alumni associations a bottleneck.
2. Reject roles that do not fit IIT talent, with a reason, before any candidate sees them.
3. Take a refundable deposit per role before broadcast, and refund, apply, or forfeit it by rule.
4. Match every open candidate against every role, nudge the best fits, and produce a ranked shortlist of applicants.
5. Record a negotiated success fee per role and invoice it on hire.
6. Attribute hires to associations and track their payout balance.
7. Compute an internal trust score for companies and candidates, and detect off-platform hires ("leakage") from cheap signals first.

### Out of scope for v1

Association-run events, candidate-to-company messaging, ATS integrations, multi-currency, LinkedIn scraping, public "campus tier" labels, candidate account deletion / PII retention tooling (handled by staff request in v1), more than one hire per role (a role is one opening; a company needing three hires posts three roles).

## 2. Decisions already made

| Topic | Decision |
|---|---|
| Deposit | Refundable per-role deposit. Never a reusable stored balance ("wallet"). |
| Deposit pricing | By number of campuses selected: 1–5 → ₹15k, 6–12 → ₹30k, 13–23 → ₹60k. Config table; staff override per role. |
| Success fee | Interns: flat ₹10–15k. Freshers and alumni: 10% of annual CTC; 20% when the role requires 10+ years' experience (step, not linear). Negotiated per role by Novare's sales/success person; stored as a terms snapshot on the role. |
| Shortlist | Every open candidate is matched and nudged; only applicants enter the shortlist, ranked by fit score; a higher-scoring applicant displaces the lowest. |
| Role gate | Rules first, model second, human on borderline or appeal. |
| Association payout | Share rate from the MoU (default 15% of fee collected). Each association chooses cash or sponsorship credit; balance shown on their dashboard. |
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
    api/            Node (TypeScript) HTTP API + job workers + workflows
  packages/
    db/             Drizzle schema, migrations, typed query client
    ops/            ReviewItem queues, ConfigValue, staff audit
    identity/       Users, emails, candidates, companies, associations, campuses
    roles/          Role lifecycle, referrals, gate orchestration
    gate/           Role gate: rules + model evaluation (pure)
    matching/       Scoring, nudges, shortlist, match stages
    ledger/         Deposit, fee, attribution, payout entries
    trust/          Trust events, score computation, status materialisation
    notify/         Email + in-app notifications
    shared/         Types, LLM wrapper, auth helpers (no tables)
  docs/
```

### 3.2 Stack

- TypeScript monorepo (pnpm workspaces, Turborepo).
- Next.js 15 (App Router) for the four frontends; all call `services/api`.
- Node 22 + Hono for the API. Background jobs via **pg-boss** on the same Postgres (no Redis in v1).
- **Postgres 16 + pgvector** for all data, including embeddings.
- **Claude API** for CV parsing, the gate's model pass, and the matching rerank. All calls go through `packages/shared/llm.ts`, which validates structured output and supports recorded fixtures for tests.
- **Razorpay** for deposits and refunds.
- **Resend** for transactional email. In-app notifications stored in Postgres.
- Auth: magic-link email (no passwords), 15-minute single-use links stored in `MagicLinkToken`. Server-backed sessions (`Session` table) as HTTP-only cookies. One `User` can have many emails.
- Object storage for CV uploads: S3-compatible bucket (Cloudflare R2 by default); `cv_url` is a signed URL.
- Hosting: Vercel for the apps, Railway or Fly for the API + Postgres. Decided at implementation.

### 3.3 Module boundaries

Each package owns its tables and exposes a small typed interface. Cross-module calls go through those interfaces, never through another module's tables. Modules never call each other in a cycle; the dependency order is `db → ops → identity → roles → matching → ledger → trust`, with `gate`, `notify`, `shared` as leaves. A module never enqueues a job owned by a downstream module; API handlers and workflows do that.

**Orchestration.** Any operation that touches more than one module is a **workflow** in `services/api/src/workflows/`. A workflow calls module interfaces in sequence inside one DB transaction and returns; modules do not emit events or subscribe to each other. Slow follow-ups (embedding, sending email, Razorpay calls) are enqueued as pg-boss jobs from the workflow after commit. In a slice where a module does not exist yet, the workflow skips that module's steps.

Named workflows:

| Workflow | Triggered by | Touches |
|---|---|---|
| `signUpCandidate` | sign-up (campus email or direct request) | identity, ops (roll-number flag), notify |
| `referralSignUp` | sign-up via referral link | identity, roles (attribution), ops, notify |
| `saveProfile` | profile save | identity; enqueues `matching.embed_candidate` |
| `resolveVerification` | association admin or staff | identity, ops, trust (`profile_false` on reject-with-fraud), notify |
| `submitRole` | company submit | roles; enqueues gate job |
| `gateDecision` | gate job / staff review | roles, gate, ops, trust (`appeal_rejected`), notify. No-op if the role is no longer `gated` (withdrawn mid-flight) |
| `acceptTerms` | company accepts | roles, ledger (Razorpay order) or staff waiver path |
| `depositCaptured` | Razorpay webhook | ledger, roles (`→ broadcast`, `broadcast_opens_at`, `broadcast_closes_at = opens + match.broadcast_days`); enqueues `broadcastRole` |
| `broadcastRole` | job | roles, identity (candidates), matching, notify |
| `extendBroadcast` | staff | roles, notify |
| `applyToRole` | candidate | matching, ops (`candidate_approval` when restricted), notify |
| `resolveCandidateApproval` | staff | matching, ops |
| `freezeShortlist` | `role.close_broadcast` job | matching, roles, notify |
| `companyAction` | every company stage action | matching, trust (`interview_no_show`, `offer_reneged`), notify; delegates to `recordHire` / `didNotJoin` / `leftEarly` for those stages |
| `candidateWithdraw` | candidate | matching, trust (`offer_reneged` when from `offer_accepted`), notify (`stage_changed` to company) |
| `waiveDeposit` | staff | roles (`deposit_mode = waived`, `deposit_pending → broadcast`, `broadcast_opens_at`, `broadcast_closes_at = opens + match.broadcast_days`); enqueues `broadcastRole` |
| `recordHire` | company marks hired | matching, ledger, trust, roles, notify |
| `confirmJoin` | `did_you_join` answer, company response to a dispute, staff dispute resolution, or `role.join_grace` | matching, trust (`joined`), ops (dispute), notify |
| `didNotJoin` | company, or `confirmJoin` outcome | ledger, matching, roles, ops, notify |
| `leftEarly` | company | matching, roles (replacement role), notify; enqueues `broadcastRole` for the replacement |
| `resolveDeposit` | role enters `closing` without a hire, or `withdrawn` | ledger, ops, trust (`went_dark`), roles; calls `closeRole` when nothing is owed |
| `resolveDepositReview` | staff resolves a `deposit_resolution` item | ledger, ops, roles, notify; calls `closeRole` on forfeit |
| `refundProcessed` | Razorpay webhook | ledger, notify; calls `closeRole` only when the role is `closing` with `hired_match_id` null |
| `closeRole` | `resolveDeposit`, `resolveDepositReview`, `refundProcessed`, `guaranteeExpiry`, `withdrawRole` | roles (→ `closed` / `withdrawn`), matching (`closeOpenMatches`), notify |
| `guaranteeExpiry` | `role.guarantee_expiry` job | calls `closeRole`; skips roles whose hired match has `join_confirmed_at` null or an open `join_dispute` |
| `reconcileFee` | staff | ledger, trust (`fee_paid_on_time`), notify |
| `selfReportAnswer` | candidate | trust, ops |
| `confirmLeakage` | staff | ledger, matching (override), trust |
| `appealRole` | company | roles, ops, notify |
| `releaseTerms` | staff or `role.terms_auto_release` | roles, notify |
| `banCompany` / `liftBan` | any workflow whose `trust.recompute` crosses the ban threshold, or staff | identity, roles, matching, ledger |
| `blockCandidate` | any workflow whose `trust.recompute` crosses the block threshold | identity, matching |
| `withdrawRole` | company or `role.terms_timeout` | roles (`→ withdrawn`), matching (`closeOpenMatches`), then `resolveDeposit`, notify. `closeRole` is a status no-op on an already-terminal role |
| `mergeCompanies` | staff | identity, roles |
| `nightlyTrust` | job | trust, identity (status writes), ledger (overdue scan), matching (prompt-action scan) |

| Module | Owns tables | Exposes |
|---|---|---|
| `ops` | ReviewItem, ConfigValue, StaffAction | `openReview`, `resolveReview`, `listReviews`, `config.get/set`, `audit(actor, action, ref)` |
| `identity` | Campus, User, UserEmail, MagicLinkToken, Session, Candidate, Company, CompanyUser, Association, AssociationAdmin | `issueMagicLink`, `redeemMagicLink`, `createCandidate`, `createCompany`, `verifyCandidate`, `rejectVerification`, `clearRollNumberFlag`, `setCandidateStatus`, `setCandidateOpen`, `saveProfile`, `listMatchableCandidates(filter)`, `getCandidate`, `getCompany`, `setCompanyStatus`, `setCandidateTrustStatus`, `inviteCompanyUser`, `inviteAssociationAdmin`, `lockCompanyUsers`, `mergeCompanies` |
| `roles` | Role, RoleEvent, RoleGateDecision, Referral, ReferralAttribution | `create`, `submit`, `get`, `update(roleId, data)` (any non-status field: draft content while `draft`, `campus_reach` by staff at gate, `hired_match_id`, `broadcast_*`, `deposit_*`, `refund_owed`, `job_error`), `transition(roleId, to, actor, note)`, `appeal`, `recordGateDecision`, `setFeeTerms`, `releaseTerms`, `acceptTerms`, `extendBroadcast`, `createReplacement`, `createReferral`, `recordReferralAttribution`, `attributionFor(candidateId, roleId)` |
| `gate` | — (pure) | `evaluateRules(role, config) → GateOutcome`, `evaluateModel(role, config) → GateOutcome` |
| `matching` | Match, MatchEvent | `embedCandidate`, `embedRole`, `broadcast(roleId, candidates)`, `canApply(role, candidate)`, `apply(roleId, candidateId)`, `rerank(roleId)`, `freeze(roleId)`, `setStage(matchId, stage, actor, data)`, `closeOpenMatches(roleId)`, `declineOpenMatches(candidateId)`, `engagedShortlistFraction(roleId)`, `listShortlist(roleId)`, `listOpenRolesFor(candidate)` |
| `ledger` | LedgerEntry | `record(entry)`, `depositHeld(roleId)`, `feeOutstanding(matchId)`, `associationBalance(associationId)`, `pendingRefunds()`, `overdueInvoices()` |
| `trust` | TrustEvent, TrustScore | `record(event)`, `recompute(subject)`, `recomputeAll()`, `scoreOf`, `statusOf` |
| `notify` | Notification | `send(userId, template, data)` |

Every state change on `Role`, `Match`, and the ledger is an append-only event row. Balances and scores are derived from history. `Company.status` and `Candidate.trust_status` are the only status columns written on another module's behalf: `trust` computes them and calls `identity.setCompanyStatus` / `setCandidateTrustStatus`.

## 4. Data model

Core entities (Postgres tables; snake_case in the schema).

### 4.1 Identity

**Campus**: id, name, short_code, email_domains[], roll_number_regex (nullable), internal_tier (int, never exposed).

**User**: id, created_at, is_staff (bool). Other roles are derived from membership rows (Candidate, CompanyUser, AssociationAdmin).
**UserEmail**: user_id, email, verified_at, is_primary, campus_id (set when domain matches a campus), bounce_count.

**Candidate**: user_id, campus_id, grad_date (date), course, roll_number (nullable), roll_number_flag (bool), status (`student` | `final_year` | `alumnus`; derived from `grad_date` at creation and nightly), verification_state (`verified` | `referral_pending` | `verification_pending` | `rejected`), verification_attempts (int), verification_source (`campus_email` | `referral` | `association` | `staff`), verified_by (user_id or `system`), verified_at, open_to_opportunities (bool, default true), trust_status (`ok` | `restricted` | `blocked`; default `ok`), profile JSON, embedding vector(1536), embedding_updated_at, name_visible_to_association (bool, default false).

`profile` JSON fields: headline, skills[], years_experience (decimal), current_company, current_title, preferred_roles[], preferred_locations[], notice_period_days, current_ctc (optional), linkedin_url, cv_url, parsed_cv JSON.

**Company**: id, name, verified_domain, status (`active` | `probation` | `banned`; default `active`), status_changed_at, created_at.
**CompanyUser**: user_id, company_id, role (`owner` | `member`), invited_by, joined_at, locked_at (nullable).

**Association**: id, campus_id, name, contacts JSON, share_rate (decimal, default 0.15), payout_mode (`cash` | `sponsorship_credit`), mou_signed_at. (One association per campus; `Campus` has no back-reference.)
**AssociationAdmin**: user_id, association_id, invited_by, joined_at.

### 4.2 Roles

**Role**: id, company_id, title, jd, type (`intern` | `fresher` | `experienced`), ctc_min, ctc_max (annual, paise; monthly stipend × 12 for interns), years_exp_min, years_exp_max, locations[], campus_reach (campus_id[]), status (§5), final_gate_decision_id (latest `RoleGateDecision`), fee_terms JSON, fee_terms_released_at, fee_terms_accepted_at, deposit_amount (paise), deposit_mode (`razorpay` | `waived`; set to `razorpay` at `acceptTerms`, changed to `waived` only by the staff waiver transition), deposit_order_id, refund_owed (paise, nullable; set by workflows that owe a refund, cleared by `ledger.refund_initiate`), broadcast_opens_at (set on entry to `broadcast`), broadcast_closes_at, broadcast_extended_at (nullable), shortlist_ready_at (set on every entry to `shortlist_ready`, including reopen; the anchor for the 30-day dark clock, self-report prompts, and prompt-action checks), shortlist_cap (default 25), nudge_cap (default 150), replacement_of_role_id (nullable), hired_match_id (nullable; the one company-recorded hire for this role), hired_at (nullable), embedding vector(1536), job_error (nullable text), created_at.

All CTC and money fields across the schema are **paise**; UI converts to ₹.

`fee_terms` JSON: kind (`flat` | `percent`), amount (paise for flat, decimal for percent), replacement_guarantee_days (default 90), notes.

**RoleEvent**: id, role_id, from_status, to_status, actor_user_id or `system`, note, at. Append-only.

**RoleGateDecision**: id, role_id, stage (`rules` | `model` | `human`), outcome (`accept` | `reject` | `needs_review`), reason, suggested_reach (campus_id[]), model_score (nullable), decided_by, decided_at.

**Referral**: id, association_id, role_id (nullable for general links), token (unique), created_at.
**ReferralAttribution**: referral_id, candidate_id, kind (`signup` | `visit`), at. Unique on (referral_id, candidate_id). Written on sign-up through a link, and when a logged-in candidate opens a role via a link.

### 4.3 Matching

**Match**: id, role_id, candidate_id, fit_score (0–100), fit_reason, nudged_at, applied_at, rank (nullable; set only while in the shortlist), stage (below), rejection_category (nullable enum: `skills` | `experience` | `location` | `compensation` | `culture` | `position_filled` | `no_show` | `other`), rejection_note, offered_ctc (paise), hired_ctc (paise), joined_on (date), join_prompt_sent_at (nullable), join_confirmed_at (nullable), join_confirmed_by (`candidate` | `grace` | `staff`), override (bool, default false; set by `confirmLeakage`), updated_at. Unique on (role_id, candidate_id).

**Stages and legal transitions** (anything not listed is illegal; `matching.setStage` rejects it):

| From | To | Actor |
|---|---|---|
| `scored` | `applied` | candidate (apply) |
| `applied` | `pending_approval` | system (candidate is `restricted`) |
| `pending_approval` | `applied` | staff approve |
| `pending_approval` | `declined_by_staff` | staff decline |
| `applied` | `shortlisted` | system (ranking) |
| `shortlisted` | `applied` | system (displacement) |
| `shortlisted` | `viewed` | company |
| `viewed` | `interviewed` | company |
| `interviewed` | `offered` | company (`offered_ctc`) |
| `offered` | `offer_accepted` | company |
| `offer_accepted` | `hired` | company (`hired_ctc`, `joined_on`) |
| `offer_accepted` | `offer_reneged` | company ("candidate backed out") or candidate withdraw from this stage |
| `shortlisted`, `viewed`, `interviewed`, `offered`, `offer_accepted` | `rejected` | company (`rejection_category`) |
| `applied`, `shortlisted`, `viewed`, `interviewed`, `offered` | `withdrawn` | candidate |
| `hired` | `did_not_join` | `didNotJoin` workflow (only while `join_confirmed_at` is null) |
| `hired` | `left_early` | company (only after `join_confirmed_at`, within `replacement_guarantee_days`) |
| any non-settled stage | `declined_by_staff` | `banCompany` / candidate `blocked` |
| any non-settled stage | `role_closed` | `closeOpenMatches` |
| any stage | `hired` | **staff override** (`confirmLeakage` only; sets `override = true`, `join_confirmed_at`, `join_confirmed_by = staff`; does not set `Role.hired_match_id`; exempt from the one-hire rule) |

**One-hire rule**: `setStage(…, hired)` with a company actor is rejected when `Role.hired_match_id` is already set. **Role precondition**: company actors may call `setStage` only while the role is `shortlist_ready` or `closing`; in `closing` with `hired_match_id` set, the only company transitions allowed on other matches are `→ rejected`, and on the hired match `→ did_not_join` / `→ left_early`.

**Settled stages** (never moved by `closeOpenMatches` or blocking): `hired`, `did_not_join`, `left_early`, `rejected`, `declined_by_staff`, `withdrawn`, `offer_reneged`, `role_closed`. All others are open.

`rejection_category = no_show` also writes `candidate.interview_no_show`. Displacement clears `rank`. **Qualifying actions** (used by §9.1 and §10.1) are company-initiated transitions to `interviewed`, `offered`, or `rejected`; `viewed` does not count. `engagedShortlistFraction(roleId)` = distinct shortlisted candidates with ≥1 qualifying action ÷ shortlisted candidates at freeze.

**MatchEvent**: id, match_id, from_stage, to_stage, actor_user_id or `system`, data JSON, at. Append-only.

### 4.4 Ledger

**LedgerEntry**: id, type, subject_type (`company` | `association`), subject_id, role_id (nullable), match_id (nullable), amount (paise, strictly positive; an entry whose computed amount is 0 is skipped), external_ref (Razorpay id or invoice number), note, created_by, created_at. Append-only; never updated or deleted. Reversals are new entries.

| Type | Subject | Meaning |
|---|---|---|
| `deposit_received` | company | Razorpay captured, or staff-recorded offline receipt |
| `deposit_refund_initiated` | company | Razorpay refund created; `external_ref` = refund id. Informational; not in balances |
| `deposit_refunded` | company | Razorpay `refund.processed` |
| `deposit_forfeited` | company | Staff decision with evidence |
| `deposit_applied_to_fee` | company | Deposit netted against a fee; carries `match_id` |
| `deposit_application_reversed` | company | Applied deposit returned to "held" because the fee was voided; carries `match_id` |
| `fee_due` | company | Invoice raised on hire; carries `match_id` |
| `fee_paid` | company | Payment reconciled (may be partial) |
| `fee_refunded` | company | Paid fee returned to the company (hire fell through after payment); reopens outstanding so it can be voided |
| `fee_voided` | company | Invoice cancelled (hire fell through) |
| `association_share_accrued` | association | Written on each `fee_paid` and each `deposit_applied_to_fee` |
| `association_share_reversed` | association | Written on `deposit_application_reversed` and `fee_refunded`, capped at current balance |
| `association_share_paid_cash` | association | Cash paid against statement |
| `association_share_paid_credit` | association | Sponsorship draw |

Derived balances (no stored columns):
- `depositHeld(role) = received − refunded − forfeited − applied_to_fee + application_reversed`
- `feeOutstanding(match) = fee_due − fee_paid + fee_refunded − fee_voided − applied_to_fee + application_reversed`
- `associationBalance(assoc) = accrued − reversed − paid_cash − paid_credit`

### 4.5 Trust

**TrustEvent**: id, subject_type (`company` | `candidate`), subject_id, type (§10.1 table), weight (signed int, copied from config at write time), evidence JSON, source (`system` | `staff` | `candidate_report` | `association_tip`), occurred_at, recorded_by. Append-only.
**TrustScore**: subject_type, subject_id, score, computed_at, above_lift_since (nullable date; set when score first crosses the lift threshold, cleared when it drops below).

### 4.6 Ops

**ReviewItem**: id, kind (`gate` | `verification` | `leakage` | `join_dispute` | `deposit_resolution` | `candidate_approval` | `alert`), ref_type, ref_id, association_id (nullable; scopes `verification` items to an association's queue), payload JSON, opened_at, resolved_at, resolved_by, resolution. The admin and association queues (§12) are views over this table.
**ConfigValue**: key, value JSON, updated_by, updated_at (§17 lists keys and defaults).
**StaffAction**: id, actor_user_id, action, ref_type, ref_id, note, at. Written by `ops.audit` on every staff action.

**Notification** (owned by `notify`): id, user_id, template, data JSON, channel (`email` | `in_app`), sent_at, read_at, bounce_reason.

## 5. Role lifecycle

```
draft ─→ gated ─→ terms_pending ─→ deposit_pending ─→ broadcast ─→ shortlist_ready ─→ closing ─→ closed
           │  ▲                                                          ▲              │
           ▼  │ appeal                                                   └── reopen ────┘
        rejected

any open state ─→ withdrawn
```

**Terminal states**: `closed`, `withdrawn`, `rejected` (its single exit is the appeal; it cannot be withdrawn and `banCompany` leaves it alone). **Open states**: `draft`, `gated`, `terms_pending`, `deposit_pending`, `broadcast`, `shortlist_ready`. `closing` is neither: it cannot be withdrawn and it resolves on its own.

| State | Entered when | Exits |
|---|---|---|
| `draft` | Company creates the role | Submit → `gated`; withdraw |
| `gated` | Submitted (gate stages 1–3, §7) or appealed (stage 3 only) | Accept → `terms_pending`; reject → `rejected`; needs_review → stays, with a `gate` ReviewItem; withdraw |
| `rejected` | Gate rejected | `appealRole` once, within 14 days → `gated`; otherwise terminal |
| `terms_pending` | Gate accepted; fee terms prefilled | Staff release terms (or auto-release 48h later) → company sees them; company accepts → `deposit_pending`; no acceptance within 14 days of release → `withdrawn` (auto); withdraw |
| `deposit_pending` | Terms accepted; Razorpay order created (amount × probation multiplier if applicable) | `deposit_mode = razorpay`: `payment.captured` webhook → `broadcast`. `deposit_mode = waived`: staff `transition` with a note → `broadcast`. Nothing else. Withdraw |
| `broadcast` | Deposit captured or waived (`broadcast_opens_at` set, `broadcast_closes_at = opens + match.broadcast_days`), or a replacement role created here (`RoleEvent.from_status = null`) | `broadcast_closes_at` reached (default 10 days; staff `extendBroadcast` once by 7 days if <10 applicants) → `shortlist_ready`; withdraw |
| `shortlist_ready` | Window closed, shortlist frozen; `shortlist_ready_at` set | Hire recorded (`hired_match_id`, `hired_at` set) → `closing`; `shortlist_ready_at + 30 days` with no hire → `closing`; withdraw |
| `closing` | Hire recorded or role abandoned | **With a hire**: stays until the guarantee window ends (`joined_on + replacement_guarantee_days`, `guaranteeExpiry`) → `closed`; `didNotJoin` → `shortlist_ready` (reopen: `hired_match_id`, `hired_at` cleared, `shortlist_ready_at` reset). **Without a hire**: `closeRole` after `resolveDeposit` / `resolveDepositReview` / `refundProcessed` (§9.1) → `closed`. No withdraw. Under a ban, continues to resolve |
| `closed` | Terminal | — (`confirmLeakage` may still override a match to `hired` on a closed role; the role stays `closed`) |
| `withdrawn` | Company withdrew, or terms timed out, or company banned | Terminal. `resolveDeposit` runs on entry (§9.1) |

**Replacement roles** (`roles.createReplacement`, from `leftEarly`): a copy of the original's title, JD, type, CTC band, reach, and `fee_terms` with amount 0, `deposit_mode = waived`, `replacement_of_role_id` set, created directly in `broadcast` (gate and terms are inherited from the original, which already passed them); `broadcastRole` is enqueued. From there it follows the normal lifecycle. A hire on a replacement role writes no `fee_due` and no `company.hire_closed`.

Every transition writes a `RoleEvent`. `closeRole` is the only path into `closed` and the final step of `withdrawRole`; it calls `matching.closeOpenMatches`, which moves open-stage matches to `role_closed` (settled stages, including `hired`, are untouched). `deposit_mode = waived` is used for Slice 1 (before Razorpay exists), replacement roles, and staff-approved offline payments; the `deposit_pending → broadcast` waiver transition (`waiveDeposit`) always requires a staff actor and a note.

## 6. Identity and onboarding

### 6.1 Candidate entry paths

**Student via campus email.** Sign-up with an email whose domain matches a `Campus`. Magic link verifies ownership; `campus_id` is set from the domain. The candidate declares `grad_date`, course, and roll number. If the campus has a `roll_number_regex` and the roll number does not match, `roll_number_flag` is set and a `verification` ReviewItem (no association scope) is opened for staff; sign-up still completes. Candidate is `verified` with source `campus_email` immediately. Staff resolve the flag by clearing it, or by setting `verification_state = rejected` and writing `candidate.profile_false`. A nightly job flips `status`: `student → final_year` 12 months before `grad_date`; `→ alumnus` on `grad_date`.

**Graduation handoff.** 60 days before `grad_date`, and 30 days after, a nudge to add a personal email. Both emails stay attached to the `User`; the campus email remains as campus proof after it stops working.

**Alumnus via referral link.** Token encodes `association_id` and optional `role_id`. `referralSignUp` creates the candidate as `referral_pending`, source `referral`, writes `ReferralAttribution(kind=signup)`, and opens a `verification` ReviewItem scoped to that association. They can view and apply to the linked role immediately; the application sits at `applied` and enters the shortlist only once `verified`. The association queue shows name, claimed batch, claimed branch, LinkedIn URL. `resolveVerification`: approve sets `verified`; reject sets `rejected` with a reason (candidate notified; may re-request once, `verification_attempts ≤ 2`); reject-as-fraud additionally writes `candidate.profile_false`.

**Alumnus via direct request.** The candidate picks their campus and declares batch, branch, and LinkedIn URL; created as `verification_pending`, source `association`, with a `verification` ReviewItem scoped to that campus's association (unscoped if the campus has no association yet).

**`verification_source` on approval**: unchanged for `campus_email`; `referral` candidates stay `referral`; direct-request candidates stay `association`; a staff escape-hatch approval sets `staff`.

**Existing candidate following a referral link.** Logged-in candidates opening a role via a link write `ReferralAttribution(kind=visit)`; nothing else changes.

### 6.2 Verification escape hatch

If a `verification` ReviewItem sits unresolved for more than 7 days, it also appears in the staff queue; staff can approve with evidence noted (degree certificate, LinkedIn). `verified_by` records who approved, so associations can audit. Staff can also approve immediately when the association has no admins yet (all of Slice 1).

### 6.3 Candidate profile

CV upload → Claude parse into `parsed_cv` → candidate reviews and edits structured fields → saved to `profile`. The `saveProfile` workflow enqueues `matching.embed_candidate`. One toggle controls nudges: `open_to_opportunities`. Nudges go only to open, verified, `trust_status = ok` candidates.

### 6.4 Company onboarding

Sign-up with a work email; free-mail domains (config list) are refused. Magic link verifies ownership. The first user creates the `Company` with name and becomes `owner`; `verified_domain` is set to the email's domain. Owners invite members by email (`company_invite` template; must share the domain; staff can override for agencies). Staff merge duplicate companies with `mergeCompanies` (roles and users move to the survivor).

### 6.5 Association onboarding

Staff create the `Association` from the admin console (campus, contacts, share_rate, payout_mode from the MoU) and invite admins by email (`association_admin_invite`); the invite creates `AssociationAdmin` on first magic-link sign-in. Admins can invite further admins.

## 7. Role gate

Runs as a job when a role enters `gated` from `draft`. Three stages, in order; the first stage that decides, decides. Each stage writes a `RoleGateDecision`; `Role.final_gate_decision_id` points to the latest. An appeal re-enters `gated` and goes straight to stage 3.

**Stage 1 — Rules** (`gate.evaluateRules`), from config:
- Role-category blocklist (field sales, BPO, data entry, unpaid), matched against title + JD keywords.
- Minimum annual CTC by type (defaults: intern ₹2.4 LPA i.e. ₹20k/month, fresher 6 LPA, experienced 10 LPA).
- Required fields present (JD ≥ 200 chars, CTC band, type, ≥1 location, ≥1 campus).

A rules reject is instant and names the rule. A pass goes to stage 2.

**Stage 2 — Model** (`gate.evaluateModel`). Claude reads the role and returns JSON `{ score: 0-100, suggested_reach: campus_id[], concerns: string[], reason: string }`; stored as `model_score`, `suggested_reach`, `reason`. The prompt includes `internal_tier` per campus as a prior. Thresholds from config (defaults: ≥70 accept, <40 reject, else `needs_review`). If score ≥40 and the company's `campus_reach` includes campuses outside `suggested_reach`, outcome is `needs_review`. A score <40 rejects regardless of reach.

**Stage 3 — Human.** `needs_review` roles, appeals, and reach mismatches open a `gate` ReviewItem. Staff accept (optionally adjusting `campus_reach`) or reject with a reason. An appeal that ends in rejection writes `company.appeal_rejected` (§10.1). Companies on `probation` always go to stage 3 after stage 1.

**Terms.** On acceptance, `fee_terms` is prefilled from config defaults by role type and `years_exp_min` (flat ₹12.5k for interns; 10% for fresher/experienced; 20% when `years_exp_min ≥ 10`). The company is told the role was accepted and that terms are coming. Staff edit terms and release them (`fee_terms_released_at`); if staff do nothing for 48h, the prefilled terms auto-release. The company accepts in the portal; the snapshot and `fee_terms_accepted_at` are stored. Terms cannot change after acceptance.

## 8. Matching and shortlist

`broadcastRole` runs when a role enters `broadcast`; `applyToRole` runs on each application.

1. **Embed.** `matching.embedRole` embeds title + JD + fields into `Role.embedding`.
2. **Filter.** `identity.listMatchableCandidates` returns candidates where `open_to_opportunities`, `verification_state = verified`, `trust_status ≠ blocked`, `campus_id ∈ campus_reach`, and status fits type: intern → `student` or `final_year`; fresher → `final_year`, or `alumnus` with `years_experience ≤ 1`; experienced → `alumnus` with `years_experience` in `[years_exp_min, years_exp_max]`.
3. **Score.** Cosine similarity selects the top 200. A Claude rerank over those applies a structured rubric (skills, seniority, domain, location) and returns `fit_score` and a one-line `fit_reason` per candidate. A `Match(stage=scored)` row is written for each.
4. **Nudge.** Top `nudge_cap` by `fit_score` with `trust_status = ok` get email + in-app. The same hour, every association whose campus is in reach gets the role brief and a `Referral` link (Slice 2 onwards).
5. **Apply.** `matching.listOpenRolesFor(candidate)` is what the candidate app shows: roles in `broadcast` whose `campus_reach` includes the candidate's campus and whose type fits the candidate's status (as in step 2), plus any role a `referral_pending` candidate arrived through. `matching.canApply` enforces the same, plus `trust_status ≠ blocked` and `verification_state ∈ {verified, referral_pending}`; `open_to_opportunities` is not required to apply. Candidate applies → `applied`, `applied_at` set. Candidates outside the scored set are scored on apply. `trust_status = restricted` candidates go to `pending_approval` with a `candidate_approval` ReviewItem; `resolveCandidateApproval` returns them to `applied` (then ranked if the role is still `broadcast`; after freeze they stay `applied` in the longlist) or `declined_by_staff`. Applicants with `verification_state = verified` are ranked by `fit_score`; the top `shortlist_cap` are `shortlisted` with `rank` set. A new higher-scoring applicant displaces the lowest (`shortlisted → applied`, rank cleared, `MatchEvent` written). While the role is `broadcast`, `rerank(roleId)` runs after every apply, withdrawal, verification, or approval and refills the shortlist to `shortlist_cap` from the highest-scoring verified `applied` candidates. Displaced candidates remain visible to staff in the longlist.
6. **Freeze.** At `broadcast_closes_at`, `freezeShortlist` closes applications and freezes ranks; the role moves to `shortlist_ready`; the company is notified. Late verifications after freeze do not enter the shortlist.

**Company view.** Ranked shortlist, profile, `fit_reason`, and actions per the §4.3 transition table: view, interview, offer (requires `offered_ctc`), mark offer accepted, mark offer reneged, hired (requires `hired_ctc` and `joined_on`), reject (requires `rejection_category`, optional note), did not join, left early. Every action goes through `companyAction`, which enforces the §4.3 role precondition and one-hire rule, calls `matching.setStage`, and then any ledger or trust writes the transition requires, in one transaction. The shortlist is not visible to the company before `shortlist_ready`.

**Candidate view.** Their applications and stage. Rejected candidates see `rejection_category` only. `candidateWithdraw` is allowed per §4.3 (from `offer_accepted` it becomes `offer_reneged`); the company is notified (`stage_changed`). Candidates answer `did_you_join` (§9.2) and self-report prompts (§10.2).

## 9. Ledger, deposit, fees, payouts

### 9.1 Deposit

- Amount from the config tier table by `campus_reach` length, × `deposit.probation_multiplier` if the company is on probation at order creation; staff may override on the role.
- `deposit_mode = razorpay`: order created at `terms_pending → deposit_pending`. The `payment.captured` webhook (signature-verified, idempotent on `order_id`) writes `deposit_received` and transitions to `broadcast`. If the role is already `withdrawn` when the webhook arrives, `deposit_received` is written and a refund initiated immediately.
- `deposit_mode = waived`: staff transition with a note; no ledger entry (nothing was received).

**Resolution.** `resolveDeposit` runs on entry to `closing` without a hire, and on entry to `withdrawn`. (With a hire, the deposit is handled by `recordHire`, §9.2.) If `depositHeld(role) = 0` it writes nothing and the role moves to `closed` (or stays `withdrawn`). Otherwise, with `f = engagedShortlistFraction(role)` evaluated at that moment:

| Situation | Outcome |
|---|---|
| No hire 30 days after `shortlist_ready`, `f ≥ deposit.engaged_threshold` | Refund initiated |
| No hire, `f = 0` ("dark") | `company.went_dark` written; `deposit_resolution` ReviewItem; default resolution `deposit_forfeited`, staff must confirm with a note |
| No hire, `0 < f < threshold` | `deposit_resolution` ReviewItem; default resolution refund |
| Withdrawn before `shortlist_ready` | Refund initiated |
| Withdrawn after `shortlist_ready` | Same three "no hire" rows, with `f` evaluated at withdrawal (dark still writes `went_dark`) |
| Withdrawn by `banCompany` | Refund initiated, regardless of `f` |

A `closing` role without a hire moves to `closed` (via `closeRole`) when `depositHeld` reaches 0 through this resolution: immediately on forfeit (`resolveDepositReview`), or on `refundProcessed`. `withdrawn` roles stay `withdrawn`. A `refund.processed` on a role that is `closing` **with** a hire (the §9.2 excess refund) never closes it.

**Refunds.** "Refund initiated" means: the workflow sets `Role.refund_owed` to the amount; `ledger.refund_initiate` (nightly, within the 7-day SLA) creates the Razorpay refund, writes `deposit_refund_initiated` with the refund id, and clears `refund_owed`. `deposit_refunded` is written on the `refund.processed` webhook (idempotent on refund id). An initiated refund with no `processed` after 7 days opens an `alert`. For a `deposit_received` recorded as an offline receipt (no Razorpay payment), staff refund by bank transfer and write `deposit_refunded` manually with a note; `refund_owed` on such a role opens an `alert` instead of a Razorpay call.

`deposit_forfeited` is never automatic; it always needs a staff actor and evidence in `note`.

### 9.2 Success fee

**`recordHire`** (company marks `hired` with `hired_ctc` and `joined_on`; in Slice 1, only step 1 runs; on a replacement role, only step 1 runs):
1. `matching.setStage(hired)`; `Role.hired_match_id`, `hired_at` set; role → `closing`.
2. `fee_due` for the full fee from `fee_terms` × `hired_ctc`, with `match_id`.
3. `deposit_applied_to_fee` for `min(depositHeld, fee)`, with `match_id` (skipped if 0). Share accrues on it (§9.3).
4. If `depositHeld > 0` after step 3, refund initiated for the remainder (so intern hires, where the deposit exceeds the fee, settle immediately).
5. Invoice PDF on Novare letterhead for `feeOutstanding`, due 30 days after `joined_on`; a zero-balance receipt if nothing is outstanding.
6. `company.hire_closed` trust event. Other open matches on the role stay open until the role closes (the company may still reject them).

**Joining** (`confirmJoin`). The `role.join_prompt` job sends `did_you_join` on `max(joined_on, hired_at)` and sets `join_prompt_sent_at`.
- Candidate **yes** → `join_confirmed_at` set (`by = candidate`), `candidate.joined` written.
- Candidate **no** → a `join_dispute` ReviewItem opens; the company is notified (`join_disputed`) and has `fee.join_dispute_days` (3) to confirm the hire or agree the candidate did not join. Company agrees or stays silent → `didNotJoin`. Company confirms the hire → staff resolve the dispute; staff resolution either sets `join_confirmed_at` (`by = staff`) or runs `didNotJoin`.
- **No answer** from the candidate for `fee.join_grace_days` (7) after `join_prompt_sent_at` → `join_confirmed_at` set (`by = grace`), `candidate.joined` written.
- Company marks **did not join** directly (before `join_confirmed_at`) → `didNotJoin` immediately.

**`didNotJoin`** (requires the role to be `closing`), in this order: (1) `deposit_application_reversed` for the applied amount, with matching `association_share_reversed` (§9.3); (2) `fee_refunded` for any `fee_paid` already collected (actual bank refund is a staff task; the entry records the obligation and opens an `alert`), with `association_share_reversed`; (3) `fee_voided` for `feeOutstanding` (now equal to `fee_due`); (4) match → `did_not_join`; (5) role → `shortlist_ready` (reopen per §5), so the company can hire another shortlisted candidate; the deposit, now held again, resolves under §9.1 or a new `recordHire`. In Slice 1 only steps 4–5 run.

**Left early.** Company marks `left_early` (after `join_confirmed_at`, within `replacement_guarantee_days`) → `leftEarly`: the fee stands (no ledger entries); `roles.createReplacement` makes the replacement role per §5; the original role proceeds to `closed` via `guaranteeExpiry`.

**Payment.** `fee_paid` written by staff via `reconcileFee`; partial payments allowed; any amount above `feeOutstanding` is rejected. `company.fee_paid_on_time` written when `feeOutstanding` reaches 0 on or before the due date. `fee_reminder` sent 7 days before due and on the due date by `ledger.fee_due_reminders`.

### 9.3 Association attribution

Evaluated on each `fee_paid` and each `deposit_applied_to_fee`. Candidates with `verification_source = campus_email` never attribute (students belong to the free campus channel, even if they once opened a role via an association link). For all others, precedence:
1. `ReferralAttribution` (signup or visit) for a referral tied to this role.
2. `ReferralAttribution` for any earlier referral from an association.
3. `verification_source = association` (the association verified them).
4. None.

`association_share_accrued = collected_amount × share_rate`, written per collection entry, so partial payments accrue proportionally. Nothing accrues on `fee_due`. On `deposit_application_reversed` or `fee_refunded`, `association_share_reversed = reversed_amount × share_rate`, capped at `associationBalance`; if the cap bites (the share was already paid out), an `alert` opens for staff to recover it on the next statement.

### 9.4 Payout

- `payout_mode = cash`: monthly statement generated on the 1st; the association invoices Novare; staff write `association_share_paid_cash` on payment.
- `payout_mode = sponsorship_credit`: balance accrues; staff write `association_share_paid_credit` for each sponsorship draw with a note.
- Association portal shows attributed hires (candidate shown by batch and role unless `name_visible_to_association`; this applies to attribution views only, the verification queue always shows the name), accrued, reversed, paid, balance.

### 9.5 Invariants (enforced in `ledger.record`)

- `depositHeld(role) ≥ 0`; `feeOutstanding(match) ≥ 0`; `associationBalance ≥ 0`.
- `refunded + forfeited + applied_to_fee − application_reversed ≤ received` per role.
- `application_reversed ≤ applied_to_fee` per match; `fee_refunded ≤ fee_paid` per match.
- `fee_paid − fee_refunded + fee_voided + applied_to_fee − application_reversed ≤ fee_due` per match.
- `association_share_reversed ≤ association_share_accrued` per association.

## 10. Trust and leakage

### 10.1 Trust score

Both companies and candidates start at 100. `score = clamp(100 + Σ weight × decay(age), 0, 100)`, decay linear to zero over 12 months. Recomputed on every `TrustEvent` write and nightly for all subjects. Internal-only.

| Type | Subject | Default weight | Written by |
|---|---|---|---|
| `company.hire_closed` | company | +5 | `recordHire` |
| `company.fee_paid_on_time` | company | +3 | `reconcileFee` |
| `company.shortlist_actioned_promptly` | company | +2 | `nightlyTrust` (≥1 qualifying action within `trust.prompt_action_days` of `shortlist_ready`) |
| `company.went_dark` | company | −15 | `resolveDeposit` |
| `company.fee_overdue` | company | −15 | `nightlyTrust` (`trust.overdue_days` past due, once per invoice) |
| `company.off_platform_hire` | company | −40 | `confirmLeakage` (staff) |
| `company.appeal_rejected` | company | −10 | `gateDecision` |
| `candidate.joined` | candidate | +5 | `confirmJoin` |
| `candidate.self_report_answered` | candidate | +1 | `selfReportAnswer` |
| `candidate.interview_no_show` | candidate | −10 | `companyAction` with `rejection_category = no_show` |
| `candidate.offer_reneged` | candidate | −25 | `companyAction` or `candidateWithdraw` into `offer_reneged` |
| `candidate.profile_false` | candidate | −50 | `resolveVerification` (reject-as-fraud) or staff roll-number resolution |

**Company status** (computed by `trust`, written via `identity.setCompanyStatus`): score <70 → `probation` (deposit multiplier, every role goes to human review); <40 → `banned`. `trust.recompute` returns the threshold crossings; whichever workflow called it (or `nightlyTrust`) then runs `banCompany`: `identity.lockCompanyUsers`, every open role → `withdrawRole` (deposits refunded via §9.1), `closing` roles continue to resolve, open matches → `declined_by_staff`. Probation lifts when `above_lift_since` ≤ today − 30 days with lift threshold 75. Ban lifts only by staff `liftBan` with a note.

**Candidate `trust_status`** (written via `identity.setCandidateTrustStatus`): score <60 → `restricted` (nudges stop, applications need approval); <30 → `blocked` → `blockCandidate`: `matching.declineOpenMatches(candidateId)`, cannot apply. Lifts at ≥65 / ≥35 respectively, checked nightly.

### 10.2 Leakage detection

Signals, cheapest first. Every signal opens a `leakage` ReviewItem; staff confirm before any ledger or trust write.

1. **Candidate self-report.** 30 and 90 days after `shortlist_ready`, every shortlisted candidate not at `hired` gets "Did this company hire you?" Any answer writes `candidate.self_report_answered`; a yes opens a ReviewItem.
2. **Company declaration.** The hiring terms require reporting any hire of a shortlisted candidate within 12 months of `shortlist_ready_at`. A declared hire on a `shortlist_ready` role goes through `recordHire`; on a `closing` or `closed` role (including a second hire from the same shortlist), through `confirmLeakage` without the trust penalty.
3. **Association tips.** Associations see outcomes for their own alumni and can flag a suspected off-platform hire.
4. **Public-profile check.** Weekly job compares each shortlisted candidate's `profile.current_company`, plus any public source legal counsel clears in writing, against companies that shortlisted them in the last 12 months. No LinkedIn scraping in v1.

**`confirmLeakage`** (staff resolution): staff override the match to `hired` with the discovered CTC and joining date (`data.override = true`; the role's status is unchanged); if `depositHeld > 0` → `deposit_forfeited`; `fee_due` for the full success fee under the role's terms (no deposit applied), invoice generated, due 30 days from confirmation, reminders and `fee_overdue` apply as for any invoice; `company.off_platform_hire` written unless the company self-declared. Attribution and association share follow the normal collection path.

## 11. Notifications

| Template | To | Channel |
|---|---|---|
| `magic_link` | any | email |
| `company_invite` / `association_admin_invite` | invitee | email |
| `add_personal_email` | candidate | email + in-app |
| `verification_approved` / `verification_rejected` (with reason) | candidate | email + in-app |
| `role_nudge` | candidate | email + in-app |
| `application_received` | candidate | in-app |
| `stage_changed` | candidate (on `shortlisted`, `interviewed`, `offered`, `rejected`, `declined_by_staff`, `role_closed`; not `viewed` or displacement) / company (on `withdrawn`, `offer_reneged`) | email + in-app |
| `hire_recorded` / `role_closed` / `replacement_created` | company | email + in-app |
| `self_report_prompt` (30/90d) | candidate | email + in-app |
| `did_you_join` | candidate | email + in-app |
| `role_accepted` / `role_rejected` (with reason) / `role_needs_review` | company | email + in-app |
| `terms_released` / `terms_expired` | company | email + in-app |
| `deposit_captured` / `deposit_refunded` / `deposit_forfeited` | company | email + in-app |
| `shortlist_ready` / `broadcast_extended` | company | email + in-app |
| `join_disputed` | company | email + in-app |
| `fee_invoice` (PDF) / `fee_reminder` | company | email |
| `verification_request` | association admins | email + in-app |
| `role_brief_with_referral` | association admins | email + in-app |
| `monthly_statement` | association admins | email |
| `staff_alert` (every `alert` ReviewItem) | staff | email + in-app |

Bounces increment `UserEmail.bounce_count`; the next send falls back to the user's other verified email; two bounces on all emails open an `alert` ReviewItem.

## 12. Admin console (Novare staff)

Queues (views over `ReviewItem`): gate review, verification (unscoped items plus any association-scoped item older than 7 days), candidate approval, join disputes, leakage, deposit resolution, alerts. Views: roles by state, companies with trust score and status, candidates with trust score, associations with balances, ledger per subject (company and association), config editor, month-end CSV export. Actions: every role transition, deposit waiver, broadcast extension, fee reconciliation, payout entries, company merge, association creation, ban lift, leakage confirmation. Every staff action is recorded by `ops.audit`.

**Association portal** queue: `ReviewItem(kind=verification, association_id = theirs)`.

## 13. Error handling

- **Razorpay webhooks**: signature-verified; idempotent on `order_id` / `payment_id` / `refund_id`; Razorpay retries. A role in `deposit_pending` for >24h whose order shows captured on Razorpay opens an `alert`; a refund initiated >7 days ago with no `processed` opens an `alert`. A capture on a withdrawn role is refunded (§9.1).
- **Jobs** (gate, embed, matching, nightly): pg-boss, 3 attempts, exponential backoff. Final failure writes `Role.job_error` (or an `alert` for non-role jobs) and opens an `alert` ReviewItem.
- **LLM calls**: 30s timeout, one retry, schema validation; an invalid response is a failure, never a decision. CV-parse failure leaves the candidate on the manual profile form. Embedding failure keeps the previous embedding and retries hourly.
- **Email**: bounces per §11.
- **Ledger**: invariant violations (§9.5) rejected at the service layer and logged.
- **Workflows**: each runs in one DB transaction; a failure rolls back every module write, and the `alert` ReviewItem is written in a separate transaction after the rollback.

## 14. Testing

**Unit** (per package): gate rules table and threshold routing with fixture responses; matching filter, ranking, displacement, freeze, every transition in the §4.3 table (legal and illegal), `engagedShortlistFraction`; ledger invariants, derived balances, attribution precedence, proportional share and reversal cap, deposit-exceeds-fee settlement, `didNotJoin` ordering leaving `feeOutstanding = 0`; trust decay, thresholds, hysteresis via `above_lift_since`, status materialisation; role state machine (every legal and illegal transition, including withdraw rules and `closing` holding until guarantee expiry).

**Integration** (`services/api`, seeded Postgres): the full loop — post role → rules pass → model accept (fixture) → terms released and accepted → Razorpay webhook (simulated) → broadcast → nudge → apply × N → displacement → freeze → company actions → hired → `fee_due` → `deposit_applied_to_fee` → `did_you_join` yes → `fee_paid` → `association_share_accrued` → guarantee expiry → `closed` → statement. Also: Slice-1 path with `deposit_mode = waived` through hire and guarantee expiry to `closed`; intern hire where deposit > fee → excess refund; referral sign-up → association approve → enters shortlist; escape-hatch approval; appeal → human accept; dark company → forfeit via ReviewItem; candidate "no" → dispute → `didNotJoin` → reversal + void → reopen → second hire; `didNotJoin` after partial `fee_paid` → `fee_refunded`; left-early → replacement role; withdraw at each open state; `banCompany` with a `closing` role; confirmed off-platform hire on a closed role → override + `fee_due`; capture-after-withdraw → refund.

**Fixtures**: every Claude call is recorded once and replayed; `LLM_RECORD=1` refreshes.

**Manual acceptance** before launch: one real role from a Novare pipeline client run end-to-end on staging with a Razorpay test-mode payment.

## 15. Build order

1. **Slice 1 — Core loop, no money.** `db`, `shared`, `ops`, auth, `identity` (student sign-up, profile, company sign-up, invites, merge), `roles` + `gate`, `matching`, `notify`, candidate app, company portal (post role, accept terms, shortlist actions including hired / did-not-join / left-early), admin console (gate queue, verification queue, join-dispute queue, alerts queue, role transitions incl. waiver and extension, fee-terms edit and release; config editor). All roles use `deposit_mode = waived`; `resolveDeposit` is the `depositHeld = 0` no-op; `recordHire` runs only its matching/role steps; `didNotJoin` runs only its matching/role steps; staff record deposits and fees outside the system. **Excluded from Slice 1:** Razorpay, `ledger`, `trust`, the candidate-approval queue (no candidate can be `restricted` without `trust`), the association portal, referral links (§6.1 referral paths, §8 step 4 association brief), and all association templates. Alumni in Slice 1 are verified by staff via the escape hatch.
2. **Slice 2 — Ledger.** Razorpay deposit and refund webhooks, `resolveDeposit`, full `recordHire` / `didNotJoin` / `leftEarly`, invoice, reconciliation, association portal, referral links, attribution, payouts, statements.
3. **Slice 3 — Trust.** Trust events, score, status materialisation, candidate-approval queue, `banCompany` / `liftBan`, leakage signals, leakage queue, `confirmLeakage`.
4. **Migration.** Import 1.0 users and assessed candidates; invite them to complete 2.0 profiles.

## 16. Open items for Sahil

- Legal: contract language for deposit forfeiture, 12-month ownership of introduction, and the company's reporting duty. Counsel to clear any public-profile source for §10.2 signal 4.
- Entity for Razorpay and invoicing: Novare Talent Private Limited.
- Hosting choice (Vercel + Railway vs. Fly) at implementation.
- Headcount: one sales-plus-success person per ~20 active companies, to be validated after Slice 2.

## 17. Appendix A — Config keys and defaults

All money values in paise; all durations in days unless named otherwise.

| Key | Default |
|---|---|
| `deposit.tiers` | `[{max_campuses:5, amount:1500000}, {max_campuses:12, amount:3000000}, {max_campuses:23, amount:6000000}]` |
| `deposit.probation_multiplier` | 2 (applied at order creation) |
| `deposit.engaged_threshold` | 0.5 |
| `deposit.dark_days` | 30 |
| `deposit.refund_sla_days` | 7 |
| `deposit.stuck_alert_hours` | 24 |
| `fee.intern_flat` | 1250000 |
| `fee.percent_default` | 0.10 |
| `fee.percent_senior` | 0.20 |
| `fee.senior_years` | 10 |
| `fee.replacement_days` | 90 |
| `fee.due_days_after_join` | 30 |
| `fee.reminder_days_before_due` | 7 |
| `fee.join_grace_days` | 7 |
| `fee.join_dispute_days` | 3 |
| `gate.blocklist` | `["field sales","bpo","data entry","unpaid"]` |
| `gate.min_ctc` | `{intern:24000000, fresher:60000000, experienced:100000000}` |
| `gate.accept_threshold` / `gate.reject_threshold` | 70 / 40 |
| `gate.terms_auto_release_hours` | 48 |
| `gate.terms_timeout_days` | 14 |
| `gate.appeal_window_days` | 14 |
| `match.broadcast_days` | 10 |
| `match.extension_days` / `match.extension_min_applicants` | 7 / 10 |
| `match.shortlist_cap` / `match.nudge_cap` / `match.rerank_pool` | 25 / 150 / 200 |
| `trust.weights` | per §10.1 |
| `trust.company.probation` / `.ban` / `.probation_lift` / `.lift_days` | 70 / 40 / 75 / 30 |
| `trust.candidate.restricted` / `.blocked` / `.restricted_lift` / `.blocked_lift` | 60 / 30 / 65 / 35 |
| `trust.decay_months` | 12 |
| `trust.prompt_action_days` | 7 |
| `trust.overdue_days` | 30 |
| `trust.self_report_days` | `[30, 90]` |
| `trust.leakage_lookback_months` | 12 |
| `identity.freemail_domains` | Personal mailbox providers: Gmail, Yahoo, Outlook/Hotmail/Live/MSN, iCloud, Proton, Rediffmail, AOL, Zoho, GMX, Mail.com, Yandex and their country variants (full list in `packages/ops/src/defaults.ts`). Candidates may use these or a campus address; companies may use neither. |
| `identity.escape_hatch_days` | 7 |
| `identity.max_verification_attempts` | 2 |
| `identity.final_year_months_before_grad` | 12 |
| `identity.grad_nudge_days` | `[-60, 30]` |

## 18. Appendix B — Scheduled jobs

| Job | Schedule | Does |
|---|---|---|
| `candidate.status_flip` | nightly | student → final_year → alumnus by `grad_date` |
| `candidate.grad_nudge` | nightly | `add_personal_email` at `identity.grad_nudge_days` |
| `role.terms_auto_release` | hourly | release prefilled terms after 48h |
| `role.terms_timeout` | nightly | `terms_pending` → `withdrawn` after 14 days unaccepted; `terms_expired` sent |
| `role.close_broadcast` | hourly | runs `freezeShortlist` at `broadcast_closes_at` |
| `role.dark_check` | nightly | `shortlist_ready` → `closing` at `shortlist_ready_at + deposit.dark_days` with no hire |
| `role.guarantee_expiry` | nightly | runs `guaranteeExpiry` for `closing` roles with a hire past `joined_on + replacement_guarantee_days` |
| `role.join_prompt` | nightly | sends `did_you_join` for `hired` matches at `max(joined_on, hired_at)` |
| `role.join_grace` | nightly | runs `confirmJoin` (grace / dispute expiry) |
| `ledger.refund_initiate` | nightly | create Razorpay refunds for roles with `refund_owed` set (`ledger.pendingRefunds()`), write `deposit_refund_initiated`, clear `refund_owed` |
| `ledger.fee_due_reminders` | nightly | `fee_reminder` at −7 days and on due date |
| `ledger.monthly_statement` | 1st of month | association statements |
| `trust.recompute_all` (`nightlyTrust`) | nightly | decay, thresholds, `above_lift_since`, status writes, `fee_overdue` and `shortlist_actioned_promptly` events, `banCompany` |
| `trust.self_report` | nightly | prompts at `trust.self_report_days` after `shortlist_ready_at` |
| `trust.public_profile_check` | weekly | §10.2 signal 4 |
| `ops.stuck_deposit_alert` | hourly | `deposit_pending` >24h with captured payment; refunds initiated >7 days unprocessed |
| `ops.embedding_retry` | hourly | retry failed embeddings |
