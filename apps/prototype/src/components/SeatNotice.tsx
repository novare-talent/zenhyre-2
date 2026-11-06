"use client";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useNotify } from "@/components/Toasts";

/** Shown once when someone picked a different role at login than the one their email already holds. */
export function SeatNotice({ seat }: { seat: string }) {
  const notify = useNotify();
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const flagged = params.get("notice") === "role";
  useEffect(() => {
    if (!flagged) return;
    notify(`This email is registered for the ${seat} seat, so that is where you are. One email holds one role.`);
    router.replace(path);
  }, [flagged, notify, router, path, seat]);
  return null;
}
