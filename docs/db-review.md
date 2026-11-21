# zenhyre2 schema review (2026-11-21)

**Scope:** every table, column, constraint, index and enum in `zenhyre2`, checked against the DBMS notes:
- normalisation, 1NF to BCNF
- keys and integrity constraints
- derived and multivalued attributes
- views
- indexing

**Result:** migration `0006_optimise_constraints_indexes`. The tables are unchanged (32). It drops 18 columns and 3 indexes, and adds 17 foreign keys (2 of them composite), 24 checks, and 8 indexes (2 of them unique rules). One bug was fixed.

## 1. Redundancy removed (normalisation: no stored copies, no update anomalies)

| Dropped | Why | Where the value lives now |
|---|---|---|
| `payment_order.company_id`, `ledger_entry.company_id`, `invoice.company_id` | Transitive dependency (3NF): row → role → company. A company merge moves the role, and these copies would have gone stale: an update anomaly | `role.company_id` |
| `role.deposit_order_id`, `role.refund_owed` | Superseded by the payment tables; never written | `payment_order`, `deposit_settlement` |
| `legacy_profile.first_name`, `last_name`, `phone`, `linkedin_url`, `github_url`, `profile_image`, `resume_url` | Duplicated `user`'s person columns from 0005: two places to update | `user` (the migration copies anything missing there first) |
| `legacy_profile.company_name` | Duplicated the company, or the raw 1.0 row | `company`, or `legacy_profile.source->>'company_name'` |
| `legacy_job.applied_count`, `shortlisted_count` | Derived attributes, which are not stored | `count(*)` over `legacy_application` |
| `legacy_job.company_id` | Derivable from the employer | `company_user` of `employer_user_id` |
| `candidate.embedding_updated_at`, `candidate.name_visible_to_association` | Never read or written | They return with pgvector and the association attribution views |

The `zenhyre2.profiles` view (1.0's `profiles` shape) now reads the 1.0 company name from the kept source row, so it is unchanged for readers.

## 2. Integrity: keys and constraints

**Foreign keys added.** Every id column now points at a row that exists:
- `role.created_by`, `role.replacement_of_role_id` (self), `role.hired_match_id` and `role.final_gate_decision_id`. These were the "circular" ones; that is fine in Postgres because they are nullable.
- `notification.user_id` and `staff_action.actor_user_id`.
- `invite.invited_by`, `company_user.invited_by` and `association_admin.invited_by`.
- `company_billing.updated_by`, `payment_order.created_by` and `payment_order.match_id`.
- `ledger_entry.match_id`, `review_item.association_id` and `legacy_record.user_id`.

**Composite foreign keys.** `deposit_settlement (payment_order_id, role_id)` and `ledger_entry (payment_order_id, role_id)` reference `payment_order (id, role_id)`. A settlement or ledger line can therefore never name one role and another role's payment. `role_id` stays on those rows because every balance query is by role; the composite key makes keeping it safe.

**Uniqueness:**
- `company_user_one_company_uq`: one company per person, the database-level form of "one email, one seat".
- `user_email_one_primary_uq`: at most one primary address per person.

**Checks (domain constraints):**

| Table | Rule |
|---|---|
| `user` | `is_finance` only with `is_staff` |
| `user_email` | lower-case and well-formed; `bounce_count ≥ 0` |
| `company` | lower-case domain |
| `invite` | `purpose` is one of the two kinds |
| `association` | `share_rate` between 0 and 1 |
| `campus` | `internal_tier` between 1 and 3 |
| `candidate` | `verification_attempts ≥ 0` |
| `role` | CTC ≥ 0 and min ≤ max; years min ≤ max; caps > 0; deposit ≥ 0 |
| `role_gate_decision` | `model_score` between 0 and 100 |
| `match` | `fit_score` between 0 and 100; `rank > 0`; CTCs > 0 |
| `match_event` | `actor_kind` is one of the four kinds |
| `company_billing` | 2-digit state code, 10-digit Indian mobile, GSTIN format |
| `invoice` | `total = taxable + CGST + SGST + IGST` |
| `invoice_counter` | `last ≥ 0` |
| `payment_order` | currency is INR |
| `rate_limit` | `count ≥ 0` |

**Bug found by the new constraint.** `identity.mergeCompanies` copied each person into the surviving company and then deleted the old membership. With one company per person, the copy was skipped and the delete would have left merged people with no company. It now moves the membership row with a single `UPDATE`.

## 3. Speed: indexes

Postgres does not index foreign-key columns automatically, so the hot lookups got indexes.

| Added | Serves |
|---|---|
| `user_email (user_id)` | Every sign-in, email delivery and `/me`: a person's addresses |
| `company_user (company_id)` | Listing a company's people (every company notification) |
| `candidate (campus_id)` | Matching: candidates on the campuses a role reaches |
| `association_admin (association_id)` | An association's admins |
| `deposit_settlement (status) WHERE status IN ('requested','processing')` | The settlement worker's queue. It replaces a full `status` index that mostly indexed finished rows |
| `legacy_job (employer_user_id)` | A client's 1.0 jobs |

**Dropped** (an index costs space and slows every write):
- `deposit_settlement_status_idx`, replaced by the partial index above.
- `legacy_profile_role_idx`, which is low-cardinality and nothing queries by it.
- `legacy_job_company_idx`, whose column is gone.

## 4. Kept on purpose

| Looks like | Why it stays |
|---|---|
| Arrays: `role.campus_reach`, `role.locations`, `campus.email_domains`, `role_gate_decision.suggested_reach`, `legacy_job.tags` (multivalued attributes) | Small, read whole, and filtered with array operators. A join table each would add five tables and joins on the hottest matching query, for no integrity the app does not already check |
| JSONB snapshots: `invoice.billing`, `invoice.supplier`, `invoice.lines`, `payment_order.billing`, `role.fee_terms` | They record what was true at that moment (an invoice must not change when the company edits its address). Copying here is the requirement, not redundancy |
| `candidate.profile` (JSONB) | Semi-structured and edited as one document; nothing filters on most of it |
| Stored derived values: `candidate.status`, `match.rank`, `role.hired_match_id` | Each is a decision fixed at a point in time (the status the nightly job set, the frozen shortlist order, the one recorded hire), not a recomputable value |
| `deposit_settlement.role_id`, `ledger_entry.role_id` | See the composite keys above: the fast path for per-role balances, kept consistent by the database |
| `deposit_mode` value `razorpay` | Postgres cannot drop an enum value without rebuilding the type; nothing writes it |
| `ON DELETE` = no action everywhere | Money and history are append-only; nothing is deleted, so a cascade would only hide a mistake |
| Append-only event tables (`role_event`, `match_event`, `ledger_entry`) | The audit trail. The ledger also refuses `UPDATE` and `DELETE` (trigger in 0003) |

Not needed at this size: partitioning, sharding and replicas (notes LEC-17 to 21). The largest table is about 1,000 rows. Revisit at hundreds of thousands of rows or with heavy read traffic.

## 5. Applying it

`packages/db/supabase/apply-migrations.sql` (regenerated) now applies 0006 after 0005; it is safe to run again.

On data like Supabase's (0004 with the 1.0 import), it was tested to:
- move names, phone and links from `legacy_profile` onto `user`
- lower-case domains
- clear a finance flag without staff
- keep the `profiles` view working

After running it, re-run `import-from-1.0.sql` (the function no longer writes the dropped columns).
