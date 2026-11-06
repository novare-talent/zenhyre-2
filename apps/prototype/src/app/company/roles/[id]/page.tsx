import type { Metadata } from "next";
import { COMPANY_ROLES } from "@/data/fixtures";
import { RolePage } from "./RolePage";

type Props = { params: Promise<{ id: string }> };

export function generateStaticParams() { return COMPANY_ROLES.map((r) => ({ id: r.id })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const r = COMPANY_ROLES.find((x) => x.id === id);
  return {
    title: r ? r.title : "Role",
    description: r ? `${r.title} at Kiln Labs: where the role stands in its lifecycle, the campuses it reaches, its deposit and fee terms, and its shortlist.` : "A role posted in this prototype session.",
  };
}
export default async function Page({ params }: Props) {
  const { id } = await params;
  return <RolePage id={id} />;
}
