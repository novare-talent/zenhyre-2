import type { Metadata } from "next";
import type { CompanyRoleView, RolePaymentsView, ShortlistRowView } from "@/lib/api-types";
import { currentSession } from "@/lib/session";
import { readApiOrNull } from "@/lib/server-api";
import { RolePage } from "./RolePage";

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<{ order_id?: string; pay?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const r = await readApiOrNull<{ role: CompanyRoleView }>(`/roles/${id}`);
  return {
    title: r ? r.role.title : "Role",
    description: r ? `${r.role.title}: where the role stands in its lifecycle, the campuses it reaches, its deposit and fee terms, and its shortlist.` : "A role in the company seat.",
  };
}

export default async function Page({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const r = await readApiOrNull<{ role: CompanyRoleView }>(`/roles/${id}`);
  if (!r) return <RolePage role={null} shortlist={null} />;
  const showList = ["shortlist_ready", "closing", "closed"].includes(r.role.status);
  const list = showList ? await readApiOrNull<{ shortlist: ShortlistRowView[] }>(`/roles/${id}/shortlist`) : null;
  const [pay, session] = await Promise.all([readApiOrNull<{ payments: RolePaymentsView }>(`/roles/${id}/payments`), currentSession()]);
  const email = session?.email ?? "";
  const returned = { orderId: typeof sp.order_id === "string" ? sp.order_id : undefined, pay: typeof sp.pay === "string" ? sp.pay : undefined };
  return <RolePage role={r.role} shortlist={list?.shortlist ?? null} payments={pay?.payments ?? null} returned={returned} email={email} />;
}
