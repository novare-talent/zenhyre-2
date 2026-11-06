import type { Metadata } from "next";
import { RolesForYou } from "./RolesForYou";

export const metadata: Metadata = { title: "Roles for you", description: "The candidate seat: roles broadcast to your campus that fit your year, with the time left on each window and a one-step application." };
export default function Page() { return <RolesForYou />; }
