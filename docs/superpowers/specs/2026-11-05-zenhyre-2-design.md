# Zenhyre 2.0 — Design Spec

**Date:** 2026-11-05
**Author:** Sahil Sheoran (Novare Talent), with Claude
**Status:** Draft for review (rev 3)

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

Association-run events, candidate-to-company messaging, ATS integrations, multi-currency, LinkedIn scraping, public "campus tier" labels, candidate account deletion / PII retention tooling (handled by staff request in v1).

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
- Auth: magic-link email (no passwords), 15-minute single-use links. Sessions as HTTP-only cookies. One `User` can have many emails.
- Hosting: Vercel for the apps, Railway or Fly for the API + Postgres. Decided at implementation.

### 3.3 Module boundaries

Each package owns its tables and exposes a small typed interface. Cross-module calls go through those interfaces, never through another module's tables. Modules never call each other in a cycle; the dependency order is `db → ops → identity → roles → matching → ledger → trust`, with `gate`, `notify`, `shared` as leaves.

**Orchestration.** Any operation that touches more than one module is a **workflow** in `services/api/src/workflows/`. A workflow calls module interfaces in sequence inside one DB transaction and returns; modules do not emit events or subscribe to each other. Slow follow-ups (embedding, sending email, Razorpay calls) are enqueued as pg-boss jobs from the workflow after commit. Named workflows: `submitRole`, `gateDecision`, `acceptTerms`, `depositCaptured`, `broadcastRole`, `applyToRole`, `companyAction` (every `setStage` from the company portal), `recordHire`, `didNotJoin`, `leftEarly`, `resolveDeposit`, `refundProcessed`, `reconcileFee`, `confirmLeakage`, `banCompany`, `withdrawRole`, `nightlyTrust`.

| Module | Owns tables | Exposes |
|---|---|---|
| `ops` | ReviewItem, ConfigValue, StaffAction | `openReview`, `resolveReview`, `listReviews`, `config.get/set`, `audit(actor, action, ref)` |
| `identity` | Campus, User, UserEmail, Candidate, Company, CompanyUser, Association, AssociationAdmin | `signUpCandidate`, `signUpCompany`, `verifyCandidate`, `rejectVerification`, `setCandidateOpen`, `saveProfile`, `listMatchableCandidates(filter)`, `getCandidate`, `getCompany`, `setCompanyStatus`, `setCandidateTrustStatus`, `inviteCompanyUser`, `inviteAssociationAdmin`, `lockCompanyUsers` |
| `roles` | Role, RoleEvent, RoleGateDecision, Referral, ReferralAttribution | `create`, `submit`, `get`, `transition(roleId, to, actor, note)`, `appeal`, `recordGateDecision`, `setFeeTerms`, `releaseTerms`, `acceptTerms`, `createReferral`, `recordReferralAttribution`, `attributionFor(candidateId, roleId)` |
| `gate` | — (pure) | `evaluateRules(role, config) → GateOutcome`, `evaluateModel(role, config) → GateOutcome` |
| `matching` | Match, MatchEvent | `embedCandidate`, `embedRole`, `broadcast(roleId, candidates)`, `apply(roleId, candidateId)`, `freeze(roleId)`, `setStage(matchId, stage, actor, data)`, `closeOpenMatches(roleId)`, `actionCount(roleId)`, `listShortlist(roleId)` |
| `ledger` | LedgerEntry | `record(entry)`, `depositHeld(roleId)`, `feeOutstanding(matchId)`, `associationBalance(associationId)`, `pendingRefunds()` |
| `trust` | TrustEvent, TrustScore | `record(event)`, `recompute(subject)`, `recomputeAll()`, `scoreOf`, `statusOf` |
| `notify` | Notification | `send(userId, template, data)` |

Every state change on `Role`, `Match`, and the ledger is an append-only event row. Balances and scores are derived from history. `Company.status` and `Candidate.trust_status` are the only status columns written on another module's behalf: `trust` computes them and calls `identity.setCompanyStatus` / `setCandidateTrustStatus`.

## 4. Data model

Core entities (Postgres tables; snake_case in the schema).

### 4.1 Identity

**Campus**: id, name, short_code, email_domains[], roll_number_regex (nullable), internal_tier (int, never exposed).

**User**: id, created_at, is_staff (bool). Other roles are derived from membership rows (Candidate, CompanyUser, AssociationAdmin).
**UserEmail**: user_id, email, verified_at, is_primary, campus_id (set when domain matches a campus), bounce_count.

