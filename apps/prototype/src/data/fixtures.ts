// SAMPLE DATA. Identity (who is signed in, their campus, company or association) comes from the
// API. Everything in this file stands in for the modules the API does not have yet: roles, gate,
// matching and ledger (Slices 1B to 3). Every person, company, amount and link here is invented.
// Replace each export with an API call as its slice lands. Money is integer paise, as everywhere.
import type { FeeTerms, RejectionCategory, RoleStatus, RoleType, Stage } from "@/lib/rules";

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

export interface Application {
  id: string;
  company: string;
  title: string;
  type: RoleType;
  location: string;
  appliedOn: string;
  stage: Stage;
  rejectionCategory?: RejectionCategory;
  joinedOn?: string;
  joinAnswer?: "yes" | "no";
}

export const APPLICATIONS: Application[] = [
  { id: "app-halden", company: "Halden Labs", title: "Research intern, compilers", type: "intern", location: "Remote", appliedOn: "2 Oct 2026", stage: "hired", joinedOn: "3 Nov 2026" },
  { id: "app-paperboat", company: "Paperboat Robotics", title: "Software engineer intern", type: "intern", location: "Pune", appliedOn: "19 Oct 2026", stage: "interviewed" },
  { id: "app-northwind", company: "Northwind Mobility", title: "Associate product manager", type: "fresher", location: "Bengaluru", appliedOn: "24 Oct 2026", stage: "shortlisted" },
  { id: "app-calyx", company: "Calyx Foods", title: "Data analyst intern", type: "intern", location: "Mumbai", appliedOn: "28 Sep 2026", stage: "rejected", rejectionCategory: "experience" },
];

/* ───────────── Company seat ───────────── */

export interface CompanyRole {
  id: string;
  title: string;
  type: RoleType;
  ctcMin: number;
  ctcMax: number;
  yearsExp: [number, number];
  locations: string[];
  reach: string[];
  jd: string;
  status: RoleStatus;
  gateNote: string;
  gateRule?: string;
  terms?: FeeTerms;
  termsAccepted?: boolean;
  closesInMs?: number;
  applicants?: number;
  appealed?: boolean;
  createdOn: string;
}

export const COMPANY_ROLES: CompanyRole[] = [
  {
    id: "founding-backend", title: "Founding backend engineer", type: "experienced", ctcMin: L(38), ctcMax: L(52), yearsExp: [3, 6],
    locations: ["Bengaluru"], reach: ["IITB", "IITD", "IITM", "IITK", "IITKGP", "IITR", "IITH"],
    jd: "First backend hire at Kiln. You will design the booking and payments core in Go and Postgres, choose what we build and what we buy, and hire the next two engineers. We want someone who has carried a service through its first real load and can write the design doc as well as the code.",
    status: "shortlist_ready", gateNote: "Accepted at the model pass.", terms: { kind: "percent", amount: 0.1, replacementGuaranteeDays: 90 }, termsAccepted: true,
    applicants: 61, createdOn: "9 Oct 2026",
  },
  {
    id: "design-intern", title: "Product design intern", type: "intern", ctcMin: monthly(60_000), ctcMax: monthly(80_000), yearsExp: [0, 0],
    locations: ["Bengaluru"], reach: ["IITB", "IITD", "IITG", "IITGN", "IITH"],
    jd: BOARD_ROLES[1]!.jd,
    status: "broadcast", gateNote: "Accepted at the model pass.", terms: { kind: "flat", amount: 1_250_000, replacementGuaranteeDays: 90 }, termsAccepted: true,
    closesInMs: 6 * DAY + 4 * HOUR + 12 * 60_000, applicants: 14, createdOn: "30 Oct 2026",
  },
  {
    id: "ml-ranking", title: "ML engineer, ranking", type: "experienced", ctcMin: L(32), ctcMax: L(44), yearsExp: [2, 5],
    locations: ["Bengaluru", "Remote"], reach: ["IITB", "IITD", "IITM", "IITKGP"],
    jd: "Build the ranking model that decides which studio slots a customer sees first. You will own the feature pipeline, the offline evaluation and the online experiments. PyTorch and a production recommender or search system behind you are what we are after. Remote within India is fine.",
    status: "terms_pending", gateNote: "Accepted after a human review of the campus reach.", terms: { kind: "percent", amount: 0.1, replacementGuaranteeDays: 90 },
    createdOn: "3 Nov 2026",
  },
  {
    id: "field-sales", title: "Field sales associate", type: "fresher", ctcMin: L(6), ctcMax: L(8), yearsExp: [0, 1],
    locations: ["Jaipur"], reach: ["IITJ", "IITD"],
    jd: "Visit ceramic studios across Rajasthan, demo the product and close annual plans. Targets are monthly. Travel is five days a week and a two-wheeler is required. Commission is on top of the fixed pay and is paid quarterly once the studio has completed three months on the platform.",
    status: "rejected", gateNote: "\"field sales\" roles are not a fit for IIT talent.", gateRule: "Role category", createdOn: "1 Nov 2026",
  },
];

