import { STAGE_LABEL, STAGE_ORDER, type Stage } from "@/lib/rules";

/** Seven lamps for the §4.3 stages: lit up to the current one. */
export function StageLamps({ stage }: { stage: Stage }) {
  const at = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  return (
    <ol className="stages" aria-label={at < 0 ? STAGE_LABEL[stage] : `Stage ${at + 1} of ${STAGE_ORDER.length}: ${STAGE_LABEL[stage]}`}>
      {STAGE_ORDER.map((s, i) => <li key={s} className={`${i <= at ? "is-on" : ""}${i === at ? " is-now" : ""}`} style={{ "--i": i } as React.CSSProperties} title={STAGE_LABEL[s]} />)}
    </ol>
  );
}
