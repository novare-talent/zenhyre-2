import { uuid, text, timestamp, boolean, integer, date, jsonb, numeric, primaryKey, index } from "drizzle-orm/pg-core";
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
});

export const user = z2.table("user", {
  /** Same value as auth.users.id in Supabase. */
  id: uuid("id").primaryKey(),
  isStaff: boolean("is_staff").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userEmail = z2.table("user_email", {
  userId: uuid("user_id").notNull().references(() => user.id),
  email: text("email").primaryKey(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  isPrimary: boolean("is_primary").notNull().default(false),
  campusId: uuid("campus_id").references(() => campus.id),
  bounceCount: integer("bounce_count").notNull().default(0),
});

/**
 * A pending invitation to join a company or an association. Sign-in itself is Supabase Auth;
 * an invite is accepted the first time a user signs in with the invited address (see identity.acceptPendingInvites).
 */
export const invite = z2.table("invite", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  purpose: text("purpose").notNull(), // "company_invite" | "association_admin_invite"
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  invitedBy: uuid("invited_by"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("invite_email_idx").on(t.email)]);

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
  embeddingUpdatedAt: timestamp("embedding_updated_at", { withTimezone: true }),
  nameVisibleToAssociation: boolean("name_visible_to_association").notNull().default(false),
});

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
});

export const companyUser = z2.table("company_user", {
  userId: uuid("user_id").notNull().references(() => user.id),
  companyId: uuid("company_id").notNull().references(() => company.id),
  role: companyUserRole("role").notNull(),
  invitedBy: uuid("invited_by"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.userId, t.companyId] })]);

export const association = z2.table("association", {
  id: uuid("id").primaryKey().defaultRandom(),
  campusId: uuid("campus_id").notNull().references(() => campus.id).unique(),
  name: text("name").notNull(),
  contacts: jsonb("contacts").$type<Record<string, unknown>>().notNull().default({}),
  shareRate: numeric("share_rate", { precision: 5, scale: 4 }).notNull().default("0.1500"),
  payoutMode: payoutMode("payout_mode").notNull().default("cash"),
  mouSignedAt: timestamp("mou_signed_at", { withTimezone: true }),
});

export const associationAdmin = z2.table("association_admin", {
  userId: uuid("user_id").notNull().references(() => user.id),
  associationId: uuid("association_id").notNull().references(() => association.id),
  invitedBy: uuid("invited_by"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.associationId] })]);
