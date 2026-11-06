"use client";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Tabs } from "@/components/Bar";
import { CampusCell, Mast } from "@/components/Mast";
import { useNotify } from "@/components/Toasts";
import { campus } from "@/data/campuses";
import { APPLICATIONS, BOARD_ROLES, type Application } from "@/data/fixtures";

/** The signed-in candidate, as the API holds them (§4.1). Everything here is real. */
export interface CandidateIdentity {
  email: string;
  emails: { email: string; isPrimary: boolean; verified: boolean }[];
  campusCode: string;
  course: string;
  gradDate: string;
  status: "student" | "final_year" | "alumnus";
  verificationState: "verified" | "referral_pending" | "verification_pending" | "rejected";
  verificationSource: "campus_email" | "referral" | "association" | "staff";
  verificationAttempts: number;
  verifiedAt: string | null;
  rollNumber: string | null;
  rollNumberFlag: boolean;
  open: boolean;
  profile: Profile;
}
export interface Profile { headline: string; skills: string[]; preferredRoles: string[]; preferredLocations: string[]; yearsExperience: number; noticePeriodDays: number; linkedin: string }

interface CandidateState {
  me: CandidateIdentity;
  verificationState: CandidateIdentity["verificationState"];
  apps: Application[];
  open: boolean;
  profile: Profile;
  apply: (roleId: string) => void;
  withdraw: (appId: string) => void;
  answerJoin: (appId: string, a: "yes" | "no") => void;
  setOpen: (v: boolean) => void;
  saveProfile: (p: Profile) => Promise<void>;
  retryVerification: () => Promise<void>;
}
const Ctx = createContext<CandidateState | null>(null);
export const useCandidate = () => useContext(Ctx)!;

const TITLES: Record<string, string> = { "/candidate": "Roles for you", "/candidate/applications": "Your applications", "/candidate/profile": "Profile and verification" };
export const STATUS_LABEL = { student: "Student", final_year: "Final year", alumnus: "Alum" } as const;
const VERIFIED_BY = { campus_email: "Verified by campus email", referral: "Verified by your association", association: "Verified by your association", staff: "Verified by Novare" } as const;

const send = (path: string, method: "PUT" | "POST", body?: unknown) =>
  fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }).then((r) => r.ok).catch(() => false);

export function CandidateSeat({ identity, children }: { identity: CandidateIdentity; children: ReactNode }) {
  const notify = useNotify();
  const path = usePathname();
  const [apps, setApps] = useState(APPLICATIONS);
  const [open, setOpenState] = useState(identity.open);
  const [profile, setProfile] = useState(identity.profile);
  const [verificationState, setVerificationState] = useState(identity.verificationState);

  const value = useMemo<CandidateState>(() => ({
    me: identity, verificationState, apps, open, profile,
    apply(roleId) {
      const r = BOARD_ROLES.find((x) => x.id === roleId);
      if (!r || apps.some((a) => a.id === roleId) || verificationState !== "verified") return;
      setApps((xs) => [{ id: r.id, company: r.company, title: r.title, type: r.type, location: r.locations.join(" or "), appliedOn: "Today", stage: "applied" }, ...xs]);
      notify(`Applied: ${r.title}`); // §11 application_received, in-app
    },
    withdraw(appId) {
      setApps((xs) => xs.map((a) => (a.id === appId ? { ...a, stage: a.stage === "offer_accepted" ? "offer_reneged" : "withdrawn" } : a)));
      notify("Application withdrawn. The company has been told.");
    },
    answerJoin(appId, a) {
      setApps((xs) => xs.map((x) => (x.id === appId ? { ...x, joinAnswer: a } : x)));
      notify(a === "yes" ? "Thanks. Your joining is confirmed." : "Noted. The company has 3 days to respond.");
    },
    setOpen(v) {
      setOpenState(v); // optimistic; rolled back if the server says no
      send("/api/me/open", "PUT", { open: v }).then((ok) => {
        if (ok) notify(v ? "Nudges are on." : "Nudges are off. You can still apply to any role you see.");
        else { setOpenState(!v); notify("That did not save. Try again."); }
      });
    },
    async saveProfile(p) {
      const ok = await send("/api/me/profile", "PUT", {
        headline: p.headline, skills: p.skills, preferred_roles: p.preferredRoles, preferred_locations: p.preferredLocations,
        years_experience: p.yearsExperience, notice_period_days: p.noticePeriodDays, linkedin_url: p.linkedin });
      if (ok) { setProfile(p); notify("Profile saved. You will be matched again against open roles."); }
      else notify("That did not save. Check the fields and try again.");
    },
    async retryVerification() {
      const ok = await send("/api/me/verification", "POST");
      if (ok) { setVerificationState("verification_pending"); notify("Sent to your association again."); }
      else notify("You have already asked twice. Write to Novare if the decision is wrong.");
    },
  }), [identity, verificationState, apps, open, profile, notify]);

  const c = campus(identity.campusCode);
  const waiting = apps.filter((a) => a.stage === "hired" && !a.joinAnswer).length;
  return (
    <Ctx.Provider value={value}>
      <main id="main" tabIndex={-1} className="seat-main">
        <Mast
          cell={<CampusCell sym={c.sym} city={c.city} lit={verificationState === "verified"} />}
          title={TITLES[path] ?? "Candidate"}
          sub={<>{STATUS_LABEL[identity.status]}, {identity.course}, {c.name}.</>}
          facts={<>
            {verificationState === "verified" ? <span className="tag tag--lit">{VERIFIED_BY[identity.verificationSource]}</span>
              : verificationState === "rejected" ? <span className="tag tag--stop">Not verified</span>
              : <span className="tag">Waiting to be verified</span>}
            <span className={`tag${open ? "" : " tag--quiet"}`}>{open ? "Open to opportunities" : "Nudges off"}</span>
          </>}
        />
        <Tabs label="Candidate" items={[
          { href: "/candidate", label: "Roles" },
          { href: "/candidate/applications", label: "Applications", count: waiting },
          { href: "/candidate/profile", label: "Profile" },
        ]} />
        {children}
      </main>
    </Ctx.Provider>
  );
}