**Candidate**: user_id, campus_id, grad_date (date), course, roll_number (nullable), roll_number_flag (bool), status (`student` | `final_year` | `alumnus`), verification_state (`verified` | `referral_pending` | `verification_pending` | `rejected`), verification_attempts (int), verification_source (`campus_email` | `referral` | `association` | `staff`), verified_by (user_id or `system`), verified_at, open_to_opportunities (bool), trust_status (`ok` | `restricted` | `blocked`), profile JSON, embedding vector(1536), embedding_updated_at, name_visible_to_association (bool, default false).

`profile` JSON fields: headline, skills[], years_experience (decimal), current_company, current_title, preferred_roles[], preferred_locations[], notice_period_days, current_ctc (optional), linkedin_url, cv_url, parsed_cv JSON.

**Company**: id, name, verified_domain, status (`active` | `probation` | `banned`), status_changed_at, created_at.
**CompanyUser**: user_id, company_id, role (`owner` | `member`), invited_by, joined_at, locked_at (nullable).

**Association**: id, campus_id, name, contacts JSON, share_rate (decimal, default 0.15), payout_mode (`cash` | `sponsorship_credit`), mou_signed_at. (One association per campus; `Campus` has no back-reference.)
**AssociationAdmin**: user_id, association_id, invited_by, joined_at.

### 4.2 Roles

**Role**: id, company_id, title, jd, type (`intern` | `fresher` | `experienced`), ctc_min, ctc_max (annual INR; monthly stipend × 12 for interns), years_exp_min, years_exp_max, locations[], campus_reach (campus_id[]), status (§5), final_gate_decision_id (latest `RoleGateDecision`), fee_terms JSON, fee_terms_released_at, fee_terms_accepted_at, deposit_amount, deposit_mode (`razorpay` | `waived`), deposit_order_id, broadcast_opens_at, broadcast_closes_at, broadcast_extended_at (nullable), shortlist_cap (default 25), nudge_cap (default 150), replacement_of_role_id (nullable), embedding vector(1536), job_error (nullable text), created_at.

`fee_terms` JSON: kind (`flat` | `percent`), amount (paise for flat, decimal for percent), replacement_guarantee_days (default 90), notes.

**RoleEvent**: id, role_id, from_status, to_status, actor_user_id or `system`, note, at. Append-only.

**RoleGateDecision**: id, role_id, stage (`rules` | `model` | `human`), outcome (`accept` | `reject` | `needs_review`), reason, suggested_reach (campus_id[]), model_score (nullable), decided_by, decided_at.

**Referral**: id, association_id, role_id (nullable for general links), token (unique), created_at.
**ReferralAttribution**: referral_id, candidate_id, kind (`signup` | `visit`), at. Unique on (referral_id, candidate_id). Written on sign-up through a link, and when a logged-in candidate opens a role via a link.

### 4.3 Matching

**Match**: id, role_id, candidate_id, fit_score (0–100), fit_reason, nudged_at, applied_at, rank (nullable; set only while in the shortlist), stage (below), rejection_category (nullable enum: `skills` | `experience` | `location` | `compensation` | `culture` | `position_filled` | `no_show` | `other`), rejection_note, offered_ctc, hired_ctc, joined_on (date), join_confirmed_at (nullable), updated_at. Unique on (role_id, candidate_id).

Main chain: `scored` → `applied` → `pending_approval` (restricted candidates only) → `shortlisted` → `viewed` → `interviewed` → `offered` → `offer_accepted` → `hired`.

Side exits:
- `rejected` — by company, from `shortlisted` onwards; `rejection_category` required. Category `no_show` also writes `candidate.interview_no_show`.
- `declined_by_staff` — from `pending_approval`; or from any non-terminal stage when the candidate becomes `blocked`.
- `withdrawn` — by candidate, any stage before `hired`.
- `offer_reneged` — from `offer_accepted`, when the candidate backs out.
- `did_not_join` — from `hired`, before `join_confirmed_at` is set. Fee voided (§9.2).
- `left_early` — from `hired`, after `join_confirmed_at`, within `replacement_guarantee_days`. Fee stands; replacement role (§9.2).
- `role_closed` — system, when the role is withdrawn or closed while the match is non-terminal.

Displacement moves `shortlisted` → `applied` and clears `rank`. **Qualifying actions** (used by §9.1 and §10.1) are company-initiated transitions to `interviewed`, `offered`, or `rejected`; `viewed` does not count.

**MatchEvent**: id, match_id, from_stage, to_stage, actor_user_id or `system`, data JSON, at. Append-only.

### 4.4 Ledger

