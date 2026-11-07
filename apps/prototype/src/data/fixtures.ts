// SAMPLE DATA. Identity (who is signed in, their campus, company or association) comes from the
// API. Everything in this file stands in for the modules the API does not have yet: roles, gate,
// matching and ledger (Slices 1B to 3). Every person, company, amount and link here is invented.
// Replace each export with an API call as its slice lands. Money is integer paise, as everywhere.
import type { RoleType } from "@/lib/rules";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
const L = (lakhs: number) => Math.round(lakhs * 100_000 * 100); // lakhs a year → paise
const monthly = (rupees: number) => rupees * 12 * 100; // stipend a month → annual paise

/* ───────────── Roles on the board (shared by the gateway, candidate and association) ───────────── */

export interface BoardRole {
  id: string;
  company: string;
  title: string;
  type: RoleType;
  ctcMin: number;
  ctcMax: number;
  yearsExp: [number, number];
  locations: string[];
  reach: string[];
  closesInMs: number;
  nudged?: boolean;
  jd: string;
}

export const BOARD_ROLES: BoardRole[] = [
  {
    id: "tessel-backend", company: "Tessel Systems", title: "Backend engineer, payments", type: "fresher",
    ctcMin: L(22), ctcMax: L(28), yearsExp: [0, 1], locations: ["Bengaluru", "Remote"],
    reach: ["IITB", "IITD", "IITM", "IITK", "IITKGP", "IITR", "IITG", "IITH", "IITBHU"],
    closesInMs: 2 * DAY + 9 * HOUR + 14 * 60_000, nudged: true,
    jd: "You will own the settlement service that moves money between merchant accounts and banks. The work is Go and Postgres, with a strong bias for correctness: idempotent writes, ledger invariants, reconciliation jobs that must never double count. You will pair with two senior engineers for the first quarter and take a service on call by the second.",
  },
  {
    id: "kiln-design-intern", company: "Kiln Labs", title: "Product design intern", type: "intern",
    ctcMin: monthly(60_000), ctcMax: monthly(80_000), yearsExp: [0, 0], locations: ["Bengaluru"],
    reach: ["IITB", "IITD", "IITG", "IITGN", "IITH"],
    closesInMs: 6 * DAY + 4 * HOUR + 12 * 60_000,
    jd: "Six months with a three-person design team building scheduling tools for ceramic studios. You will run two usability rounds a month with studio owners, own one flow end to end, and ship it with the engineers. A portfolio matters more than your branch. Figma is assumed; prototyping in code is a plus.",
  },
  {
    id: "meridian-or", company: "Meridian Freight", title: "Operations research analyst", type: "fresher",
    ctcMin: L(18), ctcMax: L(21), yearsExp: [0, 1], locations: ["Mumbai"],
    reach: ["IITB", "IITD", "IITKGP", "IITM"],
    closesInMs: 8 * DAY + 1 * HOUR + 40 * 60_000,
    jd: "Meridian routes about four thousand trucks a day. You will build and tune the optimisation models behind load matching and return trips, working in Python with OR-Tools. Expect to spend a week each quarter at a depot. Coursework in linear programming or a relevant thesis is what we look for.",
  },
  {
    id: "orbitwell-firmware", company: "Orbitwell", title: "Firmware intern, satellite radios", type: "intern",
    ctcMin: monthly(50_000), ctcMax: monthly(60_000), yearsExp: [0, 0], locations: ["Hyderabad"],
    reach: ["IITB", "IITD", "IITM", "IITK", "IITKGP", "IITR", "IITG", "IITH", "IITBHU", "IITI", "IITGN", "IITRPR", "IITMandi", "IITJ", "IITP", "IITBBS", "IITISM", "IITTP", "IITPKD", "IITBH", "IITGOA", "IITJMU", "IITDH"],
    closesInMs: 9 * DAY + 6 * HOUR + 3 * 60_000, nudged: true,
    jd: "Write and test firmware for the S-band radio on our next cubesat. The stack is C on an STM32 with a small RTOS. You will bring up drivers, write hardware-in-the-loop tests, and sit in on two thermal vacuum campaigns. Any embedded project you can show us counts for more than grades.",
  },
  {
    id: "lumen-staff-data", company: "Lumen Health", title: "Staff data engineer", type: "experienced",
    ctcMin: L(55), ctcMax: L(70), yearsExp: [6, 10], locations: ["Bengaluru", "Pune"],
    reach: ["IITB", "IITD", "IITM", "IITK", "IITKGP", "IITR", "IITG", "IITH", "IITBHU", "IITI", "IITGN", "IITRPR"],
    closesInMs: 4 * DAY + 20 * HOUR + 30 * 60_000,
    jd: "Lumen runs claims for 140 hospitals. You will lead the move from nightly batch to streaming, set the data contracts other teams build on, and mentor four engineers. We need someone who has run a warehouse migration before and can explain the trade-offs to a finance team.",
  },
  {
    id: "corvid-pm", company: "Corvid Analytics", title: "Senior product manager, pricing", type: "experienced",
    ctcMin: L(40), ctcMax: L(52), yearsExp: [5, 8], locations: ["Gurugram"],
    reach: ["IITD", "IITB", "IITK", "IITR", "IITBHU", "IITKGP"],
    closesInMs: 1 * DAY + 3 * HOUR + 50 * 60_000,
    jd: "Own pricing and packaging for a product used by 300 retail chains. You will run experiments with the data science team, write the pricing page, and sit in on renewals. Experience with usage-based billing helps. You report to the head of product and work from the Gurugram office three days a week.",
  },
];

