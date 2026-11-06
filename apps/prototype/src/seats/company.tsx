"use client";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useParams, usePathname } from "next/navigation";
import { Tabs } from "@/components/Bar";
import { Mast, TallyCell } from "@/components/Mast";
import { useRules } from "@/components/Rules";
import { useNotify } from "@/components/Toasts";
import { COMPANY_ROLES, DAY, SHORTLIST, type CompanyRole, type ShortlistRow } from "@/data/fixtures";
import { defaultFeeTerms, depositFor, evaluateRules, feeFor, formatPaise, NEXT_STAGE, SETTLED, STAGE_LABEL,
  type GateOutcome, type Paise, type RejectionCategory, type RoleDraft, type Stage } from "@/lib/rules";

export interface Hire { matchId: string; hiredCtc: Paise; joinedOn: string }
export interface MatchRow extends ShortlistRow { offeredCtc?: Paise; rejectionCategory?: RejectionCategory }

interface CompanyState {
  roles: CompanyRole[];
  matches: MatchRow[]; // the frozen shortlist for "founding-backend"
  hire: Hire | null;
  role: (id: string) => CompanyRole | undefined;
  depositOf: (r: CompanyRole) => Paise;
  /** §3.3 submitRole + gateDecision: the rules pass is real, the model pass is simulated as an accept. */
  submitRole: (d: RoleDraft & { yearsExp: [number, number] }) => { id: string; outcome: GateOutcome };
  acceptTerms: (id: string) => void;
  payDeposit: (id: string) => void;
  appeal: (id: string) => void;
  /** §3.3 companyAction: one forward step, enforcing the §4.3 table and the one-hire rule. */
  advance: (matchId: string, data?: { offeredCtc?: Paise; hiredCtc?: Paise; joinedOn?: string }) => void;
  reject: (matchId: string, category: RejectionCategory) => void;
  backedOut: (matchId: string) => void;
  didNotJoin: () => void;
  markViewed: (matchId: string) => void;
}
const Ctx = createContext<CompanyState | null>(null);
export const useCompany = () => useContext(Ctx)!;

const TITLES: Record<string, string> = { "/company": "Your roles", "/company/new": "Post a role" };
const today = () => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date());

/** The signed-in company user and their company, as the API holds them (§4.1). */
export interface CompanyIdentity { email: string; role: "owner" | "member"; company: { name: string; verifiedDomain: string; status: "active" | "probation" | "banned" } }
const STATUS = { active: "Active company", probation: "On probation", banned: "Suspended" } as const;

