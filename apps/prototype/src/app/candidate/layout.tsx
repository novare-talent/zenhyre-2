import { Suspense, type ReactNode } from "react";
import { Bar } from "@/components/Bar";
import { SeatNotice } from "@/components/SeatNotice";
import { requireSeat } from "@/lib/session";
import { CandidateSeat, type CandidateIdentity } from "@/seats/candidate";

export default async function Layout({ children }: { children: ReactNode }) {
  const { me, email } = await requireSeat("candidate");
  const c = me.candidate!;
  const identity: CandidateIdentity = {
    email, emails: me.emails, campusCode: me.campus?.shortCode ?? "", course: c.course, gradDate: c.gradDate, status: c.status,
    verificationState: c.verificationState, verificationSource: c.verificationSource, verificationAttempts: c.verificationAttempts,
    verifiedAt: c.verifiedAt, rollNumber: c.rollNumber, rollNumberFlag: c.rollNumberFlag, open: c.openToOpportunities,
    profile: {
      headline: c.profile.headline ?? "", skills: c.profile.skills ?? [], preferredRoles: c.profile.preferred_roles ?? [],
      preferredLocations: c.profile.preferred_locations ?? [], yearsExperience: c.profile.years_experience ?? 0,
      noticePeriodDays: c.profile.notice_period_days ?? 0, linkedin: c.profile.linkedin_url ?? "",
    },
  };
  return (
    <>
      <Bar session={{ email, seat: "candidate" }} />
      <Suspense><SeatNotice seat="candidate" /></Suspense>
      <CandidateSeat identity={identity}>{children}</CandidateSeat>
    </>
  );
}