**LedgerEntry**: id, type, subject_type (`company` | `association`), subject_id, role_id (nullable), match_id (nullable), amount (paise, always positive), external_ref (Razorpay id or invoice number), note, created_by, created_at. Append-only; never updated or deleted. Reversals are new entries.

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
| `fee_voided` | company | Invoice cancelled (hire fell through) |
| `association_share_accrued` | association | Written on each `fee_paid` and each `deposit_applied_to_fee` |
| `association_share_paid_cash` | association | Cash paid against statement |
| `association_share_paid_credit` | association | Sponsorship draw |

Derived balances (no stored columns):
- `depositHeld(role) = received − refunded − forfeited − applied_to_fee + application_reversed`
- `feeOutstanding(match) = fee_due − fee_paid − fee_voided − applied_to_fee + application_reversed`
- `associationBalance(assoc) = accrued − paid_cash − paid_credit`

### 4.5 Trust

**TrustEvent**: id, subject_type (`company` | `candidate`), subject_id, type (§10.1 table), weight (signed int, copied from config at write time), evidence JSON, source (`system` | `staff` | `candidate_report` | `association_tip`), occurred_at, recorded_by. Append-only.
**TrustScore**: subject_type, subject_id, score, computed_at, above_lift_since (nullable date; set when score first crosses the lift threshold, cleared when it drops below).

### 4.6 Ops

