import type { NextRequest } from "next/server";
import { forward } from "@/lib/forward";
export const PUT = (req: NextRequest) => forward(req, "PUT", "/me/profile");
