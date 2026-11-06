import type { NextRequest } from "next/server";
import { forward } from "@/lib/forward";
export const POST = (req: NextRequest) => forward(req, "POST", "/companies");
