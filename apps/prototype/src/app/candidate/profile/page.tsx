import type { Metadata } from "next";
import { Profile } from "./Profile";

export const metadata: Metadata = { title: "Profile and verification", description: "A candidate's verified campus identity, the profile parsed from their CV, and the single switch that controls role nudges." };
export default function Page() { return <Profile />; }
