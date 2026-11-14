import { Suspense, type ReactNode } from "react";
import { Bar } from "@/components/Bar";
import { SeatNotice } from "@/components/SeatNotice";
import { requireSeat } from "@/lib/session";
import { AssociationSeat, type VerificationItem } from "@/seats/association";
import { readApi } from "@/lib/server-api";

interface ApiItem {
  id: string; openedAt: string;
  candidate: null | { name: string | null; claimedBatch: string | null; claimedBranch: string | null; course: string; linkedinUrl: string | null; source: string; attempt: number };
}

export default async function Layout({ children }: { children: ReactNode }) {
  const { me, email } = await requireSeat("association");
  const a = me.associations[0]!;
  const { items } = await readApi<{ items: ApiItem[] }>("/association/reviews");
  const now = Date.now();
  const queue: VerificationItem[] = items.map((i) => ({
    id: i.id,
    name: i.candidate?.name ?? "Name not given",
    batch: i.candidate?.claimedBatch ?? "not given",
    branch: i.candidate?.claimedBranch ?? i.candidate?.course ?? "not given",
    linkedin: i.candidate?.linkedinUrl ?? "not given",
    source: i.candidate?.source === "referral" ? "Referral link" : "Direct request",
    openedDaysAgo: Math.max(0, Math.floor((now - new Date(i.openedAt).getTime()) / 86_400_000)),
    attempt: (i.candidate?.attempt ?? 1) >= 2 ? 2 : 1, // a first request is attempt 1 (identity.createCandidate)
  }));
  return (
    <>
      <Bar session={{ email, seat: "association" }} />
      <Suspense><SeatNotice seat="association" /></Suspense>
      <AssociationSeat initialQueue={queue} identity={{ email, name: a.name, campusCode: a.campus?.shortCode ?? "", shareRate: Number(a.shareRate), payoutMode: a.payoutMode, mouSignedAt: a.mouSignedAt }}>{children}</AssociationSeat>
    </>
  );
}