**ReviewItem**: id, kind (`gate` | `verification` | `leakage` | `deposit_resolution` | `candidate_approval` | `alert`), ref_type, ref_id, association_id (nullable; scopes `verification` items to an association's queue), payload JSON, opened_at, resolved_at, resolved_by, resolution. The admin and association queues (§12) are views over this table.
**ConfigValue**: key, value JSON, updated_by, updated_at (§17 lists keys and defaults).
**StaffAction**: id, actor_user_id, action, ref_type, ref_id, note, at. Written by `ops.audit` on every staff action.

**Notification** (owned by `notify`): id, user_id, template, data JSON, channel (`email` | `in_app`), sent_at, read_at, bounce_reason.

## 5. Role lifecycle

```
draft ─→ gated ─→ terms_pending ─→ deposit_pending ─→ broadcast ─→ shortlist_ready ─→ closing ─→ closed
           │  ▲                                                          ▲              │
           ▼  │ appeal                                                   └── reopen ────┘
        rejected

any state except closing/closed/withdrawn ─→ withdrawn
```

| State | Entered when | Exits |
|---|---|---|
| `draft` | Company creates the role | Submit → `gated`; withdraw |
| `gated` | Submitted (gate stages 1–3, §7) or appealed (stage 3 only) | Accept → `terms_pending`; reject → `rejected`; needs_review → stays, with a `gate` ReviewItem; withdraw |
| `rejected` | Gate rejected | Company appeals once, within 14 days → `gated`; else terminal |
| `terms_pending` | Gate accepted; fee terms prefilled | Staff release terms (or auto-release 48h later) → company sees them; company accepts → `deposit_pending`; no acceptance within 14 days of release → `withdrawn` (auto); withdraw |
| `deposit_pending` | Terms accepted; Razorpay order created (amount × probation multiplier if applicable) | `deposit_mode = razorpay`: `payment.captured` webhook → `broadcast`. `deposit_mode = waived`: staff `transition` with a note → `broadcast`. Nothing else. Withdraw |
| `broadcast` | Deposit resolved | `broadcast_closes_at` reached (default 10 days; staff may extend once by 7 days if <10 applicants) → `shortlist_ready`; withdraw |
| `shortlist_ready` | Window closed, shortlist frozen | Hire recorded → `closing`; 30 days with no hire → `closing`; withdraw |
| `closing` | Hire recorded or role abandoned | `resolveDeposit` workflow completes (§9.1) → `closed`; staff reopen (hire fell through via `did_not_join`) → `shortlist_ready`. No withdraw |
| `closed` | Terminal | — |
| `withdrawn` | Company withdrew, or terms timed out, or company banned | Terminal. `resolveDeposit` runs on entry (§9.1) |

Every transition writes a `RoleEvent`. On entry to `withdrawn` or `closed`, `matching.closeOpenMatches` moves non-terminal matches to `role_closed`. `deposit_mode = waived` is used for Slice 1 (before Razorpay exists), replacement roles, and staff-approved offline payments; it always requires a staff actor and a note.

## 6. Identity and onboarding

### 6.1 Candidate entry paths

**Student via campus email.** Sign-up with an email whose domain matches a `Campus`. Magic link verifies ownership; `campus_id` is set from the domain. The candidate declares `grad_date`, course, and roll number. If the campus has a `roll_number_regex` and the roll number does not match, `roll_number_flag` is set and a `verification` ReviewItem (no association scope) is opened for staff; sign-up still completes. Candidate is `verified` with source `campus_email` immediately. Staff resolve the flag by clearing it, or by setting `verification_state = rejected` and writing `candidate.profile_false`. A nightly job flips `status`: `student → final_year` 12 months before `grad_date`; `→ alumnus` on `grad_date`.

**Graduation handoff.** 60 days before `grad_date`, and 30 days after, a nudge to add a personal email. Both emails stay attached to the `User`; the campus email remains as campus proof after it stops working.

**Alumnus via referral link.** Token encodes `association_id` and optional `role_id`. Sign-up creates the candidate as `referral_pending`, source `referral`, writes `ReferralAttribution(kind=signup)`, and opens a `verification` ReviewItem scoped to that association. They can view and apply to the linked role immediately; the application sits at `applied` and enters the shortlist only once `verified`. The association queue shows name, claimed batch, claimed branch, LinkedIn URL. One click sets `verified`; one click sets `rejected` with a reason (candidate notified; may re-request once, `verification_attempts ≤ 2`).

**Alumnus via direct request.** Same as above with no role attached; `verification_pending`.

**Existing candidate following a referral link.** Logged-in candidates opening a role via a link write `ReferralAttribution(kind=visit)`; nothing else changes.

### 6.2 Verification escape hatch

If a `verification` ReviewItem sits unresolved for more than 7 days, it also appears in the staff queue; staff can approve with evidence noted (degree certificate, LinkedIn). `verified_by` records who approved, so associations can audit. Staff can also approve immediately when the association has no admins yet (all of Slice 1).

### 6.3 Candidate profile

CV upload → Claude parse into `parsed_cv` → candidate reviews and edits structured fields → saved to `profile`. `identity.saveProfile` enqueues a `matching.embed_candidate` job. One toggle controls nudges: `open_to_opportunities`. Nudges go only to open, verified, `trust_status = ok` candidates.

### 6.4 Company onboarding

Sign-up with a work email; free-mail domains (config list) are refused. Magic link verifies ownership. The first user creates the `Company` with name and becomes `owner`; `verified_domain` is set to the email's domain. Owners invite members by email (`company_invite` template; must share the domain; staff can override for agencies). Staff can merge duplicate companies from the admin console.

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

Runs when a role enters `broadcast` (`broadcastRole` workflow), and incrementally on each new applicant (`applyToRole`).

1. **Embed.** `matching.embedRole` embeds title + JD + fields into `Role.embedding`.
2. **Filter.** `identity.listMatchableCandidates` returns candidates where `open_to_opportunities`, `verification_state = verified`, `trust_status ≠ blocked`, `campus_id ∈ campus_reach`, and status fits type: intern → `student` or `final_year`; fresher → `final_year`, or `alumnus` with `years_experience ≤ 1`; experienced → `alumnus` with `years_experience` in `[years_exp_min, years_exp_max]`.
3. **Score.** Cosine similarity selects the top 200. A Claude rerank over those applies a structured rubric (skills, seniority, domain, location) and returns `fit_score` and a one-line `fit_reason` per candidate. A `Match(stage=scored)` row is written for each.
4. **Nudge.** Top `nudge_cap` by `fit_score` with `trust_status = ok` get email + in-app. The same hour, every association whose campus is in reach gets the role brief and a `Referral` link (Slice 2 onwards).
5. **Apply.** Candidate applies → `applied`, `applied_at` set. Candidates outside the scored set are scored on apply. `trust_status = restricted` candidates go to `pending_approval` with a `candidate_approval` ReviewItem; staff approve → `applied`, or decline → `declined_by_staff`. Applicants with `verification_state = verified` are ranked by `fit_score`; the top `shortlist_cap` are `shortlisted` with `rank` set. A new higher-scoring applicant displaces the lowest (`shortlisted → applied`, rank cleared, `MatchEvent` written). Displaced candidates remain visible to staff in the longlist.
6. **Freeze.** At `broadcast_closes_at`, applications close and ranks are frozen; the role moves to `shortlist_ready`; the company is notified. Late verifications after freeze do not enter the shortlist.

**Company view.** Ranked shortlist, profile, `fit_reason`, and actions along the stage chain: view, interview, offer (requires `offered_ctc`), mark offer accepted, hired (requires `hired_ctc` and `joined_on`), or reject (requires `rejection_category`, optional note). Every action goes through the `companyAction` workflow, which calls `matching.setStage` and then any ledger or trust writes the transition requires, in one transaction.

**Candidate view.** Their applications and stage. Rejected candidates see `rejection_category` only. Candidates can withdraw before `hired`, and answer the `did_you_join` prompt (§9.2).

## 9. Ledger, deposit, fees, payouts

### 9.1 Deposit

- Amount from the config tier table by `campus_reach` length, × `deposit.probation_multiplier` if the company is on probation at order creation; staff may override on the role.
- `deposit_mode = razorpay`: order created at `terms_pending → deposit_pending`. The `payment.captured` webhook (signature-verified, idempotent on `order_id`) writes `deposit_received` and transitions to `broadcast`. If the role is already `withdrawn` when the webhook arrives, `deposit_received` is written and a refund initiated immediately.
- `deposit_mode = waived`: staff transition with a note; no ledger entry (nothing was received).

**Resolution.** The `resolveDeposit` workflow runs on entry to `closing` and on entry to `withdrawn`. If `depositHeld(role) = 0` it writes nothing and the role moves to `closed` (or stays `withdrawn`). Otherwise:

| Situation | Outcome |
|---|---|
| Hire recorded | Handled by `recordHire` (§9.2): deposit applied to the fee, excess refunded |
| No hire 30 days after `shortlist_ready`, qualifying actions on ≥50% of shortlisted candidates (config) | Refund initiated |
| No hire, 0 qualifying actions ("dark") | `deposit_resolution` ReviewItem; default resolution `deposit_forfeited`, staff must confirm with a note |
| No hire, qualifying actions on 1–49% | `deposit_resolution` ReviewItem; default resolution refund |
| Withdrawn before `shortlist_ready` | Refund initiated |
| Withdrawn after `shortlist_ready` (incl. ban) | Treated as "no hire" per the rows above, except ban → refund initiated |

The `company.went_dark` trust event is written by the workflow in the dark row, at the moment the role enters `closing` (it is an observed fact, not a judgement). The role moves to `closed` when the final deposit entry (`deposit_refunded` or `deposit_forfeited`) is written; `withdrawn` roles stay `withdrawn`.

**Refunds.** "Refund initiated" means a Razorpay refund created within 7 days and a `deposit_refund_initiated` entry with the refund id. `deposit_refunded` is written on the `refund.processed` webhook (idempotent on refund id). `ledger.pendingRefunds()` lists resolutions with no `deposit_refund_initiated`; the nightly job initiates those only. An initiated refund with no `processed` after 7 days opens an `alert`.

`deposit_forfeited` is never automatic; it always needs a staff actor and evidence in `note`.

### 9.2 Success fee

**`recordHire` workflow** (company marks `hired`, with `hired_ctc` and `joined_on`):
1. `fee_due` for the full fee from `fee_terms` × `hired_ctc`, with `match_id`.
2. `deposit_applied_to_fee` for `min(depositHeld, fee)`, with `match_id`. Share accrues on it (§9.3).
3. If `depositHeld > fee`, refund initiated for the remainder (so intern hires, where the deposit exceeds the fee, settle immediately).
4. Invoice PDF on Novare letterhead for `feeOutstanding`, due 30 days after `joined_on`. If `feeOutstanding = 0`, a zero-balance receipt instead.
5. `company.hire_closed` trust event. Role → `closing` → `closed` once any refund is processed.

**Joining.** On `joined_on`, the candidate gets `did_you_join`. Yes → `join_confirmed_at` set, `candidate.joined` written. No, or company marks `did_not_join` → `didNotJoin` workflow: `fee_voided` for `feeOutstanding`, `deposit_application_reversed` for any applied amount (deposit is held again), match → `did_not_join`, role → `shortlist_ready` (staff reopen) so the company can hire another shortlisted candidate; the deposit then resolves under §9.1 when the role closes again. If the two sides disagree, a `leakage` ReviewItem opens.

**Left early.** Company marks `left_early` (after `join_confirmed_at`, within `replacement_guarantee_days`) → `leftEarly` workflow: the fee stands; staff create a replacement role with `replacement_of_role_id`, `deposit_mode = waived`, `fee_terms` amount 0.

**Payment.** `fee_paid` written by staff on bank reconciliation; partial payments allowed; `reconcileFee` rejects any amount above `feeOutstanding`. `company.fee_paid_on_time` written when `feeOutstanding` reaches 0 on or before the due date. `fee_reminder` sent 7 days before due and on the due date by `ledger.fee_due_reminders`.

### 9.3 Association attribution

Evaluated on each `fee_paid` and each `deposit_applied_to_fee`. Candidates with `verification_source = campus_email` never attribute (students belong to the free campus channel, even if they once opened a role via an association link). For all others, precedence:
1. `ReferralAttribution` (signup or visit) for a referral tied to this role.
2. `ReferralAttribution` for any earlier referral from an association.
3. `verification_source = association` (the association verified them).
4. None.

`association_share_accrued = collected_amount × share_rate`, written per collection entry, so partial payments accrue proportionally. Nothing accrues on `fee_due`. A `fee_voided` or `deposit_application_reversed` after accrual opens an `alert` for staff to net on the next statement.

### 9.4 Payout

- `payout_mode = cash`: monthly statement generated on the 1st; the association invoices Novare; staff write `association_share_paid_cash` on payment.
- `payout_mode = sponsorship_credit`: balance accrues; staff write `association_share_paid_credit` for each sponsorship draw with a note.
- Association portal shows attributed hires (candidate shown by batch and role unless `name_visible_to_association`; this applies to attribution views only, the verification queue always shows the name), accrued, paid, balance.

### 9.5 Invariants (enforced in `ledger.record`)

- `depositHeld(role) ≥ 0`; `feeOutstanding(match) ≥ 0`; `associationBalance ≥ 0`.
- `refunded + forfeited + applied_to_fee − application_reversed ≤ received` per role.
- `fee_paid + fee_voided + applied_to_fee − application_reversed ≤ fee_due` per match.
- `deposit_application_reversed ≤ deposit_applied_to_fee` per match.
- Admin console has a ledger view per company and per association, and a month-end CSV export.

## 10. Trust and leakage

### 10.1 Trust score

Both companies and candidates start at 100. `score = clamp(100 + Σ weight × decay(age), 0, 100)`, decay linear to zero over 12 months. Recomputed on every `TrustEvent` write and nightly for all subjects. Internal-only.

| Type | Subject | Default weight | Written by |
|---|---|---|---|
| `company.hire_closed` | company | +5 | `recordHire` |
| `company.fee_paid_on_time` | company | +3 | `reconcileFee` |
| `company.shortlist_actioned_promptly` | company | +2 | `nightlyTrust` (≥1 qualifying action within 7 days of `shortlist_ready`) |
| `company.went_dark` | company | −15 | `resolveDeposit` |
| `company.fee_overdue` | company | −15 | `nightlyTrust` (30 days past due, once per invoice) |
| `company.off_platform_hire` | company | −40 | `confirmLeakage` (staff) |
| `company.appeal_rejected` | company | −10 | `gateDecision` |
| `candidate.joined` | candidate | +5 | `did_you_join` = yes |
| `candidate.self_report_answered` | candidate | +1 | self-report handler |
| `candidate.interview_no_show` | candidate | −10 | `companyAction` with `rejection_category = no_show` |
| `candidate.offer_reneged` | candidate | −25 | `offer_accepted → offer_reneged` |
| `candidate.profile_false` | candidate | −50 | staff or association, from verification |

**Company status** (computed by `trust`, written via `identity.setCompanyStatus`): score <70 → `probation` (deposit multiplier, every role goes to human review); <40 → `banned` → `banCompany` workflow: `identity.lockCompanyUsers`, every non-terminal role → `withdrawn` (deposits refunded via §9.1), open matches → `role_closed`. Probation lifts when `above_lift_since` ≤ today − 30 days with lift threshold 75. Ban lifts only by staff action with a note.

**Candidate `trust_status`** (written via `identity.setCandidateTrustStatus`): score <60 → `restricted` (nudges stop, applications need approval); <30 → `blocked` (non-terminal matches → `declined_by_staff`, cannot apply). Lifts at ≥65 / ≥35 respectively, checked nightly.

### 10.2 Leakage detection

Signals, cheapest first. Every signal opens a `leakage` ReviewItem; staff confirm before any ledger or trust write.

1. **Candidate self-report.** 30 and 90 days after `shortlist_ready`, every shortlisted candidate not at `hired` gets "Did this company hire you?" Any answer writes `candidate.self_report_answered`; a yes opens a ReviewItem.
2. **Company declaration.** The hiring terms require reporting any hire of a shortlisted candidate within 12 months of `shortlist_ready`. A declared hire goes through `recordHire` (staff reopen the role first if needed).
3. **Association tips.** Associations see outcomes for their own alumni and can flag a suspected off-platform hire.
4. **Public-profile check.** Weekly job compares each shortlisted candidate's `profile.current_company`, plus any public source legal counsel clears in writing, against companies that shortlisted them in the last 12 months. No LinkedIn scraping in v1.

**`confirmLeakage` workflow** (staff resolution): if `depositHeld > 0` → `deposit_forfeited`; in all cases → the match is set to `hired` by staff with the discovered CTC and `fee_due` for the full success fee under the role's terms (the company's declaration duty makes this an ordinary invoice; no deposit is applied), plus `company.off_platform_hire`. Attribution and association share follow the normal collection path.

