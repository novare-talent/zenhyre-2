import type { Metadata } from "next";
import { Applications } from "./Applications";

export const metadata: Metadata = { title: "Your applications", description: "Every application and the stage it has reached, from applied to hired, with the joining confirmation a candidate answers after a hire." };
export default function Page() { return <Applications />; }
