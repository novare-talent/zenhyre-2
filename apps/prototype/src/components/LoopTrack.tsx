"use client";
import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/** The role lifecycle (§5) as eight lamps on one track. Scrolling switches them on in order. */
export function LoopTrack({ stops }: { stops: { name: string; rule: string }[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const els = [...ref.current!.querySelectorAll(".track__stop")];
    const st = ScrollTrigger.create({
      trigger: ref.current, start: "top 82%", end: "bottom 55%",
      onUpdate: (s) => { const n = Math.max(1, Math.ceil(s.progress * els.length)); els.forEach((el, i) => el.classList.toggle("is-on", i < n)); },
    });
    return () => st.kill();
  }, []);
  return (
    <ol className="track track--scroll" ref={ref}>
      {stops.map((s, i) => (
        <li key={s.name} className="track__stop">
          <span className="track__lamp" aria-hidden="true" />
          <span className="track__n num">{String(i + 1).padStart(2, "0")}</span>
          <h3 className="track__name">{s.name}</h3>
          <p className="track__rule">{s.rule}</p>
        </li>
      ))}
    </ol>
  );
}
