import { notFound, redirect } from "next/navigation";
import { currentSession } from "@/lib/session";

/**
 * Every staff page calls this before reading the admin API. Next renders a page alongside its layout, so the layout's
 * check alone would still let the page fire admin requests for a non-staff visitor (the API refuses them, but noisily).
 */
export async function requireStaffSession() {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (!s.me.user.isStaff) notFound();
  return s;
}

/** The finance console: staff who also hold `user.is_finance` (granted in SQL). Anyone else gets a 404. */
export async function requireFinanceSession() {
  const s = await requireStaffSession();
  if (!s.me.user.isFinance) notFound();
  return s;
}
