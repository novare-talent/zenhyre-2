CREATE SCHEMA IF NOT EXISTS "zenhyre2";
--> statement-breakpoint
CREATE TYPE "zenhyre2"."candidate_status" AS ENUM('student', 'final_year', 'alumnus');--> statement-breakpoint
CREATE TYPE "zenhyre2"."company_status" AS ENUM('active', 'probation', 'banned');--> statement-breakpoint
CREATE TYPE "zenhyre2"."company_user_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "zenhyre2"."payout_mode" AS ENUM('cash', 'sponsorship_credit');--> statement-breakpoint
CREATE TYPE "zenhyre2"."trust_status" AS ENUM('ok', 'restricted', 'blocked');--> statement-breakpoint
CREATE TYPE "zenhyre2"."verification_source" AS ENUM('campus_email', 'referral', 'association', 'staff');--> statement-breakpoint
CREATE TYPE "zenhyre2"."verification_state" AS ENUM('verified', 'referral_pending', 'verification_pending', 'rejected');--> statement-breakpoint
CREATE TYPE "zenhyre2"."review_kind" AS ENUM('gate', 'verification', 'leakage', 'join_dispute', 'deposit_resolution', 'candidate_approval', 'alert');--> statement-breakpoint
CREATE TYPE "zenhyre2"."notify_channel" AS ENUM('email', 'in_app');--> statement-breakpoint
CREATE TYPE "zenhyre2"."deposit_mode" AS ENUM('razorpay', 'waived');--> statement-breakpoint
CREATE TYPE "zenhyre2"."gate_outcome" AS ENUM('accept', 'reject', 'needs_review');--> statement-breakpoint
CREATE TYPE "zenhyre2"."gate_stage" AS ENUM('rules', 'model', 'human');--> statement-breakpoint
CREATE TYPE "zenhyre2"."role_status" AS ENUM('draft', 'gated', 'rejected', 'terms_pending', 'deposit_pending', 'broadcast', 'shortlist_ready', 'closing', 'closed', 'withdrawn');--> statement-breakpoint
CREATE TYPE "zenhyre2"."role_type" AS ENUM('intern', 'fresher', 'experienced');--> statement-breakpoint
CREATE TYPE "zenhyre2"."join_confirmed_by" AS ENUM('candidate', 'grace', 'staff');--> statement-breakpoint
CREATE TYPE "zenhyre2"."match_stage" AS ENUM('scored', 'applied', 'pending_approval', 'shortlisted', 'viewed', 'interviewed', 'offered', 'offer_accepted', 'hired', 'offer_reneged', 'rejected', 'withdrawn', 'did_not_join', 'left_early', 'declined_by_staff', 'role_closed');--> statement-breakpoint
CREATE TYPE "zenhyre2"."rejection_category" AS ENUM('skills', 'experience', 'location', 'compensation', 'culture', 'position_filled', 'no_show', 'other');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."association" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campus_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contacts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"share_rate" numeric(5, 4) DEFAULT '0.1500' NOT NULL,
	"payout_mode" "zenhyre2"."payout_mode" DEFAULT 'cash' NOT NULL,
	"mou_signed_at" timestamp with time zone,
	CONSTRAINT "association_campus_id_unique" UNIQUE("campus_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."association_admin" (
	"user_id" uuid NOT NULL,
	"association_id" uuid NOT NULL,
	"invited_by" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "association_admin_user_id_association_id_pk" PRIMARY KEY("user_id","association_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."campus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"short_code" text NOT NULL,
	"email_domains" text[] NOT NULL,
	"roll_number_regex" text,
	"internal_tier" integer DEFAULT 3 NOT NULL,
	CONSTRAINT "campus_short_code_unique" UNIQUE("short_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."candidate" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"campus_id" uuid NOT NULL,
	"grad_date" date NOT NULL,
	"course" text NOT NULL,
	"roll_number" text,
	"roll_number_flag" boolean DEFAULT false NOT NULL,
	"status" "zenhyre2"."candidate_status" NOT NULL,
	"verification_state" "zenhyre2"."verification_state" NOT NULL,
	"verification_attempts" integer DEFAULT 0 NOT NULL,
	"verification_source" "zenhyre2"."verification_source" NOT NULL,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"open_to_opportunities" boolean DEFAULT true NOT NULL,
	"trust_status" "zenhyre2"."trust_status" DEFAULT 'ok' NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding_updated_at" timestamp with time zone,
	"name_visible_to_association" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"verified_domain" text NOT NULL,
	"status" "zenhyre2"."company_status" DEFAULT 'active' NOT NULL,
	"status_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."company_user" (
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"role" "zenhyre2"."company_user_role" NOT NULL,
	"invited_by" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	CONSTRAINT "company_user_user_id_company_id_pk" PRIMARY KEY("user_id","company_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"purpose" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"is_staff" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."user_email" (
	"user_id" uuid NOT NULL,
	"email" text PRIMARY KEY NOT NULL,
	"verified_at" timestamp with time zone,
	"is_primary" boolean DEFAULT false NOT NULL,
	"campus_id" uuid,
	"bounce_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."config_value" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."review_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "zenhyre2"."review_kind" NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"association_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."staff_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"template" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channel" "zenhyre2"."notify_channel" NOT NULL,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"bounce_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text NOT NULL,
	"jd" text DEFAULT '' NOT NULL,
	"type" "zenhyre2"."role_type" NOT NULL,
	"ctc_min" bigint,
	"ctc_max" bigint,
	"years_exp_min" real DEFAULT 0 NOT NULL,
	"years_exp_max" real DEFAULT 0 NOT NULL,
	"locations" text[] DEFAULT '{}' NOT NULL,
	"campus_reach" uuid[] DEFAULT '{}' NOT NULL,
	"status" "zenhyre2"."role_status" DEFAULT 'draft' NOT NULL,
	"final_gate_decision_id" uuid,
	"fee_terms" jsonb,
	"fee_terms_released_at" timestamp with time zone,
	"fee_terms_accepted_at" timestamp with time zone,
	"deposit_amount" bigint,
	"deposit_mode" "zenhyre2"."deposit_mode",
	"deposit_order_id" text,
	"refund_owed" bigint,
	"broadcast_opens_at" timestamp with time zone,
	"broadcast_closes_at" timestamp with time zone,
	"broadcast_extended_at" timestamp with time zone,
	"shortlist_ready_at" timestamp with time zone,
	"shortlist_cap" integer DEFAULT 25 NOT NULL,
	"nudge_cap" integer DEFAULT 150 NOT NULL,
	"replacement_of_role_id" uuid,
	"hired_match_id" uuid,
	"hired_at" timestamp with time zone,
	"job_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."role_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"role_id" uuid NOT NULL,
	"from_status" "zenhyre2"."role_status",
	"to_status" "zenhyre2"."role_status" NOT NULL,
	"actor" text NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."role_gate_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"stage" "zenhyre2"."gate_stage" NOT NULL,
	"outcome" "zenhyre2"."gate_outcome" NOT NULL,
	"reason" text NOT NULL,
	"rule" text,
	"suggested_reach" uuid[] DEFAULT '{}' NOT NULL,
	"model_score" integer,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."match" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"fit_score" integer NOT NULL,
	"fit_reason" text DEFAULT '' NOT NULL,
	"nudged_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"rank" integer,
	"stage" "zenhyre2"."match_stage" DEFAULT 'scored' NOT NULL,
	"rejection_category" "zenhyre2"."rejection_category",
	"rejection_note" text,
	"offered_ctc" bigint,
	"hired_ctc" bigint,
	"joined_on" date,
	"join_prompt_sent_at" timestamp with time zone,
	"join_confirmed_at" timestamp with time zone,
	"join_confirmed_by" "zenhyre2"."join_confirmed_by",
	"override" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_role_candidate_uq" UNIQUE("role_id","candidate_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."match_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"match_id" uuid NOT NULL,
	"from_stage" "zenhyre2"."match_stage",
	"to_stage" "zenhyre2"."match_stage" NOT NULL,
	"actor" text NOT NULL,
	"actor_kind" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."association" ADD CONSTRAINT "association_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "zenhyre2"."campus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."association_admin" ADD CONSTRAINT "association_admin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "zenhyre2"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."association_admin" ADD CONSTRAINT "association_admin_association_id_association_id_fk" FOREIGN KEY ("association_id") REFERENCES "zenhyre2"."association"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."candidate" ADD CONSTRAINT "candidate_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "zenhyre2"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."candidate" ADD CONSTRAINT "candidate_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "zenhyre2"."campus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."company_user" ADD CONSTRAINT "company_user_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "zenhyre2"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."company_user" ADD CONSTRAINT "company_user_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "zenhyre2"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."user_email" ADD CONSTRAINT "user_email_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "zenhyre2"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."user_email" ADD CONSTRAINT "user_email_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "zenhyre2"."campus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."role" ADD CONSTRAINT "role_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "zenhyre2"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."role_event" ADD CONSTRAINT "role_event_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "zenhyre2"."role"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."role_gate_decision" ADD CONSTRAINT "role_gate_decision_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "zenhyre2"."role"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."match" ADD CONSTRAINT "match_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "zenhyre2"."role"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."match" ADD CONSTRAINT "match_candidate_id_candidate_user_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "zenhyre2"."candidate"("user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."match_event" ADD CONSTRAINT "match_event_match_id_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "zenhyre2"."match"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invite_email_idx" ON "zenhyre2"."invite" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "review_item_open_uq" ON "zenhyre2"."review_item" USING btree ("kind","ref_type","ref_id") WHERE resolved_at is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_company_idx" ON "zenhyre2"."role" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_status_idx" ON "zenhyre2"."role" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_event_role_idx" ON "zenhyre2"."role_event" USING btree ("role_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_gate_decision_role_idx" ON "zenhyre2"."role_gate_decision" USING btree ("role_id","decided_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "match_candidate_idx" ON "zenhyre2"."match" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "match_role_stage_idx" ON "zenhyre2"."match" USING btree ("role_id","stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "match_event_match_idx" ON "zenhyre2"."match_event" USING btree ("match_id","seq");