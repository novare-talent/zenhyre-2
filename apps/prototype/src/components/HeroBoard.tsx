"use client";
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { Board } from "@/components/Board";
import { useRules } from "@/components/Rules";
import { BOARD_ROLES } from "@/data/fixtures";
import { depositFor, formatPaise, tierIndexFor } from "@/lib/rules";

const TIER_LABEL = ["1 to 5 campuses", "6 to 12 campuses", "13 to 23 campuses"];

/**
 * The signature: the reach board. It idles by broadcasting fixture roles in turn; the moment
 * a visitor switches a campus it becomes theirs, and the deposit follows the count (§2).
 */
export function HeroBoard() {
  const rules = useRules();
  const [idx, setIdx] = useState(0);
  const [mine, setMine] = useState<Set<string> | null>(null); // null: the board is broadcasting
  const [auto, setAuto] = useState(true);
  const [canMove, setCanMove] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const visible = useRef(true);

  useEffect(() => { setCanMove(!matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { visible.current = !!e?.isIntersecting; });
    if (host.current) io.observe(host.current);
    return () => io.disconnect();
  }, []);
  // Idle: one clock (GSAP), paused off screen, off under reduced motion and once the visitor takes over.
  useEffect(() => {
    if (!auto || !canMove || mine) return;
    const call = gsap.delayedCall(3.4, function tick() {
      if (visible.current && !document.hidden) setIdx((i) => (i + 1) % BOARD_ROLES.length);
      call.restart(true);
    });
    return () => { call.kill(); };
  }, [auto, canMove, mine]);

  const role = BOARD_ROLES[idx]!;
  const selected = mine ?? new Set(role.reach);
  const count = selected.size;
  const tier = tierIndexFor(rules, count);
  const toggle = (code: string) => {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code); else next.add(code);
    setMine(next);
  };

  return (
    <div ref={host}>
      <Board selected={selected} onToggle={toggle} seq={!mine} label="Campus reach. Switch campuses on or off to see the deposit." />
      <div className="readout">
        <div>
          <p className="meta">{mine ? "Your reach" : "An example role"}</p>
          <p className="readout__role">
            {mine
              ? count ? `${count} of 23 campuses switched on` : "No campuses switched on yet"
              : <>{role.title}, <span style={{ fontWeight: 400 }}>{role.company}</span></>}
          </p>
          <div className="hero__idle" style={{ marginTop: "0.6rem" }}>
            {mine
              ? <button type="button" className="toggle-idle" onClick={() => { setMine(null); setAuto(true); }}>Back to the examples</button>
              : canMove && <button type="button" className="toggle-idle" aria-pressed={!auto} onClick={() => setAuto((a) => !a)}>{auto ? "Pause the board" : "Resume the board"}</button>}
          </div>
        </div>
        <p className="readout__dep">
          <span className="meta">Refundable deposit</span>
          <b className="num">{count ? formatPaise(depositFor(rules, count)) : "₹0"}</b>
        </p>
        <ol className="tiers" aria-label="Deposit tiers by number of campuses">
          {rules.depositTiers.map((t, i) => (
            <li key={t.maxCampuses} className={`tier${i === tier ? " is-on" : ""}`} aria-current={i === tier ? "true" : undefined}>
              <span>{TIER_LABEL[i]}</span><span className="num">{formatPaise(t.amount)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
