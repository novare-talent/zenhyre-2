"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useNotify } from "@/components/Toasts";

/** A staff action: call /api/staff/<path>, tell the person how it went, and re-read the page's data on success. */
export function useStaffAction() {
  const router = useRouter();
  const notify = useNotify();
  const [busy, setBusy] = useState<string | null>(null);
  async function act(key: string, method: "POST" | "PUT", path: string, body: unknown, done: string) {
    setBusy(key);
    try {
      const r = await fetch(`/api/staff/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
      const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string; issues?: { message: string }[] };
      if (!r.ok) { notify(j.message ?? j.issues?.[0]?.message ?? j.error ?? `Refused (${r.status}).`); return false; }
      notify(done);
      router.refresh();
      return true;
    } catch {
      notify("The server did not answer. Try again in a minute.");
      return false;
    } finally { setBusy(null); }
  }
  return { act, busy };
}
