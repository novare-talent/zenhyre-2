import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, DB_SCHEMA } from "./index";
const { db, close } = createDb();
await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)), migrationsSchema: DB_SCHEMA });
await close();
console.log("migrated");
