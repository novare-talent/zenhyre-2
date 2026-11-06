import Link from "next/link";

export function Footer() {
  return (
    <footer className="foot on-night">
      <div className="wrap">
        <div className="foot__row">
          <p className="lede" style={{ maxWidth: "30ch" }}>One board, twenty-three campuses, three seats. Pick yours.</p>
          <nav className="foot__links" aria-label="Log in">
            <Link className="lamp" href="/login?as=candidate">Candidate login</Link>
            <Link className="lamp" href="/login?as=company">Company login</Link>
            <Link className="lamp" href="/login?as=association">Association login</Link>
          </nav>
        </div>
        <p className="foot__word" aria-hidden="true">Zenhyre<i>.</i></p>
        <div className="foot__base">
          <p className="meta">Zenhyre is built by Novare Talent. The roles shown on this page are examples.</p>
          <p className="meta">Set in Archivo and DM Mono.</p>
        </div>
      </div>
    </footer>
  );
}
