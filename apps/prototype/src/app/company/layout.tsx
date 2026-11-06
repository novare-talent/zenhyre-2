import { Suspense, type ReactNode } from "react";
import { Bar } from "@/components/Bar";
import { SeatNotice } from "@/components/SeatNotice";
import { requireSeat } from "@/lib/session";
import { CompanySeat } from "@/seats/company";

export default async function Layout({ children }: { children: ReactNode }) {
  const { me, email } = await requireSeat("company");
  const company = me.company!;
  return (
    <>
      <Bar session={{ email, seat: "company" }} />
      <Suspense><SeatNotice seat="company" /></Suspense>
      <CompanySeat identity={{ email, role: me.membership!.role, company: { name: company.name, verifiedDomain: company.verifiedDomain, status: company.status } }}>{children}</CompanySeat>
    </>
  );
}
