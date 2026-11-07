// What the API's seat routes return (services/api/src/routes/views.ts). Dates arrive as ISO strings.
import type { RejectionCategory, RoleStatus, RoleType, Stage } from "./rules";

export interface FeeTerms { kind: "flat" | "percent"; amount: number; replacement_guarantee_days: number; notes?: string }
export interface GateView { stage: "rules" | "model" | "human"; outcome: "accept" | "reject" | "needs_review"; reason: string; rule: string | null; decidedAt: string }

/** A role as its company sees it. */
export interface CompanyRoleView {
  id: string; companyId: string; title: string; jd: string; type: RoleType;
  ctcMin: number | null; ctcMax: number | null; yearsExpMin: number; yearsExpMax: number;
  locations: string[]; campusReach: string[]; status: RoleStatus;
  gate: GateView | null; appealed: boolean;
  feeTerms: FeeTerms | null; feeTermsReleasedAt: string | null; feeTermsAcceptedAt: string | null;
  depositAmount: number | null; depositMode: "razorpay" | "waived" | null;
  broadcastOpensAt: string | null; broadcastClosesAt: string | null; shortlistReadyAt: string | null; shortlistCap: number;
  hiredMatchId: string | null; hiredAt: string | null; replacementOfRoleId: string | null;
  applicants: number; createdAt: string;
}

export interface ShortlistRowView {
  id: string; rank: number | null; stage: Stage; fitScore: number; fitReason: string; appliedAt: string | null;
  offeredCtc: number | null; hiredCtc: number | null; joinedOn: string | null;
  rejectionCategory: RejectionCategory | null; rejectionNote: string | null; joinConfirmedAt: string | null;
  candidate: null | {
    id: string; name: string | null; campus: { id: string; name: string; shortCode: string } | null; course: string; gradDate: string;
    status: "student" | "final_year" | "alumnus";
    profile: { headline: string | null; skills: string[]; yearsExperience: number | null; currentCompany: string | null; currentTitle: string | null;
      preferredRoles: string[]; preferredLocations: string[]; noticePeriodDays: number | null; linkedinUrl: string | null; cvUrl: string | null };
  };
}

/** A role as a candidate sees it on the board. */
export interface CandidateRoleView {
  id: string; title: string; jd: string; type: RoleType; ctcMin: number | null; ctcMax: number | null;
  yearsExpMin: number; yearsExpMax: number; locations: string[]; campusReach: string[];
  company: { id: string; name: string }; open: boolean; broadcastClosesAt: string | null; nudged: boolean;
  application: { id: string; stage: Stage; appliedAt: string } | null;
}

export interface ApplicationView {
  id: string; stage: Stage; appliedAt: string | null; updatedAt: string;
  rejectionCategory: RejectionCategory | null; joinedOn: string | null;
  joinPromptSentAt: string | null; joinConfirmedAt: string | null; canWithdraw: boolean;
  role: { id: string; title: string; type: RoleType; locations: string[]; ctcMin: number | null; ctcMax: number | null };
  company: { id: string; name: string };
}
