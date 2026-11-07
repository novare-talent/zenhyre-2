import type { Metadata } from "next";
import type { CompanyRoleView } from "@/lib/api-types";
import { readApi } from "@/lib/server-api";
import { currentSession } from "@/lib/session";
import { Roles } from "./Roles";

export const metadata: Metadata = { title: "Your roles", description: "The company seat: every role with its place in the lifecycle, the campuses it reaches, the deposit against it and the next step." };

export default async function Page() {
  const s = (await currentSession())!;
  const { roles } = await readApi<{ roles: CompanyRoleView[] }>(`/companies/${s.me.company!.id}/roles`);
  return <Roles roles={roles} />;
}
