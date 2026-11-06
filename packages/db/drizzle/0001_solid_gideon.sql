CREATE TYPE "public"."deposit_mode" AS ENUM('razorpay', 'waived');--> statement-breakpoint
CREATE TYPE "public"."gate_outcome" AS ENUM('accept', 'reject', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."gate_stage" AS ENUM('rules', 'model', 'human');--> statement-breakpoint
CREATE TYPE "public"."role_status" AS ENUM('draft', 'gated', 'rejected', 'terms_pending', 'deposit_pending', 'broadcast', 'shortlist_ready', 'closing', 'closed', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."role_type" AS ENUM('intern', 'fresher', 'experienced');--> statement-breakpoint
CREATE TYPE "public"."join_confirmed_by" AS ENUM('candidate', 'grace', 'staff');--> statement-breakpoint
CREATE TYPE "public"."match_stage" AS ENUM('scored', 'applied', 'pending_approval', 'shortlisted', 'viewed', 'interviewed', 'offered', 'offer_accepted', 'hired', 'offer_reneged', 'rejected', 'withdrawn', 'did_not_join', 'left_early', 'declined_by_staff', 'role_closed');--> statement-breakpoint
CREATE TYPE "public"."rejection_category" AS ENUM('skills', 'experience', 'location', 'compensation', 'culture', 'position_filled', 'no_show', 'other');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text NOT NULL,
	"jd" text DEFAULT '' NOT NULL,
	"type" "role_type" NOT NULL,
	"ctc_min" bigint,
	"ctc_max" bigint,
	"years_exp_min" real DEFAULT 0 NOT NULL,
	"years_exp_max" real DEFAULT 0 NOT NULL,
	"locations" text[] DEFAULT '{}' NOT NULL,
	"campus_reach" uuid[] DEFAULT '{}' NOT NULL,
	"status" "role_status" DEFAULT 'draft' NOT NULL,
	"final_gate_decision_id" uuid,
	"fee_terms" jsonb,
	"fee_terms_released_at" timestamp with time zone,
	"fee_terms_accepted_at" timestamp with time zone,
	"deposit_amount" bigint,
	"deposit_mode" "deposit_mode",
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
CREATE TABLE IF NOT EXISTS "role_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"role_id" uuid NOT NULL,
	"from_status" "role_status",
	"to_status" "role_status" NOT NULL,
	"actor" text NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_gate_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"stage" "gate_stage" NOT NULL,
	"outcome" "gate_outcome" NOT NULL,
	"reason" text NOT NULL,
	"rule" text,
	"suggested_reach" uuid[] DEFAULT '{}' NOT NULL,
	"model_score" integer,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "match" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"fit_score" integer NOT NULL,
	"fit_reason" text DEFAULT '' NOT NULL,
	"nudged_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"rank" integer,
	"stage" "match_stage" DEFAULT 'scored' NOT NULL,
	"rejection_category" "rejection_category",
	"rejection_note" text,
	"offered_ctc" bigint,
	"hired_ctc" bigint,
	"joined_on" date,
	"join_prompt_sent_at" timestamp with time zone,
	"join_confirmed_at" timestamp with time zone,
	"join_confirmed_by" "join_confirmed_by",
	"override" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_role_candidate_uq" UNIQUE("role_id","candidate_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "match_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"match_id" uuid NOT NULL,
	"from_stage" "match_stage",
	"to_stage" "match_stage" NOT NULL,
	"actor" text NOT NULL,
	"actor_kind" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role" ADD CONSTRAINT "role_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_event" ADD CONSTRAINT "role_event_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_gate_decision" ADD CONSTRAINT "role_gate_decision_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "match" ADD CONSTRAINT "match_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "match" ADD CONSTRAINT "match_candidate_id_candidate_user_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate"("user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "match_event" ADD CONSTRAINT "match_event_match_id_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."match"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_company_idx" ON "role" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_status_idx" ON "role" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_event_role_idx" ON "role_event" USING btree ("role_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_gate_decision_role_idx" ON "role_gate_decision" USING btree ("role_id","decided_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "match_candidate_idx" ON "match" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "match_role_stage_idx" ON "match" USING btree ("role_id","stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "match_event_match_idx" ON "match_event" USING btree ("match_id","seq");