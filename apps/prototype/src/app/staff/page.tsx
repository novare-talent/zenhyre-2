import type { Metadata } from "next";
import { requireStaffSession } from "./guard";
import { readApi } from "@/lib/server-api";
import { Queues, type ReviewItem } from "./Queues";

export const metadata: Metadata = { title: "Queues" };
const KINDS = ["gate", "verification", "join_dispute", "alert"] as const;

export default async function Page() {
  await requireStaffSession();
  const lists = await Promise.all(KINDS.map((k) => readApi<{ items: ReviewItem[] }>(`/admin/reviews?kind=${k}`)));
  return <Queues queues={Object.fromEntries(KINDS.map((k, i) => [k, lists[i]!.items])) as Record<(typeof KINDS)[number], ReviewItem[]>} />;
}
