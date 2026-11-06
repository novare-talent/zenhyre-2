"use client";
import Link from "next/link";
import { MiniBoard } from "@/components/Board";
import { Countdown } from "@/components/Clock";
import { Arrow } from "@/components/Icons";
import { RoleTrack } from "@/components/Track";
import { ctcBand, formatPaise, ROLE_STATE_LABEL } from "@/lib/rules";
import { useCompany } from "@/seats/company";
import type { CompanyRole } from "@/data/fixtures";

const TYPE = { intern: "Internship", fresher: "Fresher", experienced: "Experienced" } as const;

function Next({ r, shortlistCount }: { r: CompanyRole; shortlistCount: number }) {
  switch (r.status) {
    case "shortlist_ready": return <><span className="tag tag--lit">Shortlist ready</span><span className="small">{shortlistCount} candidates to review</span></>;
    case "broadcast": return <><span className="tag tag--ink">On the board</span><span className="small"><Countdown ms={r.closesInMs ?? 0} /></span></>;
    case "terms_pending": return <><span className="tag tag--lit">Terms to accept</span><span className="small">Released by Novare</span></>;
    case "deposit_pending": return <><span className="tag tag--lit">Deposit to pay</span><span className="small">Then it goes on the board</span></>;
    case "closing": return <><span className="tag tag--lit">Hire recorded</span><span className="small">In the guarantee window</span></>;
    case "gated": return <><span className="tag">In review</span><span className="small">{r.appealed ? "Appeal with the Novare team" : "At the gate"}</span></>;
    case "rejected": return <><span className="tag tag--stop">Not accepted</span><span className="small">{r.gateRule}</span></>;
    default: return <span className="tag tag--quiet">{ROLE_STATE_LABEL[r.status]}</span>;
  }
}

export function Roles() {
  const { roles, matches, depositOf } = useCompany();
  const held = roles.filter((r) => ["broadcast", "shortlist_ready", "closing"].includes(r.status));
  const shortlistCount = matches.filter((m) => m.stage !== "rejected" && m.stage !== "did_not_join" && m.stage !== "offer_reneged").length;

  return (
    <div className="work wrap">
      <div className="work__main">
        <div className="work__lead">
          <h2 className="display t-m">{roles.length} roles</h2>
          <Link href="/company/new" className="btn btn--ink">Post a role<Arrow /></Link>
        </div>
        <ul className="rows">
          {roles.map((r, i) => (
            <li key={r.id} className="row post" style={{ "--i": i + 2 } as React.CSSProperties}>
              <Link href={`/company/roles/${r.id}`} className="row__hit" style={{ gap: "0.9rem" }}>
                <span className="role-row" style={{ display: "grid" }}>
                  <span>
                    <span className="role-row__title">{r.title}</span>
                    <span className="meta" style={{ display: "block", marginTop: "0.2rem" }}>{TYPE[r.type]}, {ctcBand(r.type, r.ctcMin, r.ctcMax)}. {r.locations.join(" or ")}. <MiniBoard reach={r.reach} /></span>
                  </span>
                  <span className="role-row__right"><Next r={r} shortlistCount={shortlistCount} /></span>
                </span>
                <RoleTrack status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <aside className="work__side" aria-label="Deposits">
        <div className="sheet post" style={{ "--i": 4 } as React.CSSProperties}>
          <div className="sheet__head"><h3>Deposits held</h3></div>
          <div className="sheet__pad">
            <dl className="kv">
              {held.map((r) => <div key={r.id} style={{ display: "contents" }}><dt>{r.title}</dt><dd className="num">{formatPaise(depositOf(r))}</dd></div>)}
              <div className="kv--total" style={{ display: "contents" }}><dt>Held now</dt><dd className="num">{formatPaise(held.reduce((s, r) => s + depositOf(r), 0))}</dd></div>
            </dl>
            <p className="meta" style={{ marginTop: "1rem" }}>A deposit belongs to one role. It is refunded, applied to the fee on a hire, or forfeited only if the shortlist is ignored. It is never a balance you top up.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
