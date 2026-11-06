import type { Metadata } from "next";
import { NewRole } from "./NewRole";

export const metadata: Metadata = { title: "Post a role", description: "Write a role, switch on the campuses it should reach, and watch the gate rules and the refundable deposit update as you type." };
export default function Page() { return <NewRole />; }
