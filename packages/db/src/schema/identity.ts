import { uuid, text, timestamp, boolean, integer, date, jsonb, numeric, primaryKey, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z2 } from "./_schema";

export const candidateStatus = z2.enum("candidate_status", ["student", "final_year", "alumnus"]);
export const verificationState = z2.enum("verification_state", ["verified", "referral_pending", "verification_pending", "rejected"]);
export const verificationSource = z2.enum("verification_source", ["campus_email", "referral", "association", "staff"]);
export const trustStatus = z2.enum("trust_status", ["ok", "restricted", "blocked"]);
export const companyStatus = z2.enum("company_status", ["active", "probation", "banned"]);
export const companyUserRole = z2.enum("company_user_role", ["owner", "member"]);
export const payoutMode = z2.enum("payout_mode", ["cash", "sponsorship_credit"]);

export const campus = z2.table("campus", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  shortCode: text("short_code").notNull().unique(),
  emailDomains: text("email_domains").array().notNull(),
  rollNumberRegex: text("roll_number_regex"),
  internalTier: integer("internal_tier").notNull().default(3),
}, () => [check("campus_tier_ck", sql`internal_tier between 1 and 3`)]);

/**
 * A person, whatever their seat. Same id as auth.users.id in Supabase. The person columns carry the names 1.0's
 * `public.profiles` used, so the two read alike; `zenhyre2.profiles` (a view, migration 0005) shows 2.0 users in exactly
 * 1.0's shape, with email (from `user_email`), role (from the seat rows) and company name filled in.
 */
export const user = z2.table("user", {
  id: uuid("id").primaryKey(),
  isStaff: boolean("is_staff").notNull().default(false),
  /** Finance access: settle deposits (refund, forfeit) from /staff/payments. Granted by SQL only, on top of is_staff. */
  isFinance: boolean("is_finance").notNull().default(false),
  firstName: text("first_name"),
  lastName: text("last_name"),
  phone: text("phone"),
  githubLink: text("github_link"),
  linkedinLink: text("linkedin_link"),
  profileImage: text("profile_image"),
  resumeUrl: text("resume_url"),
  /** Product and marketing email (not transactional email, which always goes). */
  isSubscribed: boolean("is_subscribed").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, () => [check("user_finance_is_staff_ck", sql`not is_finance or is_staff`)]);

export const userEmail = z2.table("user_email", {
  userId: uuid("user_id").notNull().references(() => user.id),
  email: text("email").primaryKey(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  isPrimary: boolean("is_primary").notNull().default(false),
  campusId: uuid("campus_id").references(() => campus.id),
  bounceCount: integer("bounce_count").notNull().default(0),
}, (t) => [
  // Every lookup of a person's addresses (sign-in, email delivery, /me) is by user.
  index("user_email_user_idx").on(t.userId),
  // At most one primary address per person.
  uniqueIndex("user_email_one_primary_uq").on(t.userId).where(sql`is_primary`),
  check("user_email_lowercase_ck", sql`email = lower(email) and position('@' in email) > 1`),
  check("user_email_bounce_ck", sql`bounce_count >= 0`),
]);

/**
 * A pending invitation to join a company or an association. Sign-in itself is Supabase Auth;
 * an invite is accepted the first time a user signs in with the invited address (see identity.acceptPendingInvites).
 */
export const invite = z2.table("invite", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  purpose: text("purpose").notNull(), // "company_invite" | "association_admin_invite"
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  invitedBy: uuid("invited_by").references(() => user.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("invite_email_idx").on(t.email),
  check("invite_purpose_ck", sql`purpose in ('company_invite', 'association_admin_invite')`),
]);

export const candidate = z2.table("candidate", {
  userId: uuid("user_id").primaryKey().references(() => user.id),
  campusId: uuid("campus_id").notNull().references(() => campus.id),
  gradDate: date("grad_date").notNull(),
  course: text("course").notNull(),
  rollNumber: text("roll_number"),
  rollNumberFlag: boolean("roll_number_flag").notNull().default(false),
  status: candidateStatus("status").notNull(),
  verificationState: verificationState("verification_state").notNull(),
  verificationAttempts: integer("verification_attempts").notNull().default(0),
  verificationSource: verificationSource("verification_source").notNull(),
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  openToOpportunities: boolean("open_to_opportunities").notNull().default(true),
  trustStatus: trustStatus("trust_status").notNull().default("ok"),
  profile: jsonb("profile").$type<CandidateProfile>().notNull().default({}),
  // embedding_updated_at and name_visible_to_association were dropped in 0006 (never used); they return with pgvector
  // and the association attribution views.
}, (t) => [
  // Matching filters candidates by campus (§8 step 2).
  index("candidate_campus_idx").on(t.campusId),
  check("candidate_attempts_ck", sql`verification_attempts >= 0`),
]);

export interface CandidateProfile {
  /** Shown to companies on a shortlist and to the association in its queue. */
  name?: string;
  headline?: string;
  skills?: string[];
  years_experience?: number;
  current_company?: string;
  current_title?: string;
  preferred_roles?: string[];
  preferred_locations?: string[];
  notice_period_days?: number;
  current_ctc?: number;
  linkedin_url?: string;
  cv_url?: string;
  parsed_cv?: Record<string, unknown>;
  /** alumni direct request: what the candidate claimed at sign-up, shown in the verification queue */
  claimed?: { batch: string; branch: string; linkedinUrl: string };
}

export const company = z2.table("company", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  verifiedDomain: text("verified_domain").notNull(),
  status: companyStatus("status").notNull().default("active"),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, () => [check("company_domain_lowercase_ck", sql`verified_domain = lower(verified_domain)`)]);

export const companyUser = z2.table("company_user", {
  userId: uuid("user_id").notNull().references(() => user.id),
  companyId: uuid("company_id").notNull().references(() => company.id),
  role: companyUserRole("role").notNull(),
  invitedBy: uuid("invited_by").references(() => user.id),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.userId, t.companyId] }),
  // One email, one seat (§6): a person belongs to at most one company.
  uniqueIndex("company_user_one_company_uq").on(t.userId),
  // Listing a company's people (notifications, the company page) is by company.
  index("company_user_company_idx").on(t.companyId),
]);

export const association = z2.table("association", {
  id: uuid("id").primaryKey().defaultRandom(),
  campusId: uuid("campus_id").notNull().references(() => campus.id).unique(),
  name: text("name").notNull(),
  contacts: jsonb("contacts").$type<Record<string, unknown>>().notNull().default({}),
  shareRate: numeric("share_rate", { precision: 5, scale: 4 }).notNull().default("0.1500"),
  payoutMode: payoutMode("payout_mode").notNull().default("cash"),
  mouSignedAt: timestamp("mou_signed_at", { withTimezone: true }),
}, () => [check("association_share_rate_ck", sql`share_rate >= 0 and share_rate <= 1`)]);

export const associationAdmin = z2.table("association_admin", {
  userId: uuid("user_id").notNull().references(() => user.id),
  associationId: uuid("association_id").notNull().references(() => association.id),
  invitedBy: uuid("invited_by").references(() => user.id),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.associationId] }), index("association_admin_association_idx").on(t.associationId)]);
