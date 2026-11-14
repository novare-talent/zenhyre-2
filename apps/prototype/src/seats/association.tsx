"use client";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Tabs } from "@/components/Bar";
import { CampusCell, Mast } from "@/components/Mast";
import { useNotify } from "@/components/Toasts";
import { campus } from "@/data/campuses";
import { SHARE_LEDGER, type ShareEntry, type VerificationItem } from "@/data/fixtures";
export type { VerificationItem };
import { percentOf, type Paise } from "@/lib/rules";

export type Resolution = "approve" | "reject" | "reject_fraud";
export interface Resolved { item: VerificationItem; resolution: Resolution; reason?: string }

/** The signed-in admin's association, as the API holds it (§4.1). */
export interface AssociationIdentity { email: string; name: string; campusCode: string; shareRate: number; payoutMode: "cash" | "sponsorship_credit"; mouSignedAt: string | null }

interface AssociationState {
  me: AssociationIdentity;
  queue: VerificationItem[];
  resolved: Resolved[];
  tips: number;
  resolve: (id: string, resolution: Resolution, reason?: string) => void;
  sendTip: () => void;
}
const Ctx = createContext<AssociationState | null>(null);
export const useAssociation = () => useContext(Ctx)!;

/** §9.3: the share is the collected (or reversed) amount × share_rate. Payouts are entered as paid. */
export const shareOf = (rate: number, e: ShareEntry): Paise => (e.type === "paid_cash" ? e.base : percentOf(e.base, rate));
/** §4.4: associationBalance = accrued − reversed − paid. */
export function balances(rate: number) {
  const sum = (t: ShareEntry["type"]) => SHARE_LEDGER.filter((e) => e.type === t).reduce((s, e) => s + shareOf(rate, e), 0);
  const accrued = sum("accrued"), reversed = sum("reversed"), paid = sum("paid_cash");
  return { accrued, reversed, paid, balance: accrued - reversed - paid };
}

const TITLES: Record<string, string> = { "/association": "Alumni to verify", "/association/referrals": "Links to share", "/association/earnings": "What you have earned" };

export function AssociationSeat({ identity, initialQueue, children }: { identity: AssociationIdentity; initialQueue: VerificationItem[]; children: ReactNode }) {
  const notify = useNotify();
  const path = usePathname();
  const [queue, setQueue] = useState(initialQueue);
  const [resolved, setResolved] = useState<Resolved[]>([]);
  const [tips, setTips] = useState(0);

  const value = useMemo<AssociationState>(() => ({
    me: identity, queue, resolved, tips,
    resolve(id, resolution, reason) {
      const item = queue.find((q) => q.id === id);
      if (!item) return;
      // Optimistic: the row leaves the queue at once and comes back if the API refuses.
      setQueue((xs) => xs.filter((q) => q.id !== id));
      setResolved((xs) => [{ item, resolution, reason }, ...xs]);
      void fetch(`/api/zh/association/reviews/${encodeURIComponent(id)}/resolve`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resolution, note: reason }),
      }).then(async (r) => {
        if (r.ok) {
          notify(resolution === "approve" ? `${item.name} is verified and can now be shortlisted.` : `${item.name} was not verified. They have been told why.`);
          return;
        }
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        setQueue((xs) => [item, ...xs]);
        setResolved((xs) => xs.filter((x) => x.item.id !== id));
        notify(j.message ?? "That did not go through. Try again.");
      }).catch(() => {
        setQueue((xs) => [item, ...xs]);
        setResolved((xs) => xs.filter((x) => x.item.id !== id));
        notify("The server did not answer. Try again in a minute.");
      });
    },
    sendTip() { setTips((n) => n + 1); notify("Sent to the Novare team. Nothing changes until they confirm it."); },
  }), [identity, queue, resolved, tips, notify]);

  const c = campus(identity.campusCode);
  return (
    <Ctx.Provider value={value}>
      <main id="main" tabIndex={-1} className="seat-main">
        <Mast
          cell={<CampusCell sym={c.sym} city={c.city} />}
          title={TITLES[path] ?? "Association"}
          sub={<>{identity.name}. You are an admin.</>}
          facts={<>
            <span className="tag">{Math.round(identity.shareRate * 100)}% of fees collected</span>
            {path !== "/association" && <span className="tag tag--quiet">Sample figures until referrals go live</span>}
          </>}
        />
        <Tabs label="Association" items={[
          { href: "/association", label: "Verify", count: queue.length },
          { href: "/association/referrals", label: "Links" },
          { href: "/association/earnings", label: "Earnings" },
        ]} />
        {children}
      </main>
    </Ctx.Provider>
  );
}