/* ───────────── Candidate seat ───────────── */

export interface VerificationItem {
  id: string;
  name: string;
  batch: string;
  branch: string;
  linkedin: string;
  source: "Referral link" | "Direct request";
  viaRole?: string;
  openedDaysAgo: number;
  attempt: 1 | 2;
}

export const VERIFICATION_QUEUE: VerificationItem[] = [
  { id: "v1", name: "Prateek Arora", batch: "2016", branch: "Mechanical Engineering", linkedin: "linkedin.com/in/prateek-arora-demo", source: "Referral link", viaRole: "Staff data engineer, Lumen Health", openedDaysAgo: 0, attempt: 1 },
  { id: "v2", name: "Shalini Gupta", batch: "2018", branch: "Computer Science", linkedin: "linkedin.com/in/shalini-gupta-demo", source: "Referral link", viaRole: "Senior product manager, pricing, Corvid Analytics", openedDaysAgo: 1, attempt: 1 },
  { id: "v3", name: "Imran Qureshi", batch: "2012", branch: "Electrical Engineering", linkedin: "linkedin.com/in/imran-qureshi-demo", source: "Direct request", openedDaysAgo: 3, attempt: 1 },
  { id: "v4", name: "Kavya Subramanian", batch: "2019", branch: "Chemical Engineering", linkedin: "linkedin.com/in/kavya-s-demo", source: "Direct request", openedDaysAgo: 4, attempt: 2 },
  { id: "v5", name: "Gaurav Sinha", batch: "2009", branch: "Civil Engineering", linkedin: "linkedin.com/in/gaurav-sinha-demo", source: "Direct request", openedDaysAgo: 8, attempt: 1 },
  { id: "v6", name: "Tara Bhatt", batch: "2015", branch: "Textile Technology", linkedin: "linkedin.com/in/tara-bhatt-demo", source: "Referral link", viaRole: "Staff data engineer, Lumen Health", openedDaysAgo: 9, attempt: 1 },
];

export interface ReferralLink { id: string; roleId: string | null; label: string; token: string; signups: number; visits: number }
export const REFERRALS: ReferralLink[] = [
  { id: "ref-general", roleId: null, label: "General link for any IIT Delhi alum", token: "d-7k2q9x", signups: 41, visits: 0 },
  { id: "ref-lumen", roleId: "lumen-staff-data", label: "Staff data engineer, Lumen Health", token: "d-lm4p0c", signups: 6, visits: 19 },
  { id: "ref-corvid", roleId: "corvid-pm", label: "Senior product manager, pricing, Corvid Analytics", token: "d-cv81nt", signups: 3, visits: 11 },
];

export interface AttributedHire {
  id: string;
  batch: string;
  role: string;
  company: string;
  name?: string; // only when the candidate has switched on name_visible_to_association
  attributedBy: "Referral link for this role" | "Earlier referral link" | "Verified by the association";
  hiredCtc: number;
  outcome: "Joined" | "Hired, joining confirmed" | "Did not join";
  flagged?: boolean;
}
export const ATTRIBUTED_HIRES: AttributedHire[] = [
  { id: "h1", batch: "2014", role: "Engineering manager", company: "Corvid Analytics", name: "Rhea Kapoor", attributedBy: "Referral link for this role", hiredCtc: L(48), outcome: "Joined" },
  { id: "h2", batch: "2019", role: "Senior product engineer", company: "Tessel Systems", attributedBy: "Verified by the association", hiredCtc: L(30), outcome: "Hired, joining confirmed" },
  { id: "h3", batch: "2021", role: "Data scientist", company: "Calyx Foods", attributedBy: "Earlier referral link", hiredCtc: L(20), outcome: "Did not join" },
];

/** Association ledger entries (§4.4). `base` is the amount collected or reversed; the share is base × share_rate. */
export interface ShareEntry { id: string; date: string; type: "accrued" | "reversed" | "paid_cash"; hireId?: string; base: number; note: string }
export const SHARE_LEDGER: ShareEntry[] = [
  { id: "e1", date: "12 Aug 2026", type: "accrued", hireId: "h1", base: 3_000_000, note: "Deposit applied to fee" },
  { id: "e2", date: "9 Sep 2026", type: "accrued", hireId: "h1", base: 45_000_000, note: "Fee paid" },
  { id: "e3", date: "1 Oct 2026", type: "paid_cash", base: 7_200_000, note: "September statement, paid by bank transfer" },
  { id: "e4", date: "6 Oct 2026", type: "accrued", hireId: "h2", base: 3_000_000, note: "Deposit applied to fee" },
  { id: "e5", date: "14 Oct 2026", type: "accrued", hireId: "h3", base: 1_500_000, note: "Deposit applied to fee" },
  { id: "e6", date: "27 Oct 2026", type: "reversed", hireId: "h3", base: 1_500_000, note: "Candidate did not join, application reversed" },
  { id: "e7", date: "3 Nov 2026", type: "accrued", hireId: "h2", base: 13_500_000, note: "Fee part paid" },
];
