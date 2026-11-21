import type { Metadata } from "next";
import Link from "next/link";
import type { RolePaymentsView } from "@/lib/api-types";
import { readApiOrNull } from "@/lib/server-api";
import { FakeCheckout } from "./FakeCheckout";

export const metadata: Metadata = { title: "Test checkout", robots: { index: false } };

/** Dev only: stands in for Cashfree's hosted checkout when the API runs the fake gateway (`PAYMENT_PROVIDER=fake`). */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ order?: string }> }) {
  const { id } = await params;
  const { order } = await searchParams;
  const data = await readApiOrNull<{ payments: RolePaymentsView }>(`/roles/${id}/payments`);
  const o = data?.payments.orders.find((x) => x.orderId === order);
  if (!data || data.payments.mode !== "fake" || !o) {
    return <div className="work wrap"><div className="work__main"><div className="empty"><p style={{ marginBottom: "1rem" }}>There is no test checkout here.</p><Link href={`/company/roles/${id}`} className="btn">Back to the role</Link></div></div></div>;
  }
  return <FakeCheckout roleId={id} order={o} />;
}