export interface ShortlistRow {
  id: string;
  name: string;
  campus: string;
  course: string;
  gradYear: number;
  years: number;
  title: string;
  employer: string;
  location: string;
  noticeDays: number;
  fit: number;
  reason: string;
  skills: string[];
  stage: Stage;
}

const row = (id: number, name: string, campus: string, course: string, gradYear: number, years: number, title: string, employer: string, location: string,
  noticeDays: number, fit: number, reason: string, skills: string[], stage: Stage = "shortlisted"): ShortlistRow =>
  ({ id: `m${String(id).padStart(2, "0")}`, name, campus, course, gradYear, years, title, employer, location, noticeDays, fit, reason, skills, stage });

/** The frozen shortlist for "Founding backend engineer": 25 rows, ranked by fit score (§8). */
export const SHORTLIST: ShortlistRow[] = [
  row(1, "Aditi Kulkarni", "IITB", "B.Tech CS", 2021, 5.3, "Senior engineer", "Fernhill Pay", "Bengaluru", 60, 94, "Built a double-entry ledger service in Go at payments scale and led four engineers. Already in Bengaluru.", ["Go", "PostgreSQL", "Ledgers", "Kafka"], "interviewed"),
  row(2, "Varun Shetty", "IITM", "Dual degree CS", 2020, 5.6, "Staff engineer", "Quillon", "Chennai", 90, 92, "Designed multi-region Postgres failover and has hired a team before. Open to moving to Bengaluru.", ["PostgreSQL", "Go", "Kubernetes"], "viewed"),
  row(3, "Nikhil Bansal", "IITD", "B.Tech Maths and Computing", 2021, 4.4, "Backend lead", "Sparrowline", "Bengaluru", 30, 91, "Took a bookings API from zero to its first two million requests a day. Short notice period.", ["Go", "gRPC", "Redis", "PostgreSQL"], "viewed"),
  row(4, "Sneha Iyer", "IITK", "B.Tech CS", 2022, 4.1, "Software engineer III", "Oakmere Cloud", "Hyderabad", 60, 89, "Strong on storage internals and on-call. Less product exposure than the top three.", ["Rust", "Go", "Storage"]),
  row(5, "Arjun Malhotra", "IITKGP", "B.Tech ECE", 2020, 6.0, "Engineering lead", "Tidewater Logistics", "Bengaluru", 90, 88, "Has run payments reconciliation and a team of six. At the top of the experience band.", ["Java", "Go", "Payments"]),
  row(6, "Pooja Raman", "IITM", "B.Tech CS", 2022, 4.0, "Senior engineer", "Brightloom", "Bengaluru", 45, 87, "Wrote the scheduling engine at a booking startup: the closest domain match on the list.", ["Go", "PostgreSQL", "Scheduling"]),
  row(7, "Karthik Reddy", "IITH", "B.Tech CS", 2022, 3.9, "Software engineer II", "Northgate Systems", "Hyderabad", 60, 86, "Solid distributed systems work and good design docs. Has not led hiring yet.", ["Go", "Kafka", "Postgres"]),
  row(8, "Ishita Chatterjee", "IITKGP", "Dual degree CS", 2021, 4.8, "Senior engineer", "Pinecrest", "Bengaluru", 60, 85, "Built billing and invoicing end to end. Prefers a team above ten people.", ["Python", "Go", "Billing"]),
  row(9, "Rahul Deshmukh", "IITB", "B.Tech EE", 2021, 5.0, "Backend engineer", "Kestrel Mobility", "Pune", 60, 84, "Moved from embedded to backend three years ago and owns a high-traffic dispatch service.", ["Go", "C++", "PostgreSQL"]),
  row(10, "Tanvi Saxena", "IITR", "B.Tech CS", 2022, 3.6, "Software engineer II", "Loomstate", "Bengaluru", 30, 83, "Fast, careful, strong references. Lighter on system design at the scale this role needs.", ["TypeScript", "Go", "Postgres"]),
  row(11, "Siddharth Nair", "IITM", "B.Tech CS", 2021, 4.7, "Senior engineer", "Harbourlight", "Bengaluru", 90, 82, "Deep Postgres knowledge, including logical replication. Long notice period.", ["PostgreSQL", "Go"]),
  row(12, "Meghna Pillai", "IITD", "B.Tech CS", 2023, 3.2, "Software engineer", "Fernhill Pay", "Bengaluru", 60, 81, "Payments experience at the low end of the experience band. Would grow into the role.", ["Go", "Payments"]),
  row(13, "Abhinav Tiwari", "IITK", "B.Tech Maths and Computing", 2020, 6.0, "Principal engineer", "Wrenfield", "Noida", 90, 80, "Architect-level experience. Compensation expectation is likely above the band.", ["Java", "Go", "Architecture"]),
  row(14, "Divya Menon", "IITH", "B.Tech CS", 2022, 3.8, "Backend engineer", "Saltmarsh AI", "Remote", 30, 79, "Good API design and testing habits. Wants to stay remote; the role is in Bengaluru.", ["Go", "Python", "gRPC"]),
  row(15, "Rohit Agarwal", "IITB", "B.Tech CS", 2023, 3.1, "Software engineer", "Quillon", "Bengaluru", 60, 78, "Bright and early in career. Has not yet owned a service through an incident.", ["Go", "Kubernetes"]),
  row(16, "Lakshmi Venkatesan", "IITM", "M.Tech CS", 2021, 4.5, "Senior engineer", "Copperline", "Chennai", 60, 77, "Built a rules engine for insurance claims. Domain is adjacent rather than close.", ["Java", "Postgres", "Rules engines"]),
  row(17, "Aman Khurana", "IITD", "B.Tech EE", 2021, 4.9, "Engineering manager", "Driftwood Labs", "Gurugram", 90, 76, "Now manages full time. The role needs someone hands-on for the first year.", ["Go", "Management"]),
  row(18, "Shreya Joshi", "IITR", "B.Tech CS", 2022, 4.0, "Software engineer II", "Oakmere Cloud", "Hyderabad", 60, 75, "Infrastructure-leaning. Would need to ramp up on product engineering.", ["Go", "Terraform", "AWS"]),
  row(19, "Vikram Sethi", "IITKGP", "B.Tech CS", 2020, 5.9, "Senior engineer", "Tidewater Logistics", "Bengaluru", 60, 74, "Reliable generalist with long tenure at one company. Limited greenfield experience.", ["Java", "Postgres"]),
  row(20, "Nandini Rao", "IITB", "B.Tech CS", 2022, 3.7, "Backend engineer", "Brightloom", "Bengaluru", 45, 73, "Worked on the same scheduling engine as Pooja Raman, in a supporting role.", ["Go", "Postgres"]),
  row(21, "Harsh Vardhan", "IITK", "B.Tech CS", 2023, 3.0, "Software engineer", "Pinecrest", "Bengaluru", 30, 72, "At the floor of the experience band. Good signal from an open-source Go project.", ["Go", "Open source"]),
  row(22, "Ritika Bose", "IITKGP", "B.Tech CS", 2021, 4.6, "Senior engineer", "Harbourlight", "Kolkata", 90, 71, "Strong engineer who has worked mostly in Java. Relocation needed.", ["Java", "Spring", "Postgres"]),
  row(23, "Yash Thakkar", "IITD", "B.Tech CS", 2022, 3.5, "Software engineer II", "Sparrowline", "Bengaluru", 60, 70, "Reports to Nikhil Bansal today. Good work, narrower scope.", ["Go", "Redis"]),
  row(24, "Anjali Sharma", "IITH", "B.Tech CS", 2023, 3.0, "Software engineer", "Northgate Systems", "Hyderabad", 60, 69, "Early career with a clear upward path. Would be a second hire rather than the first.", ["Go", "Kafka"]),
  row(25, "Dev Kapoor", "IITR", "B.Tech ECE", 2021, 4.2, "Backend engineer", "Kestrel Mobility", "Pune", 60, 68, "Capable, with a mixed backend and data background. The last row above the line.", ["Python", "Go", "Airflow"]),
];
/** The first applicant below the line. Shown as a redacted row: the longlist is staff only (§8). */
export const BELOW_LINE = { fit: 67, count: 36 };

/* ───────────── Association seat ───────────── */

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
