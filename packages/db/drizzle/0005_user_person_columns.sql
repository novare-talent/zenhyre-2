ALTER TABLE "zenhyre2"."user" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "zenhyre2"."user" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "zenhyre2"."user" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "zenhyre2"."user" ADD COLUMN "github_link" text;--> statement-breakpoint
ALTER TABLE "zenhyre2"."user" ADD COLUMN "linkedin_link" text;--> statement-breakpoint
ALTER TABLE "zenhyre2"."user" ADD COLUMN "profile_image" text;--> statement-breakpoint
ALTER TABLE "zenhyre2"."user" ADD COLUMN "resume_url" text;--> statement-breakpoint
ALTER TABLE "zenhyre2"."user" ADD COLUMN "is_subscribed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "zenhyre2"."user" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Backfill from what 2.0 already holds in candidate profiles.
UPDATE "zenhyre2"."user" u SET
  first_name = coalesce(u.first_name, nullif(split_part(trim(c.profile->>'name'), ' ', 1), '')),
  last_name = coalesce(u.last_name, nullif(trim(substr(trim(c.profile->>'name'), length(split_part(trim(c.profile->>'name'), ' ', 1)) + 1)), '')),
  linkedin_link = coalesce(u.linkedin_link, nullif(c.profile->>'linkedin_url', '')),
  resume_url = coalesce(u.resume_url, nullif(c.profile->>'cv_url', ''))
FROM "zenhyre2"."candidate" c WHERE c.user_id = u.id;--> statement-breakpoint
-- 2.0 people in exactly the shape (column names and order) of 1.0's public.profiles. Email is the primary address,
-- role is derived from the seat (admin = staff, client = company member, user = candidate, association = association
-- admin), company_name from the company; fields 2.0 has no use for come from the imported 1.0 profile, if any.
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
  coalesce((SELECT co.name FROM "zenhyre2"."company_user" cu JOIN "zenhyre2"."company" co ON co.id = cu.company_id WHERE cu.user_id = u.id LIMIT 1), lp.company_name) AS company_name,
  u.is_subscribed,
  coalesce((lp.source->>'welcome_email')::boolean, false) AS welcome_email,
  coalesce((lp.source->>'referral_applied')::boolean, false) AS referral_applied
FROM "zenhyre2"."user" u
LEFT JOIN "zenhyre2"."legacy_profile" lp ON lp.user_id = u.id;
