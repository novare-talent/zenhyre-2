"use client";
import Link from "next/link";
import { MiniBoard } from "@/components/Board";
import { Countdown } from "@/components/Clock";
import { Arrow } from "@/components/Icons";
import { RoleTrack } from "@/components/Track";
import type { CompanyRoleView } from "@/lib/api-types";
import { ctcBand, formatPaise, ROLE_STATE_LABEL } from "@/lib/rules";
import { useCompany } from "@/seats/company";

const TYPE = { intern: "Internship", fresher: "Fresher", experienced: "Experienced" } as const;

function Next({ r }: { r: CompanyRoleView }) {
  switch (r.status) {
    case "draft": return <><span className="tag">Draft</span><span className="small">Not submitted yet</span></>;
    case "gated": return <><span className="tag">In review</span><span className="small">{r.appealed ? "Appeal with the Novare team" : "With the Novare team"}</span></>;
    case "rejected": return <><span className="tag tag--stop">Not accepted</span><span className="small">{r.gate?.rule ?? "At the gate"}</span></>;
    case "terms_pending": return r.feeTerms
      ? <><span className="tag tag--lit">Terms to accept</span><span className="small">Released by Novare</span></>
      : <><span className="tag">Accepted</span><span className="small">Terms on their way</span></>;
    case "deposit_pending": return <><span className="tag">Deposit</span><span className="small">{r.depositAmount !== null ? formatPaise(r.depositAmount) : ""} with Novare</span></>;
    case "broadcast": return <><span className="tag tag--ink">On the board</span><span className="small">{r.broadcastClosesAt ? <Countdown until={r.broadcastClosesAt} /> : null}</span></>;
    case "shortlist_ready": return <><span className="tag tag--lit">Shortlist ready</span><span className="small">{Math.min(r.applicants, r.shortlistCap)} candidates to review</span></>;
    case "closing": return <><span className="tag tag--lit">Hire recorded</span><span className="small">Fee and joining on the role page</span></>;
    default: return <span className="tag tag--quiet">{ROLE_STATE_LABEL[r.status]}</span>;
  }
}

export function Roles({ roles }: { roles: CompanyRoleView[] }) {
  const { codes } = useCompany();
  const live = roles.filter((r) => ["broadcast", "shortlist_ready", "closing"].includes(r.status) && r.depositAmount);
  // Only a paid deposit is held. A waived one (every deposit in Slice 1) was never collected.
  const held = live.filter((r) => r.depositMode === "razorpay");
  const waived = live.filter((r) => r.depositMode === "waived");
  const owed = roles.filter((r) => r.status === "deposit_pending" && r.depositAmount);

  return (
    <div className="work wrap">
      <div className="work__main">
        <div className="work__lead">
          <h2 className="display t-m">{roles.length === 1 ? "1 role" : `${roles.length} roles`}</h2>
          <Link href="/company/new" className="btn btn--ink">Post a role<Arrow /></Link>
        </div>
        {roles.length === 0 ? (
          <p className="empty">No roles yet. Post one and it goes to the gate within the minute.</p>
        ) : (
          <ul className="rows">
            {roles.map((r, i) => (
              <li key={r.id} className="row post" style={{ "--i": i + 2 } as React.CSSProperties}>
                <Link href={`/company/roles/${r.id}`} className="row__hit" style={{ gap: "0.9rem" }}>
                  <span className="role-row" style={{ display: "grid" }}>
                    <span>
                      <span className="role-row__title">{r.title}</span>
                      <span className="meta" style={{ display: "block", marginTop: "0.2rem" }}>{TYPE[r.type]}, {ctcBand(r.type, r.ctcMin, r.ctcMax)}. {r.locations.join(" or ") || "No location"}. <MiniBoard reach={codes(r.campusReach)} /></span>
                    </span>
                    <span className="role-row__right"><Next r={r} /></span>
                  </span>
                  <RoleTrack status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <aside className="work__side" aria-label="Deposits">
        <div className="sheet post" style={{ "--i": 4 } as React.CSSProperties}>
          <div className="sheet__head"><h3>Deposits</h3></div>
          <div className="sheet__pad">
            {held.length + owed.length + waived.length === 0 ? <p className="small">Nothing held. A deposit is set when you accept a role's terms.</p> : (
              <dl className="kv">
                {owed.map((r) => <div key={r.id} style={{ display: "contents" }}><dt>{r.title} (due)</dt><dd className="num">{formatPaise(r.depositAmount!)}</dd></div>)}
                {held.map((r) => <div key={r.id} style={{ display: "contents" }}><dt>{r.title}</dt><dd className="num">{formatPaise(r.depositAmount!)}</dd></div>)}
                {waived.map((r) => <div key={r.id} style={{ display: "contents" }}><dt>{r.title}</dt><dd>Waived by Novare</dd></div>)}
                <div className="kv--total" style={{ display: "contents" }}><dt>Held now</dt><dd className="num">{formatPaise(held.reduce((s, r) => s + (r.depositAmount ?? 0), 0))}</dd></div>
              </dl>
            )}
            <p className="meta" style={{ marginTop: "1rem" }}>A deposit belongs to one role. It is refunded, applied to the fee on a hire, or forfeited only if the shortlist is ignored. It is never a balance you top up.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