## 11. Notifications

| Template | To | Channel |
|---|---|---|
| `magic_link` | any | email |
| `company_invite` / `association_admin_invite` | invitee | email |
| `add_personal_email` | candidate | email + in-app |
| `verification_approved` / `verification_rejected` (with reason) | candidate | email + in-app |
| `role_nudge` | candidate | email + in-app |
| `application_received` | candidate | in-app |
| `stage_changed` | candidate | email + in-app |
| `self_report_prompt` (30/90d) | candidate | email + in-app |
| `did_you_join` | candidate | email + in-app |
| `role_accepted` / `role_rejected` (with reason) / `role_needs_review` | company | email + in-app |
| `terms_released` / `terms_expired` | company | email + in-app |
| `deposit_captured` / `deposit_refunded` / `deposit_forfeited` | company | email + in-app |
| `shortlist_ready` / `broadcast_extended` | company | email + in-app |
| `fee_invoice` (PDF) / `fee_reminder` | company | email |
| `verification_request` | association admins | email + in-app |
| `role_brief_with_referral` | association admins | email + in-app |
| `monthly_statement` | association admins | email |
| `staff_alert` (every `alert` ReviewItem) | staff | email + in-app |

Bounces increment `UserEmail.bounce_count`; the next send falls back to the user's other verified email; two bounces on all emails open an `alert` ReviewItem.

