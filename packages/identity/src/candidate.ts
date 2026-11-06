import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";
import type { CandidateProfile } from "@zenhyre/db/schema";
import { Clock, Invalid, NotFound } from "@zenhyre/shared";
import { createCampus } from "./campus";

type Status = "student" | "final_year" | "alumnus";

export function deriveStatus(gradDate: string, now: Date, finalYearMonths = 12): Status {
  const grad = new Date(gradDate + "T00:00:00Z");
  if (now >= grad) return "alumnus";
  const fy = new Date(grad); fy.setUTCMonth(fy.getUTCMonth() - finalYearMonths);
  return now >= fy ? "final_year" : "student";
}

export interface CreateCandidateInput {
  userId: string; email: string; gradDate: string; course: string; rollNumber: string | null;
  /** alumni direct request only */
  campusShortCode?: string; claimed?: { batch: string; branch: string; linkedinUrl: string };
}

export function createCandidateModule(db: DbOrTx, clock: Clock, opts: { finalYearMonths: number; maxVerificationAttempts: number }) {
  const campus = createCampus(db);

  async function get(userId: string) {
    const [row] = await db.select().from(schema.candidate).where(eq(schema.candidate.userId, userId));
    return row ?? null;
  }

  return {
    ...campus,
    getCandidate: get,

    async createCandidate(input: CreateCandidateInput) {
      const now = clock.now();
      const byEmail = await campus.campusForEmail(input.email);
      let campusId: string, state: "verified" | "verification_pending", source: "campus_email" | "association";
      let rollFlag = false;
      if (byEmail) {
        campusId = byEmail.id; state = "verified"; source = "campus_email";
        if (byEmail.rollNumberRegex && !(input.rollNumber && new RegExp(byEmail.rollNumberRegex).test(input.rollNumber))) rollFlag = true;
        await db.update(schema.userEmail).set({ campusId }).where(eq(schema.userEmail.email, input.email.toLowerCase()));
      } else {
        if (!input.campusShortCode) throw new Invalid("not a campus email; pick a campus to request alumni verification");
        const c = await campus.campusByShortCode(input.campusShortCode);
        if (!c) throw new NotFound("campus");
        campusId = c.id; state = "verification_pending"; source = "association";
      }
      const [row] = await db.insert(schema.candidate).values({
        userId: input.userId, campusId, gradDate: input.gradDate, course: input.course, rollNumber: input.rollNumber,
        rollNumberFlag: rollFlag, status: deriveStatus(input.gradDate, now, opts.finalYearMonths),
        verificationState: state, verificationSource: source, verificationAttempts: byEmail ? 0 : 1,
        verifiedBy: byEmail ? "system" : null, verifiedAt: byEmail ? now : null,
        profile: input.claimed ? { linkedin_url: input.claimed.linkedinUrl, claimed: input.claimed } : {},
      }).returning();
      return row!;
    },

    /** §6.1: campus_email and referral sources are preserved on approval; association/staff set by the approver. */
    async verifyCandidate(userId: string, by: { by: string; source: "association" | "staff" }) {
      const c = await get(userId); if (!c) throw new NotFound("candidate");
      const source = (c.verificationSource === "referral" || c.verificationSource === "campus_email") ? c.verificationSource : by.source;
      const [row] = await db.update(schema.candidate)
        .set({ verificationState: "verified", verificationSource: source, verifiedBy: by.by, verifiedAt: clock.now() })
        .where(eq(schema.candidate.userId, userId)).returning();
      return row!;
    },
    async rejectVerification(userId: string, by: { by: string; reason: string }) {
      const [row] = await db.update(schema.candidate)
        .set({ verificationState: "rejected", verifiedBy: by.by })
        .where(eq(schema.candidate.userId, userId)).returning();
      if (!row) throw new NotFound("candidate");
      return row;
    },
    async requestVerificationAgain(userId: string) {
      const c = await get(userId); if (!c) throw new NotFound("candidate");
      if (c.verificationState !== "rejected") throw new Invalid("not rejected");
      if (c.verificationAttempts >= opts.maxVerificationAttempts) throw new Invalid("no verification attempts left");
      const [row] = await db.update(schema.candidate)
        .set({ verificationState: "verification_pending", verificationAttempts: c.verificationAttempts + 1 })
        .where(eq(schema.candidate.userId, userId)).returning();
      return row!;
    },
    async clearRollNumberFlag(userId: string) {
      await db.update(schema.candidate).set({ rollNumberFlag: false }).where(eq(schema.candidate.userId, userId));
    },
    async setCandidateOpen(userId: string, open: boolean) {
      await db.update(schema.candidate).set({ openToOpportunities: open }).where(eq(schema.candidate.userId, userId));
    },
    async setCandidateTrustStatus(userId: string, status: "ok" | "restricted" | "blocked") {
      await db.update(schema.candidate).set({ trustStatus: status }).where(eq(schema.candidate.userId, userId));
    },
    async saveProfile(userId: string, patch: CandidateProfile) {
      const c = await get(userId); if (!c) throw new NotFound("candidate");
      const [row] = await db.update(schema.candidate).set({ profile: { ...c.profile, ...patch } })
        .where(eq(schema.candidate.userId, userId)).returning();
      return row!;
    },
    async setCandidateStatus(userId: string, status: Status) {
      await db.update(schema.candidate).set({ status }).where(eq(schema.candidate.userId, userId));
    },
    /** Nightly: recompute status from grad_date. Returns rows changed. */
    async refreshCandidateStatuses() {
      const now = clock.now();
      const rows = await db.select({ userId: schema.candidate.userId, gradDate: schema.candidate.gradDate, status: schema.candidate.status }).from(schema.candidate);
      let n = 0;
      for (const r of rows) {
        const s = deriveStatus(r.gradDate, now, opts.finalYearMonths);
        if (s !== r.status) { await db.update(schema.candidate).set({ status: s }).where(eq(schema.candidate.userId, r.userId)); n++; }
      }
      return n;
    },
    /** For modules downstream of identity (matching) that hold candidate ids and need their current state. */
    async listCandidatesByIds(userIds: string[]) {
      if (!userIds.length) return [];
      return db.select().from(schema.candidate).where(inArray(schema.candidate.userId, userIds));
    },
    async listMatchableCandidates(f: { campusIds: string[]; statuses: Status[]; minYears?: number; maxYears?: number }) {
      if (!f.campusIds.length || !f.statuses.length) return [];
      const conds = [
        eq(schema.candidate.openToOpportunities, true),
        eq(schema.candidate.verificationState, "verified"),
        ne(schema.candidate.trustStatus, "blocked"),
        inArray(schema.candidate.campusId, f.campusIds),
        inArray(schema.candidate.status, f.statuses),
      ];
      if (f.minYears !== undefined) conds.push(sql`coalesce((${schema.candidate.profile}->>'years_experience')::numeric, 0) >= ${f.minYears}`);
      if (f.maxYears !== undefined) conds.push(sql`coalesce((${schema.candidate.profile}->>'years_experience')::numeric, 0) <= ${f.maxYears}`);
      return db.select().from(schema.candidate).where(and(...conds));
    },
  };
}
