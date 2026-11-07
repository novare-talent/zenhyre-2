import { Suspense, type ReactNode } from "react";
import { Bar } from "@/components/Bar";
import { SeatNotice } from "@/components/SeatNotice";
import type { ApplicationView } from "@/lib/api-types";
import { readApi } from "@/lib/server-api";
import { requireSeat } from "@/lib/session";
import { CandidateSeat, type CandidateIdentity } from "@/seats/candidate";

export default async function Layout({ children }: { children: ReactNode }) {
  const { me, email } = await requireSeat("candidate");
  const c = me.candidate!;
  const p = c.profile as typeof c.profile & { name?: string };
  const [{ campuses }, { applications }] = await Promise.all([
    readApi<{ campuses: { id: string; shortCode: string }[] }>("/campuses"),
    readApi<{ applications: ApplicationView[] }>("/me/applications"),
  ]);
  const identity: CandidateIdentity = {
    email, emails: me.emails, campusCode: me.campus?.shortCode ?? "", course: c.course, gradDate: c.gradDate, status: c.status,
    verificationState: c.verificationState, verificationSource: c.verificationSource, verificationAttempts: c.verificationAttempts,
    verifiedAt: c.verifiedAt, rollNumber: c.rollNumber, rollNumberFlag: c.rollNumberFlag, open: c.openToOpportunities,
    profile: {
      name: p.name ?? "", headline: p.headline ?? "", skills: p.skills ?? [], preferredRoles: p.preferred_roles ?? [],
      preferredLocations: p.preferred_locations ?? [], yearsExperience: p.years_experience ?? 0,
      noticePeriodDays: p.notice_period_days ?? 0, linkedin: p.linkedin_url ?? "",
    },
  };
  // §9.2: hires whose "did you join?" question is out and unanswered.
  const waiting = applications.filter((a) => a.stage === "hired" && a.joinPromptSentAt && !a.joinConfirmedAt).length;
  return (
    <>
      <Bar session={{ email, seat: "candidate" }} />
      <Suspense><SeatNotice seat="candidate" /></Suspense>
      <CandidateSeat identity={identity} campusCodes={Object.fromEntries(campuses.map((x) => [x.id, x.shortCode]))} waiting={waiting}>{children}</CandidateSeat>
    </>
  );
}
