CREATE TYPE "public"."candidate_status" AS ENUM('student', 'final_year', 'alumnus');--> statement-breakpoint
CREATE TYPE "public"."company_status" AS ENUM('active', 'probation', 'banned');--> statement-breakpoint
CREATE TYPE "public"."company_user_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."payout_mode" AS ENUM('cash', 'sponsorship_credit');--> statement-breakpoint
CREATE TYPE "public"."trust_status" AS ENUM('ok', 'restricted', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."verification_source" AS ENUM('campus_email', 'referral', 'association', 'staff');--> statement-breakpoint
CREATE TYPE "public"."verification_state" AS ENUM('verified', 'referral_pending', 'verification_pending', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."review_kind" AS ENUM('gate', 'verification', 'leakage', 'join_dispute', 'deposit_resolution', 'candidate_approval', 'alert');--> statement-breakpoint
CREATE TYPE "public"."notify_channel" AS ENUM('email', 'in_app');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "association" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campus_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contacts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"share_rate" numeric(5, 4) DEFAULT '0.1500' NOT NULL,
	"payout_mode" "payout_mode" DEFAULT 'cash' NOT NULL,
	"mou_signed_at" timestamp with time zone,
	CONSTRAINT "association_campus_id_unique" UNIQUE("campus_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "association_admin" (
	"user_id" uuid NOT NULL,
	"association_id" uuid NOT NULL,
	"invited_by" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "association_admin_user_id_association_id_pk" PRIMARY KEY("user_id","association_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"short_code" text NOT NULL,
	"email_domains" text[] NOT NULL,
	"roll_number_regex" text,
	"internal_tier" integer DEFAULT 3 NOT NULL,
	CONSTRAINT "campus_short_code_unique" UNIQUE("short_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidate" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"campus_id" uuid NOT NULL,
	"grad_date" date NOT NULL,
	"course" text NOT NULL,
	"roll_number" text,
	"roll_number_flag" boolean DEFAULT false NOT NULL,
	"status" "candidate_status" NOT NULL,
	"verification_state" "verification_state" NOT NULL,
	"verification_attempts" integer DEFAULT 0 NOT NULL,
	"verification_source" "verification_source" NOT NULL,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"open_to_opportunities" boolean DEFAULT true NOT NULL,
	"trust_status" "trust_status" DEFAULT 'ok' NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding_updated_at" timestamp with time zone,
	"name_visible_to_association" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"verified_domain" text NOT NULL,
	"status" "company_status" DEFAULT 'active' NOT NULL,
	"status_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_user" (
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"role" "company_user_role" NOT NULL,
	"invited_by" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	CONSTRAINT "company_user_user_id_company_id_pk" PRIMARY KEY("user_id","company_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "magic_link_token" (
	"token" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"purpose" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"is_staff" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_email" (
	"user_id" uuid NOT NULL,
	"email" text PRIMARY KEY NOT NULL,
	"verified_at" timestamp with time zone,
	"is_primary" boolean DEFAULT false NOT NULL,
	"campus_id" uuid,
	"bounce_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "config_value" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "review_kind" NOT NULL,
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
CREATE TABLE IF NOT EXISTS "staff_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"template" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channel" "notify_channel" NOT NULL,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"bounce_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "association" ADD CONSTRAINT "association_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "association_admin" ADD CONSTRAINT "association_admin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "association_admin" ADD CONSTRAINT "association_admin_association_id_association_id_fk" FOREIGN KEY ("association_id") REFERENCES "public"."association"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "candidate" ADD CONSTRAINT "candidate_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "candidate" ADD CONSTRAINT "candidate_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_user" ADD CONSTRAINT "company_user_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_user" ADD CONSTRAINT "company_user_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_email" ADD CONSTRAINT "user_email_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_email" ADD CONSTRAINT "user_email_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "review_item_open_uq" ON "review_item" USING btree ("kind","ref_type","ref_id") WHERE resolved_at is null;