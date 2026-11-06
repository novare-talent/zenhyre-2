import type { ReactNode } from "react";

/** Seat masthead: the seat's own cell, the page title, and a few facts on the right. */
export function Mast({ cell, title, sub, facts }: { cell: ReactNode; title: ReactNode; sub: ReactNode; facts?: ReactNode }) {
  return (
    <section className="mast wrap" aria-label="Where you are">
      <div className="mast__cell post">{cell}</div>
      <div className="mast__id">
        <h1 key={typeof title === "string" ? title : undefined} className="display t-xl post-solid">{title}</h1>
        <p className="meta post" style={{ "--i": 3 } as React.CSSProperties}>{sub}</p>
      </div>
      {facts ? <div className="mast__facts post" style={{ "--i": 5 } as React.CSSProperties}>{facts}</div> : null}
    </section>
  );
}

export function CampusCell({ sym, city, lit = true }: { sym: string; city: string; lit?: boolean }) {
  return (
    <div className={`cell${lit ? " is-on" : ""}`} aria-hidden="true">
      <span className="cell__iit">IIT</span>
      <span className="cell__sym">{sym}</span>
      <span className="cell__city">{city}</span>
    </div>
  );
}
export function TallyCell({ n, top, bottom }: { n: number; top: string; bottom: string }) {
  return (
    <div className="cell cell--tally" aria-hidden="true">
      <span className="cell__iit">{top}</span>
      <span className="cell__sym">{String(n).padStart(2, "0")}</span>
      <span className="cell__city">{bottom}</span>
    </div>
  );
}
