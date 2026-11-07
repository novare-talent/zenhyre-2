import type { Metadata } from "next";
import type { CandidateRoleView } from "@/lib/api-types";
import { readApi } from "@/lib/server-api";
import { RolesForYou } from "./RolesForYou";

export const metadata: Metadata = { title: "Roles for you", description: "The candidate seat: roles broadcast to your campus that fit your year, with the time left on each window and a one-step application." };
export default async function Page() {
  const { roles } = await readApi<{ roles: CandidateRoleView[] }>("/me/roles");
  return <RolesForYou roles={roles} />;
}