## 12. Admin console (Novare staff)

Queues (views over `ReviewItem`): gate review, verification (unscoped items plus any association-scoped item older than 7 days), candidate approval, leakage, deposit resolution, alerts. Views: roles by state, companies with trust score and status, candidates with trust score, associations with balances, ledger per subject, config editor, month-end exports. Actions: every role transition, deposit waiver, fee reconciliation, payout entries, company merge, association creation, ban lift. Every staff action is recorded by `ops.audit`.

**Association portal** queue: `ReviewItem(kind=verification, association_id = theirs)`.

## 13. Error handling

- **Razorpay webhooks**: signature-verified; idempotent on `order_id` / `payment_id` / `refund_id`; Razorpay retries. A role in `deposit_pending` for >24h whose order shows captured on Razorpay opens an `alert`; a refund initiated >7 days ago with no `processed` opens an `alert`. A capture on a withdrawn role is refunded (§9.1).
- **Jobs** (gate, embed, matching, nightly): pg-boss, 3 attempts, exponential backoff. Final failure writes `Role.job_error` (or an `alert` for non-role jobs) and opens an `alert` ReviewItem.
- **LLM calls**: 30s timeout, one retry, schema validation; an invalid response is a failure, never a decision. CV-parse failure leaves the candidate on the manual profile form. Embedding failure keeps the previous embedding and retries hourly.
- **Email**: bounces per §11.
- **Ledger**: invariant violations (§9.5) rejected at the service layer and logged.
- **Workflows**: each runs in one DB transaction; a failure rolls back every module write and opens an `alert`.

