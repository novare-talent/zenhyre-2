import { ROLE_STATES, ROLE_STATE_LABEL, type RoleStatus } from "@/lib/rules";

/** Compact lifecycle track for one role (§5): eight lamps, lit up to the current state. */
export function RoleTrack({ status }: { status: RoleStatus }) {
  const off = status === "rejected" || status === "withdrawn";
  const at = off ? (status === "rejected" ? 1 : -1) : ROLE_STATES.indexOf(status as (typeof ROLE_STATES)[number]);
  return (
    <ol className="track track--sm" aria-label={`Role lifecycle: ${ROLE_STATE_LABEL[status]}${off ? "" : `, step ${at + 1} of ${ROLE_STATES.length}`}`}>
      {ROLE_STATES.map((s, i) => (
        <li key={s} className={`track__stop${i <= at && !off ? " is-on" : ""}${i === at ? " is-now" : ""}`}>
          <span className="track__lamp" style={i <= at ? { background: off ? "var(--stop)" : "var(--lit)", borderColor: off ? "var(--stop)" : undefined } : undefined} aria-hidden="true" />
          <span className="track__name">{i === at && off ? ROLE_STATE_LABEL[status] : ROLE_STATE_LABEL[s]}</span>
        </li>
      ))}
    </ol>
  );
}
