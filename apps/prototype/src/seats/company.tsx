"use client";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, usePathname } from "next/navigation";
import { Tabs } from "@/components/Bar";
import { Mast, TallyCell } from "@/components/Mast";
import type { CompanyRoleView } from "@/lib/api-types";

/** The signed-in company user and their company, as the API holds them (§4.1). */
export interface CompanyIdentity { email: string; role: "owner" | "member"; company: { id: string; name: string; verifiedDomain: string; status: "active" | "probation" | "banned" } }
const STATUS = { active: "Active company", probation: "On probation", banned: "Suspended" } as const;

interface CompanyState {
  me: CompanyIdentity;
  /** Campus id → short code, for the boards. */
  codeOf: (campusId: string) => string;
  codes: (campusIds: readonly string[]) => string[];
  /** A page sets the masthead title it knows better than the layout (a role page, its role's title). */
  setTitle: (t: string | null) => void;
}
const Ctx = createContext<CompanyState | null>(null);
export const useCompany = () => useContext(Ctx)!;

const TITLES: Record<string, string> = { "/company": "Your roles", "/company/new": "Post a role" };
/** Roles the company still has to act on. */
export const needsAction = (r: CompanyRoleView) => r.status === "shortlist_ready" || (r.status === "terms_pending" && !!r.feeTerms) || r.status === "deposit_pending" || r.status === "draft";

export function CompanySeat({ identity, campusCodes, roles, children }: { identity: CompanyIdentity; campusCodes: Record<string, string>; roles: CompanyRoleView[]; children: ReactNode }) {
  const path = usePathname();
  const params = useParams<{ id?: string }>();
  const [pageTitle, setTitle] = useState<string | null>(null);
  const value = useMemo<CompanyState>(() => ({
    me: identity,
    codeOf: (id) => campusCodes[id] ?? "",
    codes: (ids) => ids.map((id) => campusCodes[id]).filter((c): c is string => !!c),
    setTitle,
  }), [identity, campusCodes]);

  const live = roles.filter((r) => r.status === "broadcast");
  const lit = new Set(live.flatMap((r) => r.campusReach)).size;
  const current = params?.id ? roles.find((r) => r.id === params.id) : undefined;
  const title = (params?.id && pageTitle) || current?.title || TITLES[path] || (params?.id ? "Role" : "Company");
  const todo = roles.filter(needsAction).length;

  return (
    <Ctx.Provider value={value}>
      <main id="main" tabIndex={-1} className="seat-main">
        <Mast
          cell={<TallyCell n={lit} top="Lit now" bottom="of 23" />}
          title={title}
          sub={<>{identity.company.name}. You are {identity.role === "owner" ? "the owner" : "a member"}, on the <span className="mono">{identity.company.verifiedDomain}</span> domain.</>}
          facts={<>
            <span className={`tag${identity.company.status === "active" ? "" : " tag--stop"}`}>{STATUS[identity.company.status]}</span>
            <span className="meta">{live.length} {live.length === 1 ? "role" : "roles"} on the board</span>
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