## 14. Testing

**Unit** (per package): gate rules table and threshold routing with fixture responses; matching filter, ranking, displacement, freeze, every stage transition (legal and illegal), qualifying-action counting; ledger invariants, derived balances, attribution precedence, proportional share, deposit-exceeds-fee settlement; trust decay, thresholds, hysteresis via `above_lift_since`, status materialisation; role state machine (every legal and illegal transition, including withdraw rules).

**Integration** (`services/api`, seeded Postgres): the full loop — post role → rules pass → model accept (fixture) → terms released and accepted → Razorpay webhook (simulated) → broadcast → nudge → apply × N → displacement → freeze → company actions → hired → `fee_due` → `deposit_applied_to_fee` → `fee_paid` → `association_share_accrued` → statement. Also: Slice-1 path with `deposit_mode = waived` through to `closed`; intern hire where deposit > fee → excess refund; referral sign-up → association approve → enters shortlist; escape-hatch approval; appeal → human accept; dark company → forfeit via ReviewItem; did-not-join → `fee_voided` + `deposit_application_reversed` → reopen → second hire; left-early → replacement role; withdraw at each state; probation and ban thresholds and the `banCompany` workflow; confirmed off-platform hire after refund → `fee_due`; capture-after-withdraw → refund.

**Fixtures**: every Claude call is recorded once and replayed; `LLM_RECORD=1` refreshes.

