import { Clock } from "@zenhyre/shared";

/**
 * A fixed-window counter per key, in process memory. Enough for one API instance; move it to Postgres or Redis
 * before running more than one.
 */
export function rateLimiter(clock: Clock, limit: number, windowMs: number) {
  const hits = new Map<string, { start: number; count: number }>();
  return {
    /** True if this call is allowed (and counts it). */
    take(key: string): boolean {
      const now = clock.now().getTime();
      const h = hits.get(key);
      if (!h || now - h.start >= windowMs) {
        hits.set(key, { start: now, count: 1 });
        if (hits.size > 50_000) for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
        return true;
      }
      if (h.count >= limit) return false;
      h.count++;
      return true;
    },
  };
}
