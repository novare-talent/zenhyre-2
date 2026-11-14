import type { Metadata } from "next";
import { requireStaffSession } from "../../guard";
import { readApiOrNull } from "@/lib/server-api";
import { RoleAdmin, type AdminRoleView } from "./RoleAdmin";

export const metadata: Metadata = { title: "Role" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffSession();
  const { id } = await params;
  const data = await readApiOrNull<AdminRoleView>(`/admin/roles/${id}`);
  if (!data) return <div className="wrap"><p className="empty">No such role.</p></div>;
  return <RoleAdmin data={data} />;
}
