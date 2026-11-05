import { eq } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";
import { Invalid } from "@zenhyre/shared";
import { CONFIG, ConfigKey, ConfigValueOf } from "./defaults";

export function createConfig(db: DbOrTx) {
  return {
    async get<K extends ConfigKey>(key: K): Promise<ConfigValueOf<K>> {
      const [row] = await db.select().from(schema.configValue).where(eq(schema.configValue.key, key));
      const entry = CONFIG[key];
      if (!row) return entry.default as ConfigValueOf<K>;
      const parsed = entry.schema.safeParse(row.value);
      return (parsed.success ? parsed.data : entry.default) as ConfigValueOf<K>;
    },
    async set<K extends ConfigKey>(key: K, value: ConfigValueOf<K>, updatedBy: string): Promise<void> {
      const parsed = CONFIG[key].schema.safeParse(value);
      if (!parsed.success) throw new Invalid(`invalid value for ${key}: ${parsed.error.message}`);
      await db.insert(schema.configValue)
        .values({ key, value: parsed.data as any, updatedBy })
        .onConflictDoUpdate({ target: schema.configValue.key, set: { value: parsed.data as any, updatedBy, updatedAt: new Date() } });
    },
    keys(): ConfigKey[] { return Object.keys(CONFIG) as ConfigKey[]; },
  };
}
export type Config = ReturnType<typeof createConfig>;
