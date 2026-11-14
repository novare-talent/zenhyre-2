"use client";
import Link from "next/link";
import { useState } from "react";
import { useStaffAction } from "./act";

export interface ReviewItem { id: string; kind: string; refType: string; refId: string; associationId: string | null; payload: Record<string, unknown>; openedAt: string }
type Kind = "gate" | "verification" | "join_dispute" | "alert";

const TITLE: Record<Kind, string> = { gate: "Role gate", verification: "Verification", join_dispute: "Join disputes", alert: "Alerts" };
const HELP: Record<Kind, string> = {
  gate: "Roles the rules passed but the model did not settle, appeals, and reach mismatches (§7 stage 3). Accept, optionally with a narrower reach, or reject with the reason the company will see.",
  verification: "Roll-number flags and alumni claims with no association, or open for longer than the escape-hatch window (§6.2). Note the evidence you saw.",
  join_dispute: "A hire said they did not join and the company stands by the hire (§9.2). Decide which is true.",
  alert: "Job failures and anything else that needs a person (§13). Resolve once it is handled.",
};
const OPTIONS: Record<Kind, { value: string; label: string; needsNote?: boolean; tone?: "stop" }[]> = {
  gate: [{ value: "accept", label: "Accept" }, { value: "reject", label: "Reject", needsNote: true, tone: "stop" }],
  verification: [{ value: "approve", label: "Verify", needsNote: true }, { value: "clear_flag", label: "Clear roll-number flag" }, { value: "reject", label: "Do not verify", needsNote: true, tone: "stop" }, { value: "reject_fraud", label: "False claim", needsNote: true, tone: "stop" }],
  join_dispute: [{ value: "joined", label: "They joined" }, { value: "did_not_join", label: "They did not join", tone: "stop" }],
  alert: [{ value: "resolved", label: "Mark handled" }],
};
const daysAgo = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

export function Queues({ queues }: { queues: Record<Kind, ReviewItem[]> }) {
  const [kind, setKind] = useState<Kind>((Object.keys(queues) as Kind[]).find((k) => queues[k].length) ?? "gate");
  return (
    <div className="work wrap">
      <div className="work__main">
        <div className="chips" role="tablist" aria-label="Queue" style={{ marginBottom: "1.25rem" }}>
          {(Object.keys(TITLE) as Kind[]).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={k === kind} className={`tag${k === kind ? " tag--lit" : ""}`} onClick={() => setKind(k)}>
              {TITLE[k]} · {queues[k].length}
            </button>
          ))}
        </div>
        <p className="meta" style={{ maxWidth: "46rem", marginBottom: "1rem" }}>{HELP[kind]}</p>
        {queues[kind].length === 0 ? <p className="empty">Nothing waiting.</p> : (
          <ul className="rows">{queues[kind].map((it) => <Item key={it.id} kind={kind} item={it} />)}</ul>
        )}
      </div>
    </div>
  );
}

function Item({ kind, item }: { kind: Kind; item: ReviewItem }) {
  const { act, busy } = useStaffAction();
  const [note, setNote] = useState("");
  const [reach, setReach] = useState("");
  const p = item.payload as Record<string, any>;
  const summary = kind === "verification"
    ? (p.reason === "roll_number_mismatch" ? `Roll number ${p.rollNumber} does not match the campus pattern` : `Claims batch ${p.claimed?.batch ?? "?"}, ${p.claimed?.branch ?? "?"}${p.claimed?.linkedinUrl ? ` · ${p.claimed.linkedinUrl}` : ""}`)
    : kind === "alert" ? `${p.job ?? "alert"}: ${p.error ?? JSON.stringify(p)}`
    : kind === "gate" ? (p.reason ?? p.trigger ?? "Needs a decision")
    : `Disputed hire${p.note ? `: ${p.note}` : ""}`;
  return (
    <li className="row">
      <div className="row__body" style={{ display: "grid", gap: "0.75rem", padding: "1rem 1.25rem" }}>
        <div className="role-row" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "1rem" }}>
          <span>
            <b>{item.refType === "role" ? <Link href={`/staff/roles/${item.refId}`} className="link">Role {item.refId.slice(0, 8)}</Link> : `${item.refType} ${item.refId.slice(0, 8)}`}</b>
            <span className="meta" style={{ display: "block", overflowWrap: "anywhere" }}>{summary}</span>
          </span>
          <span className="small">{daysAgo(item.openedAt)}d open{item.associationId ? " · association queue" : ""}</span>
        </div>
        <div className="field" style={{ maxWidth: "40rem" }}>
          <label htmlFor={`n-${item.id}`} className="small">Note (the reason a company or candidate sees; evidence for staff decisions)</label>
          <input id={`n-${item.id}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          {kind === "gate" && (<>
            <label htmlFor={`r-${item.id}`} className="small">Campus reach on accept (optional, short codes, comma separated)</label>
            <input id={`r-${item.id}`} className="input" value={reach} onChange={(e) => setReach(e.target.value)} placeholder="IITB, IITD" />
          </>)}
        </div>
        <div className="actions">
          {OPTIONS[kind].map((o) => (
            <button key={o.value} type="button" disabled={!!busy || (o.needsNote && !note.trim())} className={`btn btn--sm${o.tone === "stop" ? " btn--stop" : " btn--ink"}`}
              onClick={() => act(o.value, "POST", `reviews/${item.id}/resolve`, {
                resolution: o.value, note: note.trim() || undefined,
                campusReach: kind === "gate" && o.value === "accept" && reach.trim() ? reach.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
              }, "Done.")}>
              {busy === o.value ? "Working…" : o.label}
            </button>
          ))}
        </div>
      </div>
    </li>
  );
}
