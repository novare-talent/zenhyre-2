import { Suspense, type ReactNode } from "react";
import { Bar } from "@/components/Bar";
import { SeatNotice } from "@/components/SeatNotice";
import { requireSeat } from "@/lib/session";
import { AssociationSeat } from "@/seats/association";

export default async function Layout({ children }: { children: ReactNode }) {
  const { me, email } = await requireSeat("association");
  const a = me.associations[0]!;
  return (
    <>
      <Bar session={{ email, seat: "association" }} />
      <Suspense><SeatNotice seat="association" /></Suspense>
      <AssociationSeat identity={{ email, name: a.name, campusCode: a.campus?.shortCode ?? "", shareRate: Number(a.shareRate), payoutMode: a.payoutMode, mouSignedAt: a.mouSignedAt }}>{children}</AssociationSeat>
    </>
  );
}
