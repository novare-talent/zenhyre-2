"use client";
import { useSyncExternalStore } from "react";

// One shared second-tick for every countdown.
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const subs = new Set<() => void>();
function subscribe(fn: () => void) {
  subs.add(fn);
  if (!timer) timer = setInterval(() => { now = Date.now(); subs.forEach((f) => f()); }, 1000);
  return () => { subs.delete(fn); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
}
/** The current time, ticking once a second on the client; null on the server and before hydration. */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, () => now, () => null);
}

const two = (n: number) => String(n).padStart(2, "0");
const DAY = 86_400_000, HOUR = 3_600_000;

/** Time left until an instant. The server render reserves the minutes and seconds so nothing shifts on hydration. */
export function Countdown({ until, prefix = "Closes in", done = "Closed" }: { until: string | Date; prefix?: string; done?: string }) {
  const tick = useNow();
  const end = typeof until === "string" ? Date.parse(until) : until.getTime();
  const left = Math.max(0, end - (tick ?? Date.now()));
  if (tick !== null && left === 0) return <span className="count-down">{done}</span>;
  const d = Math.floor(left / DAY), h = Math.floor((left % DAY) / HOUR), m = Math.floor((left % HOUR) / 60_000), s = Math.floor((left % 60_000) / 1000);
  return (
    <span className="count-down" suppressHydrationWarning>
      {prefix} {d}d {two(h)}h<span className="mono count-down__fine"> {tick === null ? "--" : two(m)}m {tick === null ? "--" : two(s)}s</span>
    </span>
  );
}
