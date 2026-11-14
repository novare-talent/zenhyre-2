import { sql } from "@zenhyre/db/orm";
import type { Db } from "@zenhyre/db";
import { Clock } from "@zenhyre/shared";

/**
 * A fixed-window counter per key, kept in Postgres (`zenhyre2.rate_limit`) so every API instance, serverless ones
 * included, shares it. One atomic upsert per call: a new window resets the count, otherwise it increments.
 */
export function rateLimiter(db: Db, clock: Clock, scope: string, limit: number, windowMs: number) {
  return {
    /** True if this call is allowed (and counts it). */
    async take(key: string): Promise<boolean> {
      // ISO strings with explicit casts: the driver does not bind JS Dates in raw SQL.
      const now = clock.now().toISOString();
      const cutoff = new Date(clock.now().getTime() - windowMs).toISOString();
      const rows = await db.execute(sql`
        insert into zenhyre2.rate_limit (key, window_start, count) values (${`${scope}:${key}`}, ${now}::timestamptz, 1)
        on conflict (key) do update set
          count = case when zenhyre2.rate_limit.window_start <= ${cutoff}::timestamptz then 1 else zenhyre2.rate_limit.count + 1 end,
          window_start = case when zenhyre2.rate_limit.window_start <= ${cutoff}::timestamptz then ${now}::timestamptz else zenhyre2.rate_limit.window_start end
        returning count`);
      return Number((rows as unknown as { count: number }[])[0]?.count ?? 1) <= limit;
    },
  };
}
