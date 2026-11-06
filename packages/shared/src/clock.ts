export interface Clock { now(): Date }
export const systemClock: Clock = { now: () => new Date() };
export function fixedClock(iso: string): Clock {
  const d = new Date(iso);
  return { now: () => new Date(d) };
}
/** A clock tests can move: `set` jumps to an instant, `advance` moves forward by milliseconds. */
export interface MutableClock extends Clock { set(iso: string | Date): void; advance(ms: number): void }
export function mutableClock(iso: string): MutableClock {
  let t = new Date(iso).getTime();
  return { now: () => new Date(t), set: (v) => { t = new Date(v).getTime(); }, advance: (ms) => { t += ms; } };
}
