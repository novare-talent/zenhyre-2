"use client";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Tabs } from "@/components/Bar";
import { CampusCell, Mast } from "@/components/Mast";
import { useNotify } from "@/components/Toasts";
import { campus } from "@/data/campuses";

/** The signed-in candidate, as the API holds them (§4.1). */
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
export interface Profile { name: string; headline: string; skills: string[]; preferredRoles: string[]; preferredLocations: string[]; yearsExperience: number; noticePeriodDays: number; linkedin: string }

interface CandidateState {
  me: CandidateIdentity;
  verificationState: CandidateIdentity["verificationState"];
  open: boolean;
  profile: Profile;
  codes: (campusIds: readonly string[]) => string[];
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

export function CandidateSeat({ identity, campusCodes, waiting, children }: { identity: CandidateIdentity; campusCodes: Record<string, string>; waiting: number; children: ReactNode }) {
  const notify = useNotify();
  const router = useRouter();
  const path = usePathname();
  const [open, setOpenState] = useState(identity.open);
  const [profile, setProfile] = useState(identity.profile);
  const [verificationState, setVerificationState] = useState(identity.verificationState);

  const value = useMemo<CandidateState>(() => ({
    me: identity, verificationState, open, profile,
    codes: (ids) => ids.map((id) => campusCodes[id]).filter((c): c is string => !!c),
    setOpen(v) {
      setOpenState(v); // optimistic; rolled back if the server says no
      send("/api/me/open", "PUT", { open: v }).then((ok) => {
        if (ok) notify(v ? "Nudges are on." : "Nudges are off. You can still apply to any role you see.");
        else { setOpenState(!v); notify("That did not save. Try again."); }
      });
    },
    async saveProfile(p) {
      const ok = await send("/api/me/profile", "PUT", {
        name: p.name, headline: p.headline, skills: p.skills, preferred_roles: p.preferredRoles, preferred_locations: p.preferredLocations,
        years_experience: p.yearsExperience, notice_period_days: p.noticePeriodDays, linkedin_url: p.linkedin });
      if (ok) { setProfile(p); notify("Profile saved. You will be matched again against open roles."); router.refresh(); }
      else notify("That did not save. Check the fields and try again.");
    },
    async retryVerification() {
      const ok = await send("/api/me/verification", "POST");
      if (ok) { setVerificationState("verification_pending"); notify("Sent to your association again."); }
      else notify("You have already asked twice. Write to Novare if the decision is wrong.");
    },
  }), [identity, verificationState, open, profile, campusCodes, notify, router]);

  const c = campus(identity.campusCode);
  return (
    <Ctx.Provider value={value}>
      <main id="main" tabIndex={-1} className="seat-main">
        <Mast
          cell={<CampusCell sym={c.sym} city={c.city} lit={verificationState === "verified"} />}
          title={TITLES[path] ?? "Candidate"}
          sub={<>{profile.name ? `${profile.name}. ` : ""}{STATUS_LABEL[identity.status]}, {identity.course}, {c.name}.</>}
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
