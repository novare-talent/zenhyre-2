import type { Metadata } from "next";
import { Roles } from "./Roles";

export const metadata: Metadata = { title: "Your roles", description: "The company seat: every role with its place in the lifecycle, the campuses it reaches, the deposit held against it and the next step." };
export default function Page() { return <Roles />; }
