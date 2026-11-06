import { CAMPUSES } from "@/data/campuses";

const two = (n: number) => String(n).padStart(2, "0");

/**
 * The board: 23 campus cells and a 24th cell that keeps the tally.
 * With onToggle the cells are switches; without it the board is read-only.
 */
export function Board({ selected, onToggle, seq, compact, label, voidCell }: {
  selected: ReadonlySet<string>;
  onToggle?: (code: string) => void;
  seq?: boolean;
  compact?: boolean;
  label: string;
  voidCell?: boolean;
}) {
  return (
    <ul className={`board${compact ? " board--compact" : ""}`} data-seq={seq ? "" : undefined} aria-label={label}>
      {CAMPUSES.map((c, i) => {
        const on = selected.has(c.code);
        const inner = (
          <>
            <span className="cell__iit" aria-hidden="true">IIT</span>
            <span className="cell__sym" aria-hidden="true">{c.sym}</span>
            <span className="cell__city" aria-hidden="true">{c.city}</span>
            <span className="vh">{c.name}{onToggle ? "" : on ? ", reached" : ", not reached"}</span>
          </>
        );
        return (
          <li key={c.code} style={{ "--i": i } as React.CSSProperties}>
            {onToggle
              ? <button type="button" className="cell" aria-pressed={on} onClick={() => onToggle(c.code)}>{inner}</button>
              : <div className={`cell${on ? " is-on" : ""}`}>{inner}</div>}
          </li>
        );
      })}
      <li>
        {voidCell ? (
          <div className="cell cell--void">
            <span className="cell__iit">IIT</span>
            <span className="cell__sym">24</span>
            <span className="cell__city">No such cell</span>
          </div>
        ) : (
          <div className="cell cell--tally">
            <span className="cell__iit">Lit</span>
            <span className="cell__sym">{two(selected.size)}</span>
            <span className="cell__city">of {CAMPUSES.length}</span>
          </div>
        )}
      </li>
    </ul>
  );
}

/** The same board at reading size: 23 marks, lit where a role reaches. */
export function MiniBoard({ reach }: { reach: readonly string[] }) {
  const set = new Set(reach);
  const names = CAMPUSES.filter((c) => set.has(c.code)).map((c) => c.name.replace("IIT ", ""));
  const label = set.size === CAMPUSES.length ? "Reaches all 23 campuses" : `Reaches ${set.size} of 23 campuses: ${names.join(", ")}`;
  return (
    <span className="mini" role="img" aria-label={label} title={label}>
      {CAMPUSES.map((c) => <i key={c.code} className={set.has(c.code) ? "on" : undefined} />)}
    </span>
  );
}
