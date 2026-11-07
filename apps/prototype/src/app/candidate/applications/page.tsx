import type { Metadata } from "next";
import type { ApplicationView } from "@/lib/api-types";
import { readApi } from "@/lib/server-api";
import { Applications } from "./Applications";

export const metadata: Metadata = { title: "Your applications", description: "Every application and the stage it has reached, from applied to hired, with the joining confirmation a candidate answers after a hire." };
export default async function Page() {
  const { applications } = await readApi<{ applications: ApplicationView[] }>("/me/applications");
  return <Applications applications={applications} />;
}
