"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { gsap } from "gsap";

const SEATS: Record<string, string> = { "": "Zenhyre", login: "Log in" };
const seatOf = (p: string) => p.split("/")[1] ?? "";

/**
 * Global motion, rendered once in the root layout.
 *  - Curtain: moving between the board and the login switches all 24 lamps on, swaps the route,
 *    switches them off. Moving inside a seat never plays it. Back/forward and reduced motion skip it.
 *  - Reveals: [data-reveal] blocks post in when they enter the viewport.
 */
export function Motion() {
  const router = useRouter();
  const pathname = usePathname();
  const root = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const busy = useRef(false);
  const failsafe = useRef<gsap.core.Tween | null>(null);

  const lift = () => {
    const el = root.current;
    if (!el || !busy.current) return;
    failsafe.current?.kill();
    const cells = el.querySelectorAll("i");
    gsap.to(label.current, { autoAlpha: 0, duration: 0.2, overwrite: true });
    gsap.set(cells, { transformOrigin: "100% 50%" });
    gsap.to(cells, {
      scaleX: 0, duration: 0.5, ease: "expo.inOut", stagger: 0.012, delay: 0.1, overwrite: true,
      onComplete: () => { gsap.set(el, { visibility: "hidden" }); busy.current = false; },
    });
  };

  useEffect(() => {
    const el = root.current!;
    const cells = el.querySelectorAll("i");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element).closest?.("a");
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      const to = seatOf(url.pathname);
      if (to === seatOf(location.pathname) || !(to in SEATS) || reduced.matches) return;
      e.preventDefault(); // next/link stands down
      if (busy.current) return;
      busy.current = true;
      const href = url.pathname + url.search + url.hash;
      router.prefetch(href);
      label.current!.textContent = SEATS[to]!;
      gsap.set(el, { visibility: "visible" });
      gsap.set(cells, { transformOrigin: "0% 50%" });
      gsap.fromTo(cells, { scaleX: 0 }, { scaleX: 1.02, duration: 0.42, ease: "expo.out", stagger: 0.014, overwrite: true, onComplete: () => router.push(href) });
      gsap.fromTo(label.current, { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: "expo.out", delay: 0.18, overwrite: true });
      failsafe.current = gsap.delayedCall(5, lift);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    lift();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll("[data-reveal]:not(.is-in)").forEach((n) => io.observe(n));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <div className="curtain" ref={root} aria-hidden="true">
      {Array.from({ length: 24 }, (_, i) => <i key={i} />)}
      <span className="curtain__label" ref={label} />
    </div>
  );
}
