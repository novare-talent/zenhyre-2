import type { Metadata } from "next";
import { Earnings } from "./Earnings";

export const metadata: Metadata = { title: "What you have earned", description: "Attributed hires, the share accrued on each fee collected, reversals, payouts and the balance owed to the association today." };
export default function Page() { return <Earnings />; }