**Manual acceptance** before launch: one real role from a Novare pipeline client run end-to-end on staging with a Razorpay test-mode payment.

## 15. Build order

1. **Slice 1 — Core loop, no money.** `db`, `shared`, `ops`, auth, `identity` (student sign-up, profile, company sign-up and invites), `roles` + `gate`, `matching`, `notify`, candidate app, company portal (post role, accept terms, shortlist actions), admin console (gate queue, verification queue, candidate approval queue, role transitions, config editor). All roles use `deposit_mode = waived`; `resolveDeposit` is the `depositHeld = 0` no-op; staff record deposits and fees outside the system. **Excluded from Slice 1:** Razorpay, `ledger`, `trust`, the association portal, referral links (§6.1 referral paths, §8 step 4 association brief), and all association templates. Alumni in Slice 1 are verified by staff via the escape hatch.
2. **Slice 2 — Ledger.** Razorpay deposit and refund webhooks, `resolveDeposit`, `recordHire`, `didNotJoin`, `leftEarly`, invoice, reconciliation, association portal, referral links, attribution, payouts, statements.
3. **Slice 3 — Trust.** Trust events, score, status materialisation, `banCompany`, leakage signals, leakage queue.
4. **Migration.** Import 1.0 users and assessed candidates; invite them to complete 2.0 profiles.

## 16. Open items for Sahil

- Legal: contract language for deposit forfeiture, 12-month ownership of introduction, and the company's reporting duty. Counsel to clear any public-profile source for §10.2 signal 4.
- Entity for Razorpay and invoicing: Novare Talent Private Limited.
- Hosting choice (Vercel + Railway vs. Fly) at implementation.
- Headcount: one sales-plus-success person per ~20 active companies, to be validated after Slice 2.

## 17. Appendix A — Config keys and defaults

All money values in paise.

| Key | Default |
|---|---|
| `deposit.tiers` | `[{max_campuses:5, amount:1500000}, {max_campuses:12, amount:3000000}, {max_campuses:23, amount:6000000}]` |
| `deposit.probation_multiplier` | 2 (applied at order creation) |
| `deposit.engaged_threshold` | 0.5 |
| `deposit.dark_days` | 30 |
| `deposit.refund_sla_days` | 7 |
| `fee.intern_flat` | 1250000 |
| `fee.percent_default` | 0.10 |
| `fee.percent_senior` | 0.20 |
| `fee.senior_years` | 10 |
| `fee.replacement_days` | 90 |
| `fee.due_days_after_join` | 30 |
| `fee.reminder_days_before_due` | 7 |
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
| `identity.freemail_domains` | gmail.com, yahoo.com, outlook.com, hotmail.com, … |
| `identity.escape_hatch_days` | 7 |
| `identity.max_verification_attempts` | 2 |

## 18. Appendix B — Scheduled jobs

| Job | Schedule | Does |
|---|---|---|
| `candidate.status_flip` | nightly | student → final_year → alumnus by `grad_date` |
| `candidate.grad_nudge` | nightly | `add_personal_email` at −60 and +30 days |
| `role.terms_auto_release` | hourly | release prefilled terms after 48h |
| `role.terms_timeout` | nightly | `terms_pending` → `withdrawn` after 14 days unaccepted; `terms_expired` sent |
| `role.close_broadcast` | hourly | `broadcast` → `shortlist_ready` at `broadcast_closes_at` |
| `role.dark_check` | nightly | `shortlist_ready` → `closing` after 30 days with no hire |
| `ledger.refund_initiate` | nightly | create Razorpay refunds for `pendingRefunds()` |
| `ledger.fee_due_reminders` | nightly | `fee_reminder` at −7 days and on due date |
| `ledger.monthly_statement` | 1st of month | association statements |
| `trust.recompute_all` (`nightlyTrust`) | nightly | decay, thresholds, `above_lift_since`, status writes, `fee_overdue` and `shortlist_actioned_promptly` events |
| `trust.self_report` | nightly | prompts at 30 and 90 days after `shortlist_ready` |
| `trust.public_profile_check` | weekly | §10.2 signal 4 |
| `ops.stuck_deposit_alert` | hourly | `deposit_pending` >24h with captured payment; refunds initiated >7 days unprocessed |
| `ops.embedding_retry` | hourly | retry failed embeddings |
