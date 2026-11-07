import { Suspense, type ReactNode } from "react";
import { Bar } from "@/components/Bar";
import { SeatNotice } from "@/components/SeatNotice";
import type { CompanyRoleView } from "@/lib/api-types";
import { readApi } from "@/lib/server-api";
import { requireSeat } from "@/lib/session";
import { CompanySeat } from "@/seats/company";

export default async function Layout({ children }: { children: ReactNode }) {
  const { me, email } = await requireSeat("company");
  const company = me.company!;
  const [{ roles }, { campuses }] = await Promise.all([
    readApi<{ roles: CompanyRoleView[] }>(`/companies/${company.id}/roles`),
    readApi<{ campuses: { id: string; shortCode: string }[] }>("/campuses"),
  ]);
  return (
    <>
      <Bar session={{ email, seat: "company" }} />
      <Suspense><SeatNotice seat="company" /></Suspense>
      <CompanySeat
        identity={{ email, role: me.membership!.role, company: { id: company.id, name: company.name, verifiedDomain: company.verifiedDomain, status: company.status } }}
        campusCodes={Object.fromEntries(campuses.map((c) => [c.id, c.shortCode]))}
        roles={roles}
      >{children}</CompanySeat>
    </>
  );
}
