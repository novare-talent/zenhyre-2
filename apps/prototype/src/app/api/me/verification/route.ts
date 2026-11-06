import type { NextRequest } from "next/server";
import { forward } from "@/lib/forward";
/** §6.1: a rejected alum may ask for verification once more. */
export const POST = (req: NextRequest) => forward(req, "POST", "/me/verification/retry", {});