export function CompanySeat({ identity, children }: { identity: CompanyIdentity; children: ReactNode }) {
  const rules = useRules();
  const notify = useNotify();
  const path = usePathname();
  const params = useParams<{ id?: string }>();
  const [roles, setRoles] = useState<CompanyRole[]>(COMPANY_ROLES);
  const [matches, setMatches] = useState<MatchRow[]>(SHORTLIST);
  const [hire, setHire] = useState<Hire | null>(null);

  const value = useMemo<CompanyState>(() => {
    const patchRole = (id: string, p: Partial<CompanyRole>) => setRoles((xs) => xs.map((r) => (r.id === id ? { ...r, ...p } : r)));
    const patchMatch = (id: string, p: Partial<MatchRow>) => setMatches((xs) => xs.map((m) => (m.id === id ? { ...m, ...p } : m)));
    const nameOf = (id: string) => matches.find((m) => m.id === id)?.name ?? "Candidate";
    return {
      roles, matches, hire,
      role: (id) => roles.find((r) => r.id === id),
      depositOf: (r) => depositFor(rules, r.reach.length),
      submitRole(d) {
        const outcome = evaluateRules(rules, d);
        const id = `${d.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "role"}-${Date.now().toString(36).slice(-4)}`;
        const base: CompanyRole = { id, title: d.title || "Untitled role", type: d.type, ctcMin: d.ctcMin, ctcMax: d.ctcMax, yearsExp: d.yearsExp, locations: d.locations, reach: d.reach, jd: d.jd, createdOn: today(),
          status: "rejected", gateNote: outcome.reason, gateRule: outcome.rule };
        setRoles((xs) => [outcome.outcome === "accept"
          ? { ...base, status: "terms_pending", gateRule: undefined, gateNote: "Passed the rules. The model pass is simulated in this prototype and accepted the role.", terms: defaultFeeTerms(rules, d.type, d.yearsExp[0]) }
          : base, ...xs]);
        notify(outcome.outcome === "accept" ? `Role accepted: ${base.title}` : `Role not accepted: ${base.title}`);
        return { id, outcome };
      },
      acceptTerms(id) { patchRole(id, { status: "deposit_pending", termsAccepted: true }); notify("Terms accepted. They cannot change from here."); },
      payDeposit(id) {
        const r = roles.find((x) => x.id === id);
        patchRole(id, { status: "broadcast", closesInMs: rules.broadcastDays * DAY, applicants: 0 });
        notify(`Deposit captured: ${r ? formatPaise(depositFor(rules, r.reach.length)) : ""}. The role is on the board.`);
      },
      appeal(id) { patchRole(id, { status: "gated", appealed: true, gateNote: "Appeal received. A person at Novare is reviewing the role." }); notify("Appeal sent to the Novare team."); },
      markViewed(matchId) {
        const m = matches.find((x) => x.id === matchId);
        if (m?.stage === "shortlisted" && !hire) patchMatch(matchId, { stage: "viewed" });
      },
      advance(matchId, data) {
        const m = matches.find((x) => x.id === matchId);
        const next = m && NEXT_STAGE[m.stage];
        if (!m || !next) return;
        if (hire) return; // one-hire rule: once a hire is recorded, other matches can only be rejected
        if (next === "hired") {
          if (!data?.hiredCtc || !data.joinedOn) return;
          setHire({ matchId, hiredCtc: data.hiredCtc, joinedOn: data.joinedOn });
          patchRole("founding-backend", { status: "closing" });
          patchMatch(matchId, { stage: "hired" });
          notify(`Hire recorded: ${m.name}. We will confirm joining with the candidate.`);
          return;
        }
        if (next === "offered" && !data?.offeredCtc) return;
        patchMatch(matchId, { stage: next, offeredCtc: data?.offeredCtc ?? m.offeredCtc });
        notify(`${m.name}: ${STAGE_LABEL[next].toLowerCase()}.`);
      },
      reject(matchId, category) {
        const m = matches.find((x) => x.id === matchId);
        if (!m || SETTLED.includes(m.stage)) return;
        patchMatch(matchId, { stage: "rejected", rejectionCategory: category });
        notify(`${nameOf(matchId)} marked not selected. They see the category only.`);
      },
      backedOut(matchId) { patchMatch(matchId, { stage: "offer_reneged" }); notify(`${nameOf(matchId)}: offer reneged.`); },
      didNotJoin() {
        if (!hire) return;
        patchMatch(hire.matchId, { stage: "did_not_join" as Stage });
        patchRole("founding-backend", { status: "shortlist_ready" });
        notify(`${nameOf(hire.matchId)} did not join. The fee is voided and the shortlist is open again.`);
        setHire(null);
      },
    };
  }, [roles, matches, hire, rules, notify]);

  const live = roles.filter((r) => r.status === "broadcast");
  const lit = new Set(live.flatMap((r) => r.reach)).size;
  const current = params?.id ? roles.find((r) => r.id === params.id) : undefined;
  const title = current?.title ?? TITLES[path] ?? (params?.id ? "No such role" : "Company");
  const todo = roles.filter((r) => r.status === "shortlist_ready" || r.status === "terms_pending" || r.status === "deposit_pending").length;

  return (
    <Ctx.Provider value={value}>
      <main id="main" tabIndex={-1} className="seat-main">
        <Mast
          cell={<TallyCell n={lit} top="Lit now" bottom="of 23" />}
          title={title}
          sub={<>{identity.company.name}. You are {identity.role === "owner" ? "the owner" : "a member"}, on the <span className="mono">{identity.company.verifiedDomain}</span> domain.</>}
          facts={<>
            <span className={`tag${identity.company.status === "active" ? "" : " tag--stop"}`}>{STATUS[identity.company.status]}</span>
            <span className="tag tag--quiet">Sample roles until posting goes live</span>
          </>}
        />
        <Tabs label="Company" items={[
          { href: "/company", label: "Roles", count: todo },
          { href: "/company/new", label: "Post a role" },
        ]} />
        {children}
      </main>
    </Ctx.Provider>
  );
}

/** What the fee looks like once a hire is recorded (§9.2 steps 2 to 5). */
export function feeBreakdown(role: CompanyRole, deposit: Paise, hire: Hire) {
  const fee = role.terms ? feeFor(role.terms, hire.hiredCtc) : 0;
  const applied = Math.min(deposit, fee);
  return { fee, applied, outstanding: fee - applied, refund: deposit - applied };
}
