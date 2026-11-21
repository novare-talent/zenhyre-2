-- 0006: simpler, tighter schema (docs/db-review.md). Order matters: keep the data first, then change the shape.
-- 1. Person details from 1.0 still only in legacy_profile go onto user (0005's columns) before those columns are dropped.
UPDATE "zenhyre2"."user" u SET
  first_name = coalesce(u.first_name, lp.first_name), last_name = coalesce(u.last_name, lp.last_name),
  phone = coalesce(u.phone, lp.phone), linkedin_link = coalesce(u.linkedin_link, lp.linkedin_url),
  github_link = coalesce(u.github_link, lp.github_url), profile_image = coalesce(u.profile_image, lp.profile_image),
  resume_url = coalesce(u.resume_url, lp.resume_url)
FROM "zenhyre2"."legacy_profile" lp WHERE lp.user_id = u.id;--> statement-breakpoint
-- 2. Imported data in the shape the new checks expect (they are no-ops on data 2.0 wrote).
UPDATE "zenhyre2"."user_email" SET email = lower(email) WHERE email <> lower(email);--> statement-breakpoint
UPDATE "zenhyre2"."company" SET verified_domain = lower(verified_domain) WHERE verified_domain <> lower(verified_domain);--> statement-breakpoint
UPDATE "zenhyre2"."user" SET is_finance = false WHERE is_finance AND NOT is_staff;--> statement-breakpoint
-- 3. The profiles view reads the 1.0 company name from the kept source row instead of the column being dropped.
CREATE OR REPLACE VIEW "zenhyre2"."profiles" AS
SELECT u.id, u.first_name, u.last_name, u.phone, u.github_link, u.linkedin_link, u.profile_image, u.created_at, u.updated_at,
  (SELECT e.email FROM "zenhyre2"."user_email" e WHERE e.user_id = u.id ORDER BY e.is_primary DESC, e.email LIMIT 1) AS email,
  CASE WHEN u.is_staff THEN 'admin'
       WHEN EXISTS (SELECT 1 FROM "zenhyre2"."company_user" cu WHERE cu.user_id = u.id) THEN 'client'
       WHEN EXISTS (SELECT 1 FROM "zenhyre2"."candidate" c WHERE c.user_id = u.id) THEN 'user'
       WHEN EXISTS (SELECT 1 FROM "zenhyre2"."association_admin" a WHERE a.user_id = u.id) THEN 'association'
       ELSE coalesce(lp.legacy_role, 'user') END AS role,
  u.resume_url,
  (lp.source->'github_profile')::json AS github_profile,
  coalesce((SELECT co.name FROM "zenhyre2"."company_user" cu JOIN "zenhyre2"."company" co ON co.id = cu.company_id WHERE cu.user_id = u.id LIMIT 1),
           nullif(lp.source->>'company_name', '')) AS company_name,
  u.is_subscribed,
  coalesce((lp.source->>'welcome_email')::boolean, false) AS welcome_email,
  coalesce((lp.source->>'referral_applied')::boolean, false) AS referral_applied
FROM "zenhyre2"."user" u
LEFT JOIN "zenhyre2"."legacy_profile" lp ON lp.user_id = u.id;
--> statement-breakpoint
-- 4. The (id, role_id) key the composite foreign keys below point at.
ALTER TABLE "zenhyre2"."payment_order" ADD CONSTRAINT "payment_order_id_role_uq" UNIQUE("id","role_id");--> statement-breakpoint
ALTER TABLE "zenhyre2"."invoice" DROP CONSTRAINT "invoice_company_id_company_id_fk";
--> statement-breakpoint
ALTER TABLE "zenhyre2"."ledger_entry" DROP CONSTRAINT "ledger_entry_company_id_company_id_fk";
--> statement-breakpoint
ALTER TABLE "zenhyre2"."payment_order" DROP CONSTRAINT "payment_order_company_id_company_id_fk";
--> statement-breakpoint
ALTER TABLE "zenhyre2"."legacy_job" DROP CONSTRAINT "legacy_job_company_id_company_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "deposit_settlement_status_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "legacy_job_company_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "legacy_profile_role_idx";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."association_admin" ADD CONSTRAINT "association_admin_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "zenhyre2"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."company_user" ADD CONSTRAINT "company_user_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "zenhyre2"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."invite" ADD CONSTRAINT "invite_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "zenhyre2"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."review_item" ADD CONSTRAINT "review_item_association_id_association_id_fk" FOREIGN KEY ("association_id") REFERENCES "zenhyre2"."association"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."staff_action" ADD CONSTRAINT "staff_action_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "zenhyre2"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "zenhyre2"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."role" ADD CONSTRAINT "role_final_gate_decision_id_role_gate_decision_id_fk" FOREIGN KEY ("final_gate_decision_id") REFERENCES "zenhyre2"."role_gate_decision"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."role" ADD CONSTRAINT "role_replacement_of_role_id_role_id_fk" FOREIGN KEY ("replacement_of_role_id") REFERENCES "zenhyre2"."role"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."role" ADD CONSTRAINT "role_hired_match_id_match_id_fk" FOREIGN KEY ("hired_match_id") REFERENCES "zenhyre2"."match"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."role" ADD CONSTRAINT "role_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "zenhyre2"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."company_billing" ADD CONSTRAINT "company_billing_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "zenhyre2"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."deposit_settlement" ADD CONSTRAINT "deposit_settlement_order_role_fk" FOREIGN KEY ("payment_order_id","role_id") REFERENCES "zenhyre2"."payment_order"("id","role_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."ledger_entry" ADD CONSTRAINT "ledger_entry_match_id_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "zenhyre2"."match"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."ledger_entry" ADD CONSTRAINT "ledger_entry_order_role_fk" FOREIGN KEY ("payment_order_id","role_id") REFERENCES "zenhyre2"."payment_order"("id","role_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."payment_order" ADD CONSTRAINT "payment_order_match_id_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "zenhyre2"."match"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."payment_order" ADD CONSTRAINT "payment_order_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "zenhyre2"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."legacy_record" ADD CONSTRAINT "legacy_record_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "zenhyre2"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "association_admin_association_idx" ON "zenhyre2"."association_admin" USING btree ("association_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_campus_idx" ON "zenhyre2"."candidate" USING btree ("campus_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_user_one_company_uq" ON "zenhyre2"."company_user" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_user_company_idx" ON "zenhyre2"."company_user" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_email_user_idx" ON "zenhyre2"."user_email" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_email_one_primary_uq" ON "zenhyre2"."user_email" USING btree ("user_id") WHERE is_primary;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deposit_settlement_pending_idx" ON "zenhyre2"."deposit_settlement" USING btree ("status") WHERE status in ('requested', 'processing');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "legacy_job_employer_idx" ON "zenhyre2"."legacy_job" USING btree ("employer_user_id");--> statement-breakpoint
ALTER TABLE "zenhyre2"."candidate" DROP COLUMN IF EXISTS "embedding_updated_at";--> statement-breakpoint
ALTER TABLE "zenhyre2"."candidate" DROP COLUMN IF EXISTS "name_visible_to_association";--> statement-breakpoint
ALTER TABLE "zenhyre2"."role" DROP COLUMN IF EXISTS "deposit_order_id";--> statement-breakpoint
ALTER TABLE "zenhyre2"."role" DROP COLUMN IF EXISTS "refund_owed";--> statement-breakpoint
ALTER TABLE "zenhyre2"."invoice" DROP COLUMN IF EXISTS "company_id";--> statement-breakpoint
ALTER TABLE "zenhyre2"."ledger_entry" DROP COLUMN IF EXISTS "company_id";--> statement-breakpoint
ALTER TABLE "zenhyre2"."payment_order" DROP COLUMN IF EXISTS "company_id";--> statement-breakpoint
ALTER TABLE "zenhyre2"."legacy_job" DROP COLUMN IF EXISTS "company_id";--> statement-breakpoint
ALTER TABLE "zenhyre2"."legacy_job" DROP COLUMN IF EXISTS "applied_count";--> statement-breakpoint
ALTER TABLE "zenhyre2"."legacy_job" DROP COLUMN IF EXISTS "shortlisted_count";--> statement-breakpoint
ALTER TABLE "zenhyre2"."legacy_profile" DROP COLUMN IF EXISTS "first_name";--> statement-breakpoint
ALTER TABLE "zenhyre2"."legacy_profile" DROP COLUMN IF EXISTS "last_name";--> statement-breakpoint
ALTER TABLE "zenhyre2"."legacy_profile" DROP COLUMN IF EXISTS "phone";--> statement-breakpoint
ALTER TABLE "zenhyre2"."legacy_profile" DROP COLUMN IF EXISTS "linkedin_url";--> statement-breakpoint
ALTER TABLE "zenhyre2"."legacy_profile" DROP COLUMN IF EXISTS "github_url";--> statement-breakpoint
ALTER TABLE "zenhyre2"."legacy_profile" DROP COLUMN IF EXISTS "profile_image";--> statement-breakpoint
ALTER TABLE "zenhyre2"."legacy_profile" DROP COLUMN IF EXISTS "resume_url";--> statement-breakpoint
ALTER TABLE "zenhyre2"."legacy_profile" DROP COLUMN IF EXISTS "company_name";--> statement-breakpoint
ALTER TABLE "zenhyre2"."association" ADD CONSTRAINT "association_share_rate_ck" CHECK (share_rate >= 0 and share_rate <= 1);--> statement-breakpoint
ALTER TABLE "zenhyre2"."campus" ADD CONSTRAINT "campus_tier_ck" CHECK (internal_tier between 1 and 3);--> statement-breakpoint
ALTER TABLE "zenhyre2"."candidate" ADD CONSTRAINT "candidate_attempts_ck" CHECK (verification_attempts >= 0);--> statement-breakpoint
ALTER TABLE "zenhyre2"."company" ADD CONSTRAINT "company_domain_lowercase_ck" CHECK (verified_domain = lower(verified_domain));--> statement-breakpoint
ALTER TABLE "zenhyre2"."invite" ADD CONSTRAINT "invite_purpose_ck" CHECK (purpose in ('company_invite', 'association_admin_invite'));--> statement-breakpoint
ALTER TABLE "zenhyre2"."user" ADD CONSTRAINT "user_finance_is_staff_ck" CHECK (not is_finance or is_staff);--> statement-breakpoint
ALTER TABLE "zenhyre2"."user_email" ADD CONSTRAINT "user_email_lowercase_ck" CHECK (email = lower(email) and position('@' in email) > 1);--> statement-breakpoint
ALTER TABLE "zenhyre2"."user_email" ADD CONSTRAINT "user_email_bounce_ck" CHECK (bounce_count >= 0);--> statement-breakpoint
ALTER TABLE "zenhyre2"."rate_limit" ADD CONSTRAINT "rate_limit_count_ck" CHECK (count >= 0);--> statement-breakpoint
ALTER TABLE "zenhyre2"."role" ADD CONSTRAINT "role_ctc_ck" CHECK ((ctc_min is null or ctc_min >= 0) and (ctc_max is null or ctc_max >= 0) and (ctc_min is null or ctc_max is null or ctc_min <= ctc_max));--> statement-breakpoint
ALTER TABLE "zenhyre2"."role" ADD CONSTRAINT "role_years_ck" CHECK (years_exp_min >= 0 and years_exp_min <= years_exp_max);--> statement-breakpoint
ALTER TABLE "zenhyre2"."role" ADD CONSTRAINT "role_caps_ck" CHECK (shortlist_cap > 0 and nudge_cap > 0);--> statement-breakpoint
ALTER TABLE "zenhyre2"."role" ADD CONSTRAINT "role_deposit_ck" CHECK (deposit_amount is null or deposit_amount >= 0);--> statement-breakpoint
ALTER TABLE "zenhyre2"."role_gate_decision" ADD CONSTRAINT "role_gate_decision_score_ck" CHECK (model_score is null or model_score between 0 and 100);--> statement-breakpoint
ALTER TABLE "zenhyre2"."match" ADD CONSTRAINT "match_fit_score_ck" CHECK (fit_score between 0 and 100);--> statement-breakpoint
ALTER TABLE "zenhyre2"."match" ADD CONSTRAINT "match_rank_ck" CHECK (rank is null or rank > 0);--> statement-breakpoint
ALTER TABLE "zenhyre2"."match" ADD CONSTRAINT "match_ctc_ck" CHECK ((offered_ctc is null or offered_ctc > 0) and (hired_ctc is null or hired_ctc > 0));--> statement-breakpoint
ALTER TABLE "zenhyre2"."match_event" ADD CONSTRAINT "match_event_actor_kind_ck" CHECK (actor_kind in ('candidate', 'company', 'staff', 'system'));--> statement-breakpoint
ALTER TABLE "zenhyre2"."company_billing" ADD CONSTRAINT "company_billing_state_code_ck" CHECK (state_code ~ '^[0-9]{2}$');--> statement-breakpoint
ALTER TABLE "zenhyre2"."company_billing" ADD CONSTRAINT "company_billing_phone_ck" CHECK (phone ~ '^[6-9][0-9]{9}$');--> statement-breakpoint
ALTER TABLE "zenhyre2"."company_billing" ADD CONSTRAINT "company_billing_gstin_ck" CHECK (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');--> statement-breakpoint
ALTER TABLE "zenhyre2"."invoice" ADD CONSTRAINT "invoice_total_ck" CHECK (taxable >= 0 and cgst >= 0 and sgst >= 0 and igst >= 0 and total = taxable + cgst + sgst + igst);--> statement-breakpoint
ALTER TABLE "zenhyre2"."invoice_counter" ADD CONSTRAINT "invoice_counter_last_ck" CHECK (last >= 0);--> statement-breakpoint
ALTER TABLE "zenhyre2"."payment_order" ADD CONSTRAINT "payment_order_currency_ck" CHECK (currency = 'INR');