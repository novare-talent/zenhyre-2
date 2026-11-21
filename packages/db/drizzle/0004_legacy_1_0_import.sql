CREATE TABLE IF NOT EXISTS "zenhyre2"."legacy_application" (
	"id" uuid PRIMARY KEY NOT NULL,
	"legacy_job_id" uuid,
	"user_id" uuid,
	"answers" jsonb,
	"shortlisted" boolean DEFAULT false NOT NULL,
	"applied_at" timestamp with time zone,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."legacy_import_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dry_run" boolean NOT NULL,
	"grant_staff" boolean NOT NULL,
	"run_by" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."legacy_job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"employer_user_id" uuid,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"jd_pdf_url" text,
	"status" text,
	"level" text,
	"location" text,
	"duration" text,
	"stipend" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"closing_at" timestamp with time zone,
	"form_link" text,
	"forms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evaluations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"applied_count" integer DEFAULT 0 NOT NULL,
	"shortlisted_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone,
	"source" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."legacy_profile" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"legacy_role" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"phone" text,
	"linkedin_url" text,
	"github_url" text,
	"profile_image" text,
	"resume_url" text,
	"resume_path" text,
	"resume_text" text,
	"company_name" text,
	"gst_number" text,
	"campus_id" uuid,
	"source" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zenhyre2"."legacy_record" (
	"source_table" text NOT NULL,
	"source_id" text NOT NULL,
	"user_id" uuid,
	"data" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_record_source_table_source_id_pk" PRIMARY KEY("source_table","source_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."legacy_application" ADD CONSTRAINT "legacy_application_legacy_job_id_legacy_job_id_fk" FOREIGN KEY ("legacy_job_id") REFERENCES "zenhyre2"."legacy_job"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."legacy_application" ADD CONSTRAINT "legacy_application_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "zenhyre2"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."legacy_job" ADD CONSTRAINT "legacy_job_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "zenhyre2"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."legacy_job" ADD CONSTRAINT "legacy_job_employer_user_id_user_id_fk" FOREIGN KEY ("employer_user_id") REFERENCES "zenhyre2"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."legacy_profile" ADD CONSTRAINT "legacy_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "zenhyre2"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "zenhyre2"."legacy_profile" ADD CONSTRAINT "legacy_profile_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "zenhyre2"."campus"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "legacy_application_user_idx" ON "zenhyre2"."legacy_application" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "legacy_application_job_idx" ON "zenhyre2"."legacy_application" USING btree ("legacy_job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "legacy_job_company_idx" ON "zenhyre2"."legacy_job" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "legacy_profile_role_idx" ON "zenhyre2"."legacy_profile" USING btree ("legacy_role");