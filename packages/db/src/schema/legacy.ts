import { uuid, text, timestamp, jsonb, integer, boolean, index, primaryKey } from "drizzle-orm/pg-core";
import { z2 } from "./_schema";
import { campus, company, user } from "./identity";

/**
 * Zenhyre 1.0 data imported into 2.0 (`packages/db/supabase/import-from-1.0.sql`). 1.0's `public` schema stays as it
 * was, read-only to this import; these tables hold what 2.0 keeps from it. Identity lands in the live tables (`user`,
 * `user_email`, `company`, `company_user`); everything 2.0 has no live home for lands here, so nothing is lost and
 * `public` can be retired later.
 */

/** A 1.0 profile: what a candidate or client told 1.0, kept to prefill their 2.0 onboarding. One per imported user. */
export const legacyProfile = z2.table("legacy_profile", {
  userId: uuid("user_id").primaryKey().references(() => user.id),
  /** 1.0's role: `user` (candidate), `client` (company) or `admin`. */
  legacyRole: text("legacy_role").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  phone: text("phone"),
  linkedinUrl: text("linkedin_url"),
  githubUrl: text("github_url"),
  profileImage: text("profile_image"),
  resumeUrl: text("resume_url"),
  /** 1.0's extracted resume (`candidate_resumes`); the embedding is not kept and is recomputed by 2.0. */
  resumePath: text("resume_path"),
  resumeText: text("resume_text"),
  companyName: text("company_name"),
  gstNumber: text("gst_number"),
  /** Set when the email's domain is a campus domain: a hint for onboarding, not a verification. */
  campusId: uuid("campus_id").references(() => campus.id),
  /** The 1.0 row as it was, for anything not mapped above. */
  source: jsonb("source").$type<Record<string, unknown>>().notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("legacy_profile_role_idx").on(t.legacyRole)]);

/** A 1.0 job, as history. Not a 2.0 role: those go through the gate, terms and a deposit. */
export const legacyJob = z2.table("legacy_job", {
  /** 1.0's `jobs.job_id`. */
  id: uuid("id").primaryKey(),
  companyId: uuid("company_id").references(() => company.id),
  employerUserId: uuid("employer_user_id").references(() => user.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  jdPdfUrl: text("jd_pdf_url"),
  status: text("status"),
  level: text("level"),
  location: text("location"),
  duration: text("duration"),
  stipend: text("stipend"),
  tags: text("tags").array().notNull().default([]),
  closingAt: timestamp("closing_at", { withTimezone: true }),
  formLink: text("form_link"),
  /** 1.0's application form(s) for the job (`forms.form`). */
  forms: jsonb("forms").$type<unknown[]>().notNull().default([]),
  /** 1.0's evaluation results for the job (`evaluations.results`). */
  evaluations: jsonb("evaluations").$type<unknown[]>().notNull().default([]),
  appliedCount: integer("applied_count").notNull().default(0),
  shortlistedCount: integer("shortlisted_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }),
  source: jsonb("source").$type<Record<string, unknown>>().notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("legacy_job_company_idx").on(t.companyId)]);

/** A 1.0 application (`responses`), with whether 1.0 shortlisted the candidate. */
export const legacyApplication = z2.table("legacy_application", {
  /** 1.0's `responses.id`. */
  id: uuid("id").primaryKey(),
  legacyJobId: uuid("legacy_job_id").references(() => legacyJob.id),
  userId: uuid("user_id").references(() => user.id),
  answers: jsonb("answers"),
  shortlisted: boolean("shortlisted").notNull().default(false),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("legacy_application_user_idx").on(t.userId), index("legacy_application_job_idx").on(t.legacyJobId)]);

/** Everything else worth keeping from 1.0 (agreements, onboarding, subscriptions, leads, assignments), row for row. */
export const legacyRecord = z2.table("legacy_record", {
  sourceTable: text("source_table").notNull(),
  sourceId: text("source_id").notNull(),
  userId: uuid("user_id"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.sourceTable, t.sourceId] })]);

/** One row per run of the import, dry or real, with its report. */
export const legacyImportRun = z2.table("legacy_import_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  dryRun: boolean("dry_run").notNull(),
  grantStaff: boolean("grant_staff").notNull(),
  runBy: text("run_by").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  report: jsonb("report").$type<Record<string, unknown>>().notNull().default({}),
});
