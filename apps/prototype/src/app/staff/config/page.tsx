import type { Metadata } from "next";
import { requireStaffSession } from "../guard";
import { readApi } from "@/lib/server-api";
import { ConfigEditor } from "./ConfigEditor";

export const metadata: Metadata = { title: "Config" };
export default async function Page() {
  await requireStaffSession();
  return <ConfigEditor values={await readApi<Record<string, unknown>>("/admin/config")} />;
}
