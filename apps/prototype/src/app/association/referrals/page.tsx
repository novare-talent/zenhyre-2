import type { Metadata } from "next";
import { Referrals } from "./Referrals";

export const metadata: Metadata = { title: "Links to share", description: "Referral links for the roles open to your alumni, with the sign-ups and visits each link has brought in so far." };
export default function Page() { return <Referrals />; }
