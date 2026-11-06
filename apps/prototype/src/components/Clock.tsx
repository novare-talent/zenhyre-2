"use client";
import { useSyncExternalStore } from "react";
import { DAY, HOUR } from "@/data/fixtures";

// One shared second-tick for every countdown. Fixture deadlines are offsets from first load.
let t0: number | null = null;
let now = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const subs = new Set<() => void>();
function subscribe(fn: () => void) {
  if (t0 === null) { t0 = Date.now(); now = t0; }
  subs.add(fn);
  if (!timer) timer = setInterval(() => { now = Date.now(); subs.forEach((f) => f()); }, 1000);
  return () => { subs.delete(fn); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
}
/** Milliseconds elapsed since the prototype loaded, or null on the server and first paint. */
export function useElapsed(): number | null {
  return useSyncExternalStore(subscribe, () => (t0 === null ? null : now - t0), () => null);
}

const two = (n: number) => String(n).padStart(2, "0");

/** Time left on a broadcast window. The server render reserves the minutes and seconds so nothing shifts on hydration. */
export function Countdown({ ms, prefix = "Closes in" }: { ms: number; prefix?: string }) {
  const elapsed = useElapsed();
  const left = Math.max(0, ms - (elapsed ?? 0));
  const d = Math.floor(left / DAY), h = Math.floor((left % DAY) / HOUR), m = Math.floor((left % HOUR) / 60_000), s = Math.floor((left % 60_000) / 1000);
  return (
    <span className="count-down">
      {prefix} {d}d {two(h)}h<span className="mono count-down__fine"> {elapsed === null ? "--" : two(m)}m {elapsed === null ? "--" : two(s)}s</span>
    </span>
  );
}
