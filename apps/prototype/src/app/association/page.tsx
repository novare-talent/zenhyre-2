import type { Metadata } from "next";
import { Queue } from "./Queue";

export const metadata: Metadata = { title: "Alumni to verify", description: "The association seat: alumni who claim your campus, what they claimed, and a decision in two taps so nobody waits on a committee." };
export default function Page() { return <Queue />; }
