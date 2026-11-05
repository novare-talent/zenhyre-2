# Zenhyre 2.0 — Slice 1A: Foundation and Identity Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Zenhyre 2.0 monorepo with a migrated Postgres schema, the `ops` and `identity` modules, magic-link auth, candidate and company onboarding, the `notify` module, and a Hono API exposing them — all tested against a real Postgres.

**Architecture:** pnpm + Turborepo monorepo. `packages/db` owns the Drizzle schema and migrations for every table in spec §4 (except embeddings, which arrive with pgvector in Plan 1B). Each domain package exposes a typed interface over its own tables and takes a `Db` handle so workflows can run several modules in one transaction. `services/api` wires modules into Hono routes. Tests use Vitest against a throwaway Postgres cluster started by `scripts/test-db.sh`.

**Tech Stack:** TypeScript 5, Node 22, pnpm 10, Turborepo, Drizzle ORM + `postgres` driver, Hono, Vitest, Zod, Resend (stubbed in tests).

**Spec:** `docs/superpowers/specs/2026-11-05-zenhyre-2-design.md` (sections cited as §N).

**Out of scope for this plan (Plan 1B/1C):** `roles`, `gate`, `matching`, workflows beyond sign-up/profile, the Next.js apps, pg-boss jobs, embeddings.

---

## Chunk 1: Monorepo, database, shared, ops

### File structure for Chunk 1

```
zenhyre-2/
  package.json                 pnpm workspace root, scripts
  pnpm-workspace.yaml
  turbo.json
  tsconfig.base.json
  vitest.workspace.ts
  .env.example
  scripts/test-db.sh           start/stop a local Postgres 16 cluster for tests
  packages/db/
    package.json
    drizzle.config.ts
    src/index.ts               createDb(), Db type, withTx()
    src/schema/index.ts        re-exports
    src/schema/identity.ts     campus, user, user_email, magic_link_token, session, candidate, company, company_user, association, association_admin
    src/schema/roles.ts        role, role_event, role_gate_decision, referral, referral_attribution
    src/schema/matching.ts     match, match_event
    src/schema/ledger.ts       ledger_entry
    src/schema/trust.ts        trust_event, trust_score
    src/schema/ops.ts          review_item, config_value, staff_action
    src/schema/notify.ts       notification
    src/test/setup.ts          per-test-file DB reset helper
    drizzle/                   generated migrations
  packages/shared/
    package.json
    src/index.ts
    src/money.ts               paise helpers
    src/errors.ts              DomainError, NotFound, Forbidden, Invalid
    src/clock.ts               injectable clock
  packages/ops/
    package.json
    src/index.ts               createOps(db)
    src/config.ts              config.get/set with defaults from spec §17
    src/defaults.ts            CONFIG_DEFAULTS
    src/review.ts              openReview/resolveReview/listReviews
    src/audit.ts               audit()
    test/config.test.ts
    test/review.test.ts
```

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `vitest.workspace.ts`, `.gitignore`, `.env.example`

- [ ] **Step 1: Root package.json**

```json
{
  "name": "zenhyre-2",
  "private": true,
  "packageManager": "pnpm@10.28.0",
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "db:generate": "pnpm --filter @zenhyre/db generate",
    "db:migrate": "pnpm --filter @zenhyre/db migrate",
    "test:db:start": "bash scripts/test-db.sh start",
    "test:db:stop": "bash scripts/test-db.sh stop"
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: Workspace, turbo, tsconfig, vitest**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "services/*"
  - "apps/*"
```

`turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"], "env": ["DATABASE_URL"] }
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true
  }
}
```

`vitest.workspace.ts`:
```ts
export default ["packages/*/vitest.config.ts", "services/*/vitest.config.ts"];
```

Module resolution note: `Bundler` resolution lets source use extensionless relative imports. `tsc` emits them unchanged, so compiled `dist/` is consumed by other workspace packages through vitest/tsx (which resolve extensionless ESM), and the API runs under `tsx` in dev and prod for this slice. Plan 1B adds `tsup` bundling for a Node-native production build.

`.gitignore`:
```
node_modules
dist
.turbo
.env
.test-pg
```

`.env.example`:
```
DATABASE_URL=postgres://zenhyre:zenhyre@localhost:5433/zenhyre
RESEND_API_KEY=
APP_BASE_URL=http://localhost:3000
```

- [ ] **Step 3: Install and verify**

Run: `cd /home/claude/zenhyre-2 && pnpm install`
Expected: lockfile created, no errors.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: monorepo scaffold"
```

### Task 2: Test database script

**Files:**
- Create: `scripts/test-db.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# Starts/stops a throwaway Postgres 16 cluster on port 5433 for tests.
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DIR="$(cd "$(dirname "$0")/.." && pwd)/.test-pg"
PORT=5433
case "${1:-}" in
  start)
    if [ ! -d "$DIR" ]; then
      "$PGBIN/initdb" -D "$DIR" -U zenhyre --auth=trust -q
      echo "port = $PORT" >> "$DIR/postgresql.conf"
      echo "unix_socket_directories = '$DIR'" >> "$DIR/postgresql.conf"
    fi
    "$PGBIN/pg_ctl" -D "$DIR" -l "$DIR/log" -w start
    "$PGBIN/psql" -h localhost -p $PORT -U zenhyre -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='zenhyre'" | grep -q 1 \
      || "$PGBIN/createdb" -h localhost -p $PORT -U zenhyre zenhyre
    echo "DATABASE_URL=postgres://zenhyre:zenhyre@localhost:$PORT/zenhyre"
    ;;
  stop)
    "$PGBIN/pg_ctl" -D "$DIR" -w stop || true
    ;;
  *) echo "usage: $0 start|stop"; exit 1;;
esac
```

- [ ] **Step 2: Run it**

Run: `chmod +x scripts/test-db.sh && pnpm test:db:start`
Expected: last line `DATABASE_URL=postgres://zenhyre:zenhyre@localhost:5433/zenhyre`.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-db.sh && git commit -m "chore: local test postgres script"
```

### Task 3: `packages/shared`

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`, `packages/shared/src/index.ts`, `packages/shared/src/money.ts`, `packages/shared/src/errors.ts`, `packages/shared/src/clock.ts`
- Test: `packages/shared/test/money.test.ts`

- [ ] **Step 1: Package files**

`packages/shared/package.json`:
```json
{
  "name": "@zenhyre/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^3.23.0" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.1.0" }
}
```

`packages/shared/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "rootDir": "src" }, "include": ["src"] }
```

`packages/shared/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

- [ ] **Step 2: Failing test for money helpers**

`packages/shared/test/money.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { rupees, formatPaise, percentOf } from "../src/money";

describe("money", () => {
  it("converts rupees to paise", () => {
    expect(rupees(15000)).toBe(1500000);
  });
  it("formats paise as ₹ with Indian grouping", () => {
    expect(formatPaise(1500000)).toBe("₹15,000");
    expect(formatPaise(120000000)).toBe("₹12,00,000");
  });
  it("takes a percentage and rounds to the nearest paisa", () => {
    expect(percentOf(120000000, 0.1)).toBe(12000000);
    expect(percentOf(333, 0.1)).toBe(33);
  });
});
```

- [ ] **Step 3: Run to see it fail**

Run: `pnpm --filter @zenhyre/shared test`
Expected: FAIL, cannot find module `../src/money`.

- [ ] **Step 4: Implement**

`packages/shared/src/money.ts`:
```ts
/** All money in the system is integer paise. */
export type Paise = number;

export function rupees(r: number): Paise {
  return Math.round(r * 100);
}

export function percentOf(amount: Paise, rate: number): Paise {
  return Math.round(amount * rate);
}

export function formatPaise(p: Paise): string {
  const r = Math.round(p / 100);
  return "₹" + new Intl.NumberFormat("en-IN").format(r);
}
```

`packages/shared/src/errors.ts`:
```ts
export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = "DomainError";
  }
}
export class NotFound extends DomainError {
  constructor(what: string) { super("not_found", `${what} not found`, 404); }
}
export class Forbidden extends DomainError {
  constructor(msg = "forbidden") { super("forbidden", msg, 403); }
}
export class Invalid extends DomainError {
  constructor(msg: string) { super("invalid", msg, 400); }
}
export class IllegalTransition extends DomainError {
  constructor(from: string, to: string) { super("illegal_transition", `${from} -> ${to}`, 409); }
}
```

`packages/shared/src/clock.ts`:
```ts
export interface Clock { now(): Date }
export const systemClock: Clock = { now: () => new Date() };
export function fixedClock(iso: string): Clock {
  const d = new Date(iso);
  return { now: () => new Date(d) };
}
```

`packages/shared/src/index.ts`:
```ts
export * from "./money";
export * from "./errors";
export * from "./clock";
```

- [ ] **Step 5: Run tests**

Run: `pnpm install && pnpm --filter @zenhyre/shared test`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/shared && git commit -m "feat(shared): money, errors, clock"
```

### Task 4: `packages/db` — client and schema (identity + ops)

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/vitest.config.ts`, `packages/db/drizzle.config.ts`, `packages/db/src/index.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/schema/identity.ts`, `packages/db/src/schema/ops.ts`, `packages/db/src/schema/notify.ts`, `packages/db/src/test/setup.ts`
- Test: `packages/db/test/schema.test.ts`

- [ ] **Step 1: Package files**

`packages/db/package.json`:
```json
{
  "name": "@zenhyre/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./schema": "./dist/schema/index.js",
    "./test": "./dist/test/setup.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "generate": "drizzle-kit generate",
    "migrate": "tsx src/migrate.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.0",
    "@zenhyre/shared": "workspace:*"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/db/tsconfig.json`: same shape as shared.
`packages/db/vitest.config.ts`: same as shared.

`packages/db/drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 2: Identity schema** (§4.1 plus auth tables)

`packages/db/src/schema/identity.ts`:
```ts
import { pgTable, uuid, text, timestamp, boolean, integer, date, jsonb, numeric, uniqueIndex, pgEnum } from "drizzle-orm/pg-core";

export const candidateStatus = pgEnum("candidate_status", ["student", "final_year", "alumnus"]);
export const verificationState = pgEnum("verification_state", ["verified", "referral_pending", "verification_pending", "rejected"]);
export const verificationSource = pgEnum("verification_source", ["campus_email", "referral", "association", "staff"]);
export const trustStatus = pgEnum("trust_status", ["ok", "restricted", "blocked"]);
export const companyStatus = pgEnum("company_status", ["active", "probation", "banned"]);
export const companyUserRole = pgEnum("company_user_role", ["owner", "member"]);
export const payoutMode = pgEnum("payout_mode", ["cash", "sponsorship_credit"]);

export const campus = pgTable("campus", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  shortCode: text("short_code").notNull().unique(),
  emailDomains: text("email_domains").array().notNull(),
  rollNumberRegex: text("roll_number_regex"),
  internalTier: integer("internal_tier").notNull().default(3),
});

export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  isStaff: boolean("is_staff").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userEmail = pgTable("user_email", {
  userId: uuid("user_id").notNull().references(() => user.id),
  email: text("email").primaryKey(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  isPrimary: boolean("is_primary").notNull().default(false),
  campusId: uuid("campus_id").references(() => campus.id),
  bounceCount: integer("bounce_count").notNull().default(0),
});

export const magicLinkToken = pgTable("magic_link_token", {
  token: text("token").primaryKey(),
  email: text("email").notNull(),
  purpose: text("purpose").notNull(), // "signin" | "company_invite" | "association_admin_invite"
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => user.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const candidate = pgTable("candidate", {
  userId: uuid("user_id").primaryKey().references(() => user.id),
  campusId: uuid("campus_id").notNull().references(() => campus.id),
  gradDate: date("grad_date").notNull(),
  course: text("course").notNull(),
  rollNumber: text("roll_number"),
  rollNumberFlag: boolean("roll_number_flag").notNull().default(false),
  status: candidateStatus("status").notNull(),
  verificationState: verificationState("verification_state").notNull(),
  verificationAttempts: integer("verification_attempts").notNull().default(0),
  verificationSource: verificationSource("verification_source").notNull(),
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  openToOpportunities: boolean("open_to_opportunities").notNull().default(true),
  trustStatus: trustStatus("trust_status").notNull().default("ok"),
  profile: jsonb("profile").$type<CandidateProfile>().notNull().default({}),
  embeddingUpdatedAt: timestamp("embedding_updated_at", { withTimezone: true }),
  nameVisibleToAssociation: boolean("name_visible_to_association").notNull().default(false),
});

export interface CandidateProfile {
  headline?: string;
  skills?: string[];
  years_experience?: number;
  current_company?: string;
  current_title?: string;
  preferred_roles?: string[];
  preferred_locations?: string[];
  notice_period_days?: number;
  current_ctc?: number;
  linkedin_url?: string;
  cv_url?: string;
  parsed_cv?: Record<string, unknown>;
  /** alumni direct request: what the candidate claimed at sign-up, shown in the verification queue */
  claimed?: { batch: string; branch: string; linkedinUrl: string };
}

export const company = pgTable("company", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  verifiedDomain: text("verified_domain").notNull(),
  status: companyStatus("status").notNull().default("active"),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const companyUser = pgTable("company_user", {
  userId: uuid("user_id").notNull().references(() => user.id),
  companyId: uuid("company_id").notNull().references(() => company.id),
  role: companyUserRole("role").notNull(),
  invitedBy: uuid("invited_by"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
}, (t) => [uniqueIndex("company_user_pk").on(t.userId, t.companyId)]);

export const association = pgTable("association", {
  id: uuid("id").primaryKey().defaultRandom(),
  campusId: uuid("campus_id").notNull().references(() => campus.id).unique(),
  name: text("name").notNull(),
  contacts: jsonb("contacts").$type<Record<string, unknown>>().notNull().default({}),
  shareRate: numeric("share_rate", { precision: 5, scale: 4 }).notNull().default("0.1500"),
  payoutMode: payoutMode("payout_mode").notNull().default("cash"),
  mouSignedAt: timestamp("mou_signed_at", { withTimezone: true }),
});

export const associationAdmin = pgTable("association_admin", {
  userId: uuid("user_id").notNull().references(() => user.id),
  associationId: uuid("association_id").notNull().references(() => association.id),
  invitedBy: uuid("invited_by"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("association_admin_pk").on(t.userId, t.associationId)]);
```

- [ ] **Step 3: Ops and notify schema** (§4.6)

`packages/db/src/schema/ops.ts`:
```ts
import { pgTable, uuid, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";

export const reviewKind = pgEnum("review_kind", ["gate", "verification", "leakage", "join_dispute", "deposit_resolution", "candidate_approval", "alert"]);

export const reviewItem = pgTable("review_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: reviewKind("kind").notNull(),
  refType: text("ref_type").notNull(),
  refId: text("ref_id").notNull(),
  associationId: uuid("association_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by"),
  resolution: text("resolution"),
});

export const configValue = pgTable("config_value", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const staffAction = pgTable("staff_action", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id").notNull(),
  action: text("action").notNull(),
  refType: text("ref_type").notNull(),
  refId: text("ref_id").notNull(),
  note: text("note"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});
```

`packages/db/src/schema/notify.ts`:
```ts
import { pgTable, uuid, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
export const notifyChannel = pgEnum("notify_channel", ["email", "in_app"]);
export const notification = pgTable("notification", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  template: text("template").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  channel: notifyChannel("channel").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  bounceReason: text("bounce_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

`packages/db/src/schema/index.ts`:
```ts
export * from "./identity";
export * from "./ops";
export * from "./notify";
```

(Roles, matching, ledger, trust schema files are added in Plan 1B/2/3 as those modules land.)

- [ ] **Step 4: Client, migrate script, test setup**

`packages/db/src/index.ts`:
```ts
import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(url = process.env.DATABASE_URL!): { db: Db; close: () => Promise<void> } {
  const client = postgres(url, { max: 10 });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

export { schema };
```

`packages/db/src/migrate.ts`:
```ts
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./index";
const { db, close } = createDb();
await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
await close();
console.log("migrated");
```

`packages/db/src/test/setup.ts`:
```ts
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, Db } from "../index";

/** Creates a fresh schema per test file so files can run in parallel. */
export async function testDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const name = "t_" + Math.random().toString(36).slice(2, 10);
  const base = createDb();
  await base.db.execute(sql.raw(`CREATE SCHEMA ${name}`));
  await base.close();
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${name}`);
  const { db, close } = createDb(url.toString());
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname, migrationsSchema: name });
  return {
    db,
    close: async () => {
      await db.execute(sql.raw(`DROP SCHEMA ${name} CASCADE`));
      await close();
    },
  };
}
```

- [ ] **Step 5: Generate the migration**

Run: `pnpm install && export DATABASE_URL=postgres://zenhyre:zenhyre@localhost:5433/zenhyre && pnpm db:generate`
Expected: `packages/db/drizzle/0000_*.sql` created containing `CREATE TABLE "campus"` etc.

- [ ] **Step 6: Failing schema smoke test**

`packages/db/test/schema.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "../src/test/setup";
import { schema, Db } from "../src/index";

let db: Db, close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(() => close());

describe("schema", () => {
  it("inserts a campus and a user with an email", async () => {
    const [c] = await db.insert(schema.campus).values({ name: "IIT Bombay", shortCode: "IITB", emailDomains: ["iitb.ac.in"] }).returning();
    const [u] = await db.insert(schema.user).values({}).returning();
    await db.insert(schema.userEmail).values({ userId: u!.id, email: "a@iitb.ac.in", campusId: c!.id });
    const rows = await db.select().from(schema.userEmail);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.campusId).toBe(c!.id);
  });
});
```

- [ ] **Step 7: Run test**

Run: `pnpm --filter @zenhyre/db test`
Expected: 1 passed. (If it fails on `migrationsSchema`, the drizzle version lacks it: fall back to creating a new database per file with `CREATE DATABASE` instead of a schema.)

- [ ] **Step 8: Commit**

```bash
git add packages/db && git commit -m "feat(db): drizzle client, identity/ops/notify schema, first migration, test harness"
```

### Task 5: `packages/ops` — config

**Files:**
- Create: `packages/ops/package.json`, `packages/ops/tsconfig.json`, `packages/ops/vitest.config.ts`, `packages/ops/src/index.ts`, `packages/ops/src/defaults.ts`, `packages/ops/src/config.ts`
- Test: `packages/ops/test/config.test.ts`

- [ ] **Step 1: Package files** — as for `shared`, name `@zenhyre/ops`, dependencies `@zenhyre/db`, `@zenhyre/shared`, `drizzle-orm`, `zod`.

- [ ] **Step 2: Failing test**

`packages/ops/test/config.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "@zenhyre/db/test";
import { createOps } from "../src/index";

let db: any, close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(() => close());

describe("config", () => {
  it("returns spec defaults when nothing is stored", async () => {
    const ops = createOps(db);
    expect(await ops.config.get("match.broadcast_days")).toBe(10);
    expect(await ops.config.get("deposit.tiers")).toEqual([
      { max_campuses: 5, amount: 1500000 },
      { max_campuses: 12, amount: 3000000 },
      { max_campuses: 23, amount: 6000000 },
    ]);
  });
  it("stores an override and reads it back", async () => {
    const ops = createOps(db);
    await ops.config.set("match.broadcast_days", 14, "staff-1");
    expect(await ops.config.get("match.broadcast_days")).toBe(14);
  });
  it("rejects a value that fails the key's schema", async () => {
    const ops = createOps(db);
    await expect(ops.config.set("match.broadcast_days", "soon" as any, "staff-1")).rejects.toThrow(/invalid/i);
  });
});
```

- [ ] **Step 3: Run to see it fail**

Run: `pnpm --filter @zenhyre/ops test`
Expected: FAIL, `createOps` not found.

- [ ] **Step 4: Implement defaults and config**

`packages/ops/src/defaults.ts` (every key in spec §17, with its Zod schema):
```ts
import { z } from "zod";

const tier = z.object({ max_campuses: z.number().int().positive(), amount: z.number().int().positive() });

export const CONFIG = {
  "deposit.tiers": { schema: z.array(tier), default: [
    { max_campuses: 5, amount: 1500000 }, { max_campuses: 12, amount: 3000000 }, { max_campuses: 23, amount: 6000000 }] },
  "deposit.probation_multiplier": { schema: z.number().positive(), default: 2 },
  "deposit.engaged_threshold": { schema: z.number().min(0).max(1), default: 0.5 },
  "deposit.dark_days": { schema: z.number().int().positive(), default: 30 },
  "deposit.refund_sla_days": { schema: z.number().int().positive(), default: 7 },
  "deposit.stuck_alert_hours": { schema: z.number().int().positive(), default: 24 },
  "fee.intern_flat": { schema: z.number().int().nonnegative(), default: 1250000 },
  "fee.percent_default": { schema: z.number().min(0).max(1), default: 0.10 },
  "fee.percent_senior": { schema: z.number().min(0).max(1), default: 0.20 },
  "fee.senior_years": { schema: z.number().int().nonnegative(), default: 10 },
  "fee.replacement_days": { schema: z.number().int().nonnegative(), default: 90 },
  "fee.due_days_after_join": { schema: z.number().int().positive(), default: 30 },
  "fee.reminder_days_before_due": { schema: z.number().int().positive(), default: 7 },
  "fee.join_grace_days": { schema: z.number().int().positive(), default: 7 },
  "fee.join_dispute_days": { schema: z.number().int().positive(), default: 3 },
  "gate.blocklist": { schema: z.array(z.string()), default: ["field sales", "bpo", "data entry", "unpaid"] },
  "gate.min_ctc": { schema: z.object({ intern: z.number().int(), fresher: z.number().int(), experienced: z.number().int() }),
    default: { intern: 24000000, fresher: 60000000, experienced: 100000000 } },
  "gate.accept_threshold": { schema: z.number().int(), default: 70 },
  "gate.reject_threshold": { schema: z.number().int(), default: 40 },
  "gate.terms_auto_release_hours": { schema: z.number().int().positive(), default: 48 },
  "gate.terms_timeout_days": { schema: z.number().int().positive(), default: 14 },
  "gate.appeal_window_days": { schema: z.number().int().positive(), default: 14 },
  "match.broadcast_days": { schema: z.number().int().positive(), default: 10 },
  "match.extension_days": { schema: z.number().int().positive(), default: 7 },
  "match.extension_min_applicants": { schema: z.number().int().positive(), default: 10 },
  "match.shortlist_cap": { schema: z.number().int().positive(), default: 25 },
  "match.nudge_cap": { schema: z.number().int().positive(), default: 150 },
  "match.rerank_pool": { schema: z.number().int().positive(), default: 200 },
  "trust.company.probation": { schema: z.number().int(), default: 70 },
  "trust.company.ban": { schema: z.number().int(), default: 40 },
  "trust.company.probation_lift": { schema: z.number().int(), default: 75 },
  "trust.company.lift_days": { schema: z.number().int(), default: 30 },
  "trust.candidate.restricted": { schema: z.number().int(), default: 60 },
  "trust.candidate.blocked": { schema: z.number().int(), default: 30 },
  "trust.candidate.restricted_lift": { schema: z.number().int(), default: 65 },
  "trust.candidate.blocked_lift": { schema: z.number().int(), default: 35 },
  "trust.decay_months": { schema: z.number().int().positive(), default: 12 },
  "trust.prompt_action_days": { schema: z.number().int().positive(), default: 7 },
  "trust.overdue_days": { schema: z.number().int().positive(), default: 30 },
  "trust.self_report_days": { schema: z.array(z.number().int()), default: [30, 90] },
  "trust.leakage_lookback_months": { schema: z.number().int().positive(), default: 12 },
  "identity.freemail_domains": { schema: z.array(z.string()),
    default: ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "proton.me", "rediffmail.com"] },
  "identity.escape_hatch_days": { schema: z.number().int().positive(), default: 7 },
  "identity.max_verification_attempts": { schema: z.number().int().positive(), default: 2 },
  "identity.final_year_months_before_grad": { schema: z.number().int().positive(), default: 12 },
  "identity.grad_nudge_days": { schema: z.array(z.number().int()), default: [-60, 30] },
} as const;

export type ConfigKey = keyof typeof CONFIG;
export type ConfigValueOf<K extends ConfigKey> = z.infer<(typeof CONFIG)[K]["schema"]>;
```

`packages/ops/src/config.ts`:
```ts
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
```

`packages/ops/src/index.ts` (review and audit added in Task 6):
```ts
import { DbOrTx } from "@zenhyre/db";
import { createConfig } from "./config";
export * from "./defaults";
export function createOps(db: DbOrTx) {
  return { config: createConfig(db) };
}
export type Ops = ReturnType<typeof createOps>;
```

- [ ] **Step 5: Run tests**

Run: `pnpm install && pnpm --filter @zenhyre/db build && pnpm --filter @zenhyre/ops test`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/ops && git commit -m "feat(ops): config with spec defaults and validation"
```

### Task 6: `packages/ops` — review items and audit

**Files:**
- Create: `packages/ops/src/review.ts`, `packages/ops/src/audit.ts`
- Modify: `packages/ops/src/index.ts`
- Test: `packages/ops/test/review.test.ts`

- [ ] **Step 1: Failing test**

`packages/ops/test/review.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "@zenhyre/db/test";
import { createOps } from "../src/index";

let db: any, close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(() => close());

describe("review items", () => {
  it("opens, lists by kind, and resolves", async () => {
    const ops = createOps(db);
    const item = await ops.openReview({ kind: "verification", refType: "candidate", refId: "c1", associationId: null, payload: { name: "A" } });
    expect(item.resolvedAt).toBeNull();
    const open = await ops.listReviews({ kind: "verification", open: true });
    expect(open.map((i) => i.id)).toEqual([item.id]);
    await ops.resolveReview(item.id, "staff-1", "approved");
    expect(await ops.listReviews({ kind: "verification", open: true })).toEqual([]);
  });
  it("is idempotent for the same open kind+ref", async () => {
    const ops = createOps(db);
    const a = await ops.openReview({ kind: "alert", refType: "role", refId: "r9", associationId: null, payload: {} });
    const b = await ops.openReview({ kind: "alert", refType: "role", refId: "r9", associationId: null, payload: {} });
    expect(b.id).toBe(a.id);
  });
  it("scopes verification items to an association and ages them into the staff queue", async () => {
    const ops = createOps(db);
    const assoc = "11111111-1111-1111-1111-111111111111";
    await ops.openReview({ kind: "verification", refType: "candidate", refId: "c2", associationId: assoc, payload: {} });
    expect((await ops.listReviews({ kind: "verification", open: true, associationId: assoc })).length).toBe(1);
    expect((await ops.listReviews({ kind: "verification", open: true, staffQueue: true, escapeHatchDays: 7 })).length).toBe(0);
    expect((await ops.listReviews({ kind: "verification", open: true, staffQueue: true, escapeHatchDays: 0 })).length).toBe(1);
  });
  it("records staff actions", async () => {
    const ops = createOps(db);
    await ops.audit("22222222-2222-2222-2222-222222222222", "config.set", "config", "match.broadcast_days", "bumped");
    const rows = await ops.listAudit({ refType: "config" });
    expect(rows[0]!.action).toBe("config.set");
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @zenhyre/ops test`
Expected: FAIL, `openReview` is not a function.

- [ ] **Step 3: Implement**

`packages/ops/src/review.ts`:
```ts
import { and, eq, isNull, lte, or, desc, sql } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";

type Kind = (typeof schema.reviewKind.enumValues)[number];

export interface OpenReviewInput {
  kind: Kind; refType: string; refId: string; associationId: string | null; payload: Record<string, unknown>;
}
export interface ListReviewsFilter {
  kind?: Kind; open?: boolean; associationId?: string;
  /** staff queue: unscoped items plus scoped items older than escapeHatchDays */
  staffQueue?: boolean; escapeHatchDays?: number;
}

export function createReview(db: DbOrTx) {
  return {
    async openReview(input: OpenReviewInput) {
      const [existing] = await db.select().from(schema.reviewItem).where(and(
        eq(schema.reviewItem.kind, input.kind), eq(schema.reviewItem.refType, input.refType),
        eq(schema.reviewItem.refId, input.refId), isNull(schema.reviewItem.resolvedAt)));
      if (existing) return existing;
      const [row] = await db.insert(schema.reviewItem).values(input).returning();
      return row!;
    },
    async resolveReview(id: string, resolvedBy: string, resolution: string) {
      const [row] = await db.update(schema.reviewItem)
        .set({ resolvedAt: new Date(), resolvedBy, resolution })
        .where(and(eq(schema.reviewItem.id, id), isNull(schema.reviewItem.resolvedAt))).returning();
      return row ?? null;
    },
    async getReview(id: string) {
      const [row] = await db.select().from(schema.reviewItem).where(eq(schema.reviewItem.id, id));
      return row ?? null;
    },
    async listReviews(f: ListReviewsFilter) {
      const conds = [];
      if (f.kind) conds.push(eq(schema.reviewItem.kind, f.kind));
      if (f.open) conds.push(isNull(schema.reviewItem.resolvedAt));
      if (f.associationId) conds.push(eq(schema.reviewItem.associationId, f.associationId));
      if (f.staffQueue) {
        const days = f.escapeHatchDays ?? 7;
        const cutoff = sql`now() - make_interval(days => ${days})`;
        conds.push(or(isNull(schema.reviewItem.associationId), lte(schema.reviewItem.openedAt, cutoff))!);
      }
      return db.select().from(schema.reviewItem).where(and(...conds)).orderBy(desc(schema.reviewItem.openedAt));
    },
  };
}
```

`packages/ops/src/audit.ts`:
```ts
import { and, desc, eq } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";
export function createAudit(db: DbOrTx) {
  return {
    async audit(actorUserId: string, action: string, refType: string, refId: string, note?: string) {
      await db.insert(schema.staffAction).values({ actorUserId, action, refType, refId, note });
    },
    async listAudit(f: { refType?: string; refId?: string }) {
      const conds = [];
      if (f.refType) conds.push(eq(schema.staffAction.refType, f.refType));
      if (f.refId) conds.push(eq(schema.staffAction.refId, f.refId));
      return db.select().from(schema.staffAction).where(and(...conds)).orderBy(desc(schema.staffAction.at));
    },
  };
}
```

`packages/ops/src/index.ts` (final form; `withDb` lets a workflow rebind the module to a transaction):
```ts
import { DbOrTx } from "@zenhyre/db";
import { createConfig } from "./config";
import { createReview } from "./review";
import { createAudit } from "./audit";
export * from "./defaults";
export * from "./review";

function buildOps(db: DbOrTx) {
  return { config: createConfig(db), ...createReview(db), ...createAudit(db) };
}
export type Ops = ReturnType<typeof buildOps> & { withDb(tx: DbOrTx): Ops };
export function createOps(db: DbOrTx): Ops {
  return { ...buildOps(db), withDb: (tx) => createOps(tx) };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @zenhyre/ops test`
Expected: 7 passed (3 config + 4 review).

- [ ] **Step 5: Commit**

```bash
git add packages/ops && git commit -m "feat(ops): review items with association scoping and escape hatch, staff audit"
```

---

## Chunk 2: Notify and identity

### File structure for Chunk 2

```
packages/notify/
  src/index.ts               createNotify(db, transport)
  src/templates.ts           template registry (subject + text per §11)
  src/transport.ts           Transport interface; ResendTransport; MemoryTransport
  test/notify.test.ts
packages/identity/
  src/index.ts               createIdentity(db, deps)
  src/auth.ts                issueMagicLink, redeemMagicLink, sessions
  src/campus.ts              campusForEmail, seed helper
  src/candidate.ts           createCandidate, status derivation, verify/reject, flags, profile, listMatchableCandidates
  src/company.ts             createCompany, freemail check, invites, lock, merge
  src/association.ts         createAssociation, invite admin
  test/auth.test.ts
  test/candidate.test.ts
  test/company.test.ts
```

(Chunk 3 covers `services/api`.)

```
services/api/   (Chunk 3)
  src/index.ts               server entry (tsx)
  src/app.ts                 buildApp(): Hono app factory, error mapping, route mounting
  src/context.ts             AppConfig/AppDeps: db, ops, identity, notify, clock, baseUrl, webhookSecret
  src/middleware/auth.ts     session cookie → c.var.user; requireUser / requireStaff
  src/routes/auth.ts         POST /auth/magic-link, GET /auth/redeem, POST /auth/signout, GET /me
  src/routes/candidate.ts    POST /candidates, GET/PUT /me/profile, PUT /me/open, POST /me/verification/retry, GET /campuses
  src/routes/company.ts      POST /companies, POST /companies/:id/invites, GET /companies/:id
  src/routes/admin.ts        GET /admin/reviews, POST /admin/reviews/:id/resolve, GET/PUT /admin/config, POST /admin/associations
  src/routes/webhooks.ts     POST /webhooks/resend
  src/workflows/{signUpCandidate,retryVerification,resolveVerification,saveProfile}.ts
  test/{helpers,auth.test,candidate.test,company.test,admin.test,webhooks.test}.ts
```

### Task 7: `packages/notify`

**Files:**
- Create: `packages/notify/package.json` (name `@zenhyre/notify`, deps `@zenhyre/db`, `@zenhyre/shared`, `drizzle-orm`, `resend`), `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/templates.ts`, `src/transport.ts`
- Test: `packages/notify/test/notify.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "@zenhyre/db/test";
import { schema } from "@zenhyre/db";
import { createNotify, MemoryTransport } from "../src/index";

let db: any, close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(() => close());

async function userWithEmails(emails: string[]) {
  const [u] = await db.insert(schema.user).values({}).returning();
  for (const [i, e] of emails.entries())
    await db.insert(schema.userEmail).values({ userId: u.id, email: e, verifiedAt: new Date(), isPrimary: i === 0 });
  return u.id;
}

describe("notify", () => {
  it("sends email to the primary address and records in-app + email rows", async () => {
    const t = new MemoryTransport();
    const notify = createNotify(db, t);
    const uid = await userWithEmails(["p@iitb.ac.in", "q@gmail.com"]);
    await notify.send(uid, "add_personal_email", {});
    expect(t.sent[0]!.to).toBe("p@iitb.ac.in");
    expect(t.sent[0]!.subject).toMatch(/personal email/i);
    const rows = await db.select().from(schema.notification);
    expect(rows.map((r: any) => r.channel).sort()).toEqual(["email", "in_app"]);
  });
  it("sends a template to a bare address with no user (magic links, invites)", async () => {
    const t = new MemoryTransport();
    const notify = createNotify(db, t);
    await notify.sendToEmail("nobody-yet@gmail.com", "magic_link", { url: "http://x/redeem?t=1" });
    expect(t.sent.at(-1)!.to).toBe("nobody-yet@gmail.com");
    expect(t.sent.at(-1)!.subject).toMatch(/sign in/i);
  });
  it("falls back to the next verified email after a bounce and reports undeliverable when all have bounced", async () => {
    const t = new MemoryTransport();
    const notify = createNotify(db, t);
    const uid = await userWithEmails(["dead@iitb.ac.in", "alive@gmail.com"]);
    await notify.recordBounce("dead@iitb.ac.in", "hard bounce");
    await notify.send(uid, "add_personal_email", {});
    expect(t.sent.at(-1)!.to).toBe("alive@gmail.com");
    await notify.recordBounce("alive@gmail.com", "hard bounce");
    const r = await notify.send(uid, "add_personal_email", {});
    expect(r.email).toBe("undeliverable");
  });
  it("does not send email for in-app-only templates", async () => {
    const t = new MemoryTransport();
    const notify = createNotify(db, t);
    const uid = await userWithEmails(["a@iitb.ac.in"]);
    const before = t.sent.length;
    await notify.send(uid, "application_received", { roleTitle: "SDE" });
    expect(t.sent.length).toBe(before);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @zenhyre/notify test` → FAIL, module not found.

- [ ] **Step 3: Implement**

`packages/notify/src/transport.ts`:
```ts
export interface OutgoingEmail { to: string; subject: string; text: string }
export interface Transport { send(mail: OutgoingEmail): Promise<void> }

export class MemoryTransport implements Transport {
  sent: OutgoingEmail[] = [];
  async send(mail: OutgoingEmail) { this.sent.push(mail); }
}

export class ResendTransport implements Transport {
  constructor(private apiKey: string, private from: string) {}
  async send(mail: OutgoingEmail) {
    const { Resend } = await import("resend");
    const r = new Resend(this.apiKey);
    const res = await r.emails.send({ from: this.from, to: mail.to, subject: mail.subject, text: mail.text });
    if (res.error) throw new Error(res.error.message);
  }
}
```

`packages/notify/src/templates.ts` — every template in §11 relevant to Slice 1, with channels:
```ts
export type Channel = "email" | "in_app";
interface Template { channels: Channel[]; subject: (d: any) => string; text: (d: any) => string }

const both: Channel[] = ["email", "in_app"];
export const TEMPLATES = {
  magic_link: { channels: ["email"], subject: () => "Sign in to Zenhyre", text: (d) => `Click to sign in (valid 15 minutes): ${d.url}` },
  company_invite: { channels: ["email"], subject: (d) => `Join ${d.companyName} on Zenhyre`, text: (d) => `${d.inviterName} invited you. Accept: ${d.url}` },
  association_admin_invite: { channels: ["email"], subject: (d) => `Admin access for ${d.associationName} on Zenhyre`, text: (d) => `Accept: ${d.url}` },
  add_personal_email: { channels: both, subject: () => "Add a personal email before you graduate", text: () => "Your campus email will stop working. Add a personal email to keep your Zenhyre account." },
  verification_approved: { channels: both, subject: () => "You're verified on Zenhyre", text: () => "Your alumni status is confirmed. You can now apply to roles." },
  verification_rejected: { channels: both, subject: () => "We couldn't verify your alumni status", text: (d) => `Reason: ${d.reason}. You may request verification once more.` },
  role_nudge: { channels: both, subject: (d) => `A role that fits you: ${d.roleTitle}`, text: (d) => `${d.companyName} is hiring. ${d.url}` },
  application_received: { channels: ["in_app"], subject: (d) => `Applied: ${d.roleTitle}`, text: () => "" },
  stage_changed: { channels: both, subject: (d) => `Update on ${d.roleTitle}`, text: (d) => `Status: ${d.stage}` },
  role_accepted: { channels: both, subject: (d) => `Role accepted: ${d.roleTitle}`, text: () => "Fee terms will follow shortly." },
  role_rejected: { channels: both, subject: (d) => `Role not accepted: ${d.roleTitle}`, text: (d) => `Reason: ${d.reason}. You may appeal once within 14 days.` },
  role_needs_review: { channels: both, subject: (d) => `Role under review: ${d.roleTitle}`, text: () => "Our team is reviewing it." },
  terms_released: { channels: both, subject: (d) => `Fee terms ready: ${d.roleTitle}`, text: (d) => `Review and accept: ${d.url}` },
  terms_expired: { channels: both, subject: (d) => `Role withdrawn: ${d.roleTitle}`, text: () => "Terms were not accepted within 14 days." },
  shortlist_ready: { channels: both, subject: (d) => `Shortlist ready: ${d.roleTitle}`, text: (d) => `${d.count} candidates. ${d.url}` },
  broadcast_extended: { channels: both, subject: (d) => `Broadcast extended: ${d.roleTitle}`, text: (d) => `Now closes ${d.closesAt}.` },
  join_disputed: { channels: both, subject: (d) => `Joining disputed: ${d.candidateName}`, text: () => "The candidate reports they did not join. Respond within 3 days." },
  hire_recorded: { channels: both, subject: (d) => `Hire recorded: ${d.roleTitle}`, text: () => "Thanks. We'll confirm joining with the candidate." },
  role_closed: { channels: both, subject: (d) => `Role closed: ${d.roleTitle}`, text: () => "" },
  replacement_created: { channels: both, subject: (d) => `Replacement search started: ${d.roleTitle}`, text: () => "" },
  staff_alert: { channels: both, subject: (d) => `[alert] ${d.title}`, text: (d) => d.detail ?? "" },
} satisfies Record<string, Template>;
export type TemplateName = keyof typeof TEMPLATES;
```

`packages/notify/src/index.ts`:
```ts
import { and, asc, eq, isNotNull, lt, sql } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";
import { TEMPLATES, TemplateName } from "./templates";
import { Transport } from "./transport";
export * from "./transport";
export * from "./templates";

export interface SendResult { email: "sent" | "skipped" | "undeliverable"; inApp: boolean }

/**
 * Bounce policy (interpretation of §11 chosen for v1): one hard bounce disqualifies an address;
 * when every verified address on the account is disqualified, send() returns "undeliverable"
 * and the caller opens an `alert` ReviewItem.
 */
function buildNotify(db: DbOrTx, transport: Transport) {
  async function deliverableEmail(userId: string): Promise<string | null> {
    const rows = await db.select().from(schema.userEmail)
      .where(and(eq(schema.userEmail.userId, userId), isNotNull(schema.userEmail.verifiedAt), lt(schema.userEmail.bounceCount, 1)))
      .orderBy(asc(schema.userEmail.email));
    const pick = rows.find((r) => r.isPrimary) ?? rows[0];
    return pick?.email ?? null;
  }

  return {
    /** For recipients who may not have a user yet (magic links, invites). Email-only; no notification row. */
    async sendToEmail(email: string, template: TemplateName, data: Record<string, unknown>) {
      const t = TEMPLATES[template];
      await transport.send({ to: email.toLowerCase(), subject: t.subject(data), text: t.text(data) });
    },
    async hasDeliverableEmail(userId: string) { return (await deliverableEmail(userId)) !== null; },
    async send(userId: string, template: TemplateName, data: Record<string, unknown>): Promise<SendResult> {
      const t = TEMPLATES[template];
      const result: SendResult = { email: "skipped", inApp: false };
      if (t.channels.includes("in_app")) {
        await db.insert(schema.notification).values({ userId, template, data, channel: "in_app", sentAt: new Date() });
        result.inApp = true;
      }
      if (t.channels.includes("email")) {
        const to = await deliverableEmail(userId);
        if (!to) {
          await db.insert(schema.notification).values({ userId, template, data, channel: "email", bounceReason: "no deliverable email" });
          result.email = "undeliverable";
        } else {
          await transport.send({ to, subject: t.subject(data), text: t.text(data) });
          await db.insert(schema.notification).values({ userId, template, data, channel: "email", sentAt: new Date() });
          result.email = "sent";
        }
      }
      return result;
    },
    /** Atomic increment; a no-op for addresses we don't know. The reason is recorded on the last email notification row for that user, if any. */
    async recordBounce(email: string, reason: string) {
      const [row] = await db.update(schema.userEmail)
        .set({ bounceCount: sql`${schema.userEmail.bounceCount} + 1` })
        .where(eq(schema.userEmail.email, email.toLowerCase())).returning();
      if (row) {
        await db.execute(sql`update notification set bounce_reason = ${reason}
          where id = (select id from notification where user_id = ${row.userId} and channel = 'email' order by created_at desc limit 1)`);
      }
    },
  };
}
export type Notify = ReturnType<typeof buildNotify> & { withDb(tx: DbOrTx): Notify };
export function createNotify(db: DbOrTx, transport: Transport): Notify {
  return { ...buildNotify(db, transport), withDb: (tx) => createNotify(tx, transport) };
}
```

(The "all emails bouncing → `alert`" rule from §11 is applied by the caller: the API's bounce webhook handler calls `hasDeliverableEmail` after `recordBounce` and opens the alert; that handler is written in Task 12.)

- [ ] **Step 4: Run tests**

Run: `pnpm install && pnpm --filter @zenhyre/db build && pnpm --filter @zenhyre/notify test`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/notify && git commit -m "feat(notify): templates, transports, bounce fallback"
```

### Task 8: `packages/identity` — auth

**Files:**
- Create: `packages/identity/package.json` (name `@zenhyre/identity`, deps `@zenhyre/db`, `@zenhyre/shared`, `drizzle-orm`, `zod`), `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/auth.ts`
- Test: `packages/identity/test/auth.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "@zenhyre/db/test";
import { fixedClock } from "@zenhyre/shared";
import { createIdentity } from "../src/index";

let db: any, close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(() => close());

describe("magic links", () => {
  it("issues a token, redeems it once, creates user + verified email + session", async () => {
    const clock = fixedClock("2026-11-05T10:00:00Z");
    const id = createIdentity(db, { clock });
    const { token } = await id.issueMagicLink("new@gmail.com", "signin", {});
    const r = await id.redeemMagicLink(token);
    expect(r.userId).toBeTruthy();
    expect(r.sessionId).toBeTruthy();
    expect(r.created).toBe(true);
    await expect(id.redeemMagicLink(token)).rejects.toThrow(/used|expired/i);
  });
  it("rejects an expired token", async () => {
    const id = createIdentity(db, { clock: fixedClock("2026-11-05T10:00:00Z") });
    const { token } = await id.issueMagicLink("late@gmail.com", "signin", {});
    const later = createIdentity(db, { clock: fixedClock("2026-11-05T10:16:00Z") });
    await expect(later.redeemMagicLink(token)).rejects.toThrow(/expired/i);
  });
  it("signs an existing user in via a second email on the same account", async () => {
    const id = createIdentity(db, { clock: fixedClock("2026-11-05T10:00:00Z") });
    const first = await id.redeemMagicLink((await id.issueMagicLink("a@iitb.ac.in", "signin", {})).token);
    await id.addEmail(first.userId, "a.personal@gmail.com");
    const second = await id.redeemMagicLink((await id.issueMagicLink("a.personal@gmail.com", "signin", {})).token);
    expect(second.userId).toBe(first.userId);
    expect(second.created).toBe(false);
  });
  it("resolves a session to its user until expiry", async () => {
    const id = createIdentity(db, { clock: fixedClock("2026-11-05T10:00:00Z") });
    const { sessionId, userId } = await id.redeemMagicLink((await id.issueMagicLink("s@gmail.com", "signin", {})).token);
    expect((await id.userForSession(sessionId))?.id).toBe(userId);
    const after = createIdentity(db, { clock: fixedClock("2026-12-20T10:00:00Z") });
    expect(await after.userForSession(sessionId)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see it fail** → FAIL, module not found.

- [ ] **Step 3: Implement**

`packages/identity/src/auth.ts`:
```ts
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";
import { Clock, Invalid } from "@zenhyre/shared";

const LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export type LinkPurpose = "signin" | "company_invite" | "association_admin_invite";

export function createAuth(db: DbOrTx, clock: Clock) {
  async function findUserByEmail(email: string) {
    const [row] = await db.select().from(schema.userEmail).where(eq(schema.userEmail.email, email));
    return row ?? null;
  }
  return {
    async issueMagicLink(email: string, purpose: LinkPurpose, payload: Record<string, unknown>) {
      const token = randomBytes(32).toString("base64url");
      await db.insert(schema.magicLinkToken).values({
        token, email: email.toLowerCase(), purpose, payload, expiresAt: new Date(clock.now().getTime() + LINK_TTL_MS) });
      return { token };
    },
    /** Marks the token used, upserts the user+email, opens a session. Returns payload for invite purposes. */
    async redeemMagicLink(token: string) {
      const [t] = await db.select().from(schema.magicLinkToken).where(eq(schema.magicLinkToken.token, token));
      if (!t) throw new Invalid("unknown link");
      if (t.usedAt) throw new Invalid("link already used");
      if (t.expiresAt.getTime() < clock.now().getTime()) throw new Invalid("link expired");
      await db.update(schema.magicLinkToken).set({ usedAt: clock.now() }).where(eq(schema.magicLinkToken.token, token));

      let created = false;
      let existing = await findUserByEmail(t.email);
      if (!existing) {
        const [u] = await db.insert(schema.user).values({}).returning();
        const [e] = await db.insert(schema.userEmail).values({ userId: u!.id, email: t.email, verifiedAt: clock.now(), isPrimary: true }).returning();
        existing = e!; created = true;
      } else if (!existing.verifiedAt) {
        await db.update(schema.userEmail).set({ verifiedAt: clock.now() }).where(eq(schema.userEmail.email, t.email));
      }
      const sessionId = randomBytes(32).toString("base64url");
      await db.insert(schema.session).values({ id: sessionId, userId: existing.userId, expiresAt: new Date(clock.now().getTime() + SESSION_TTL_MS) });
      return { userId: existing.userId, email: t.email, sessionId, created, purpose: t.purpose as LinkPurpose, payload: t.payload };
    },
    async addEmail(userId: string, email: string) {
      const taken = await findUserByEmail(email.toLowerCase());
      if (taken && taken.userId !== userId) throw new Invalid("email belongs to another account");
      if (!taken) await db.insert(schema.userEmail).values({ userId, email: email.toLowerCase() });
    },
    async emailsFor(userId: string) {
      return db.select().from(schema.userEmail).where(eq(schema.userEmail.userId, userId));
    },
    async userIdForEmail(email: string): Promise<string | null> {
      const r = await findUserByEmail(email.toLowerCase());
      return r?.userId ?? null;
    },
    async userForSession(sessionId: string) {
      const [s] = await db.select().from(schema.session).where(eq(schema.session.id, sessionId));
      if (!s || s.expiresAt.getTime() < clock.now().getTime()) return null;
      const [u] = await db.select().from(schema.user).where(eq(schema.user.id, s.userId));
      return u ?? null;
    },
    async endSession(sessionId: string) {
      await db.delete(schema.session).where(eq(schema.session.id, sessionId));
    },
  };
}
```

`packages/identity/src/index.ts` (interim; Task 10 gives the final form):
```ts
import { DbOrTx } from "@zenhyre/db";
import { Clock, systemClock } from "@zenhyre/shared";
import { createAuth } from "./auth";
export interface IdentityDeps { clock?: Clock }
function buildIdentity(db: DbOrTx, deps: IdentityDeps) {
  return { ...createAuth(db, deps.clock ?? systemClock) };
}
export type Identity = ReturnType<typeof buildIdentity> & { withDb(tx: DbOrTx): Identity };
export function createIdentity(db: DbOrTx, deps: IdentityDeps = {}): Identity {
  return { ...buildIdentity(db, deps), withDb: (tx) => createIdentity(tx, deps) };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm install && pnpm --filter @zenhyre/db build && pnpm --filter @zenhyre/identity test`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/identity && git commit -m "feat(identity): magic-link auth and sessions"
```

### Task 9: `packages/identity` — campus and candidate

**Files:**
- Create: `packages/identity/src/campus.ts`, `packages/identity/src/candidate.ts`
- Modify: `packages/identity/src/index.ts`
- Test: `packages/identity/test/candidate.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "@zenhyre/db/test";
import { fixedClock } from "@zenhyre/shared";
import { createIdentity } from "../src/index";

let db: any, close: () => Promise<void>, id: ReturnType<typeof createIdentity>;
beforeAll(async () => {
  ({ db, close } = await testDb());
  id = createIdentity(db, { clock: fixedClock("2026-11-05T10:00:00Z") });
  await id.seedCampuses([
    { name: "IIT Bombay", shortCode: "IITB", emailDomains: ["iitb.ac.in"], rollNumberRegex: "^\\d{2}[A-Za-z]\\d{4}$", internalTier: 1 },
    { name: "IIT Dharwad", shortCode: "IITDH", emailDomains: ["iitdh.ac.in"], rollNumberRegex: null, internalTier: 3 },
  ]);
});
afterAll(() => close());

async function signedIn(email: string) {
  return id.redeemMagicLink((await id.issueMagicLink(email, "signin", {})).token);
}

describe("candidate via campus email", () => {
  it("creates a verified candidate with campus from the email domain and status from grad_date", async () => {
    const { userId } = await signedIn("22b1234@iitb.ac.in");
    const c = await id.createCandidate({ userId, email: "22b1234@iitb.ac.in", gradDate: "2027-06-30", course: "B.Tech CSE", rollNumber: "22b1234" });
    expect(c.verificationState).toBe("verified");
    expect(c.verificationSource).toBe("campus_email");
    expect(c.status).toBe("final_year"); // within 12 months of grad
    expect(c.rollNumberFlag).toBe(false);
  });
  it("flags a roll number that fails the campus regex but still verifies", async () => {
    const { userId } = await signedIn("x@iitb.ac.in");
    const c = await id.createCandidate({ userId, email: "x@iitb.ac.in", gradDate: "2029-06-30", course: "B.Tech", rollNumber: "nope" });
    expect(c.rollNumberFlag).toBe(true);
    expect(c.status).toBe("student");
  });
  it("refuses a non-campus email for the campus path", async () => {
    const { userId } = await signedIn("p@gmail.com");
    await expect(id.createCandidate({ userId, email: "p@gmail.com", gradDate: "2027-06-30", course: "B.Tech", rollNumber: null }))
      .rejects.toThrow(/campus/i);
  });
  it("derives status nightly from grad_date", async () => {
    const { userId } = await signedIn("g@iitdh.ac.in");
    await id.createCandidate({ userId, email: "g@iitdh.ac.in", gradDate: "2026-12-01", course: "B.Tech", rollNumber: null });
    const later = createIdentity(db, { clock: fixedClock("2026-12-02T00:00:00Z") });
    const n = await later.refreshCandidateStatuses();
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await later.getCandidate(userId))!.status).toBe("alumnus");
  });
});

describe("alumni direct request", () => {
  it("creates a verification_pending candidate scoped to the campus and verifies via staff", async () => {
    const { userId } = await signedIn("alum@gmail.com");
    const c = await id.createCandidate({ userId, email: "alum@gmail.com", campusShortCode: "IITB", gradDate: "2018-06-30", course: "B.Tech", rollNumber: null, claimed: { batch: "2018", branch: "EE", linkedinUrl: "https://linkedin.com/in/x" } });
    expect(c.verificationState).toBe("verification_pending");
    expect(c.verificationSource).toBe("association");
    expect(c.status).toBe("alumnus");
    const v = await id.verifyCandidate(userId, { by: "staff:u1", source: "staff" });
    expect(v.verificationState).toBe("verified");
    expect(v.verificationSource).toBe("staff");
  });
  it("rejects with a reason and allows exactly one re-request", async () => {
    const { userId } = await signedIn("alum2@gmail.com");
    await id.createCandidate({ userId, email: "alum2@gmail.com", campusShortCode: "IITB", gradDate: "2018-06-30", course: "B.Tech", rollNumber: null, claimed: { batch: "2018", branch: "EE", linkedinUrl: "" } });
    await id.rejectVerification(userId, { by: "staff:u1", reason: "no record" });
    expect((await id.getCandidate(userId))!.verificationState).toBe("rejected");
    await id.requestVerificationAgain(userId);
    expect((await id.getCandidate(userId))!.verificationState).toBe("verification_pending");
    await id.rejectVerification(userId, { by: "staff:u1", reason: "still no" });
    await expect(id.requestVerificationAgain(userId)).rejects.toThrow(/attempts/i);
  });
});

describe("profile and matchable list", () => {
  it("saves profile fields and filters matchable candidates by campus, status, openness", async () => {
    const a = await signedIn("m1@iitb.ac.in");
    await id.createCandidate({ userId: a.userId, email: "m1@iitb.ac.in", gradDate: "2027-06-30", course: "B.Tech", rollNumber: null });
    await id.saveProfile(a.userId, { skills: ["ts"], years_experience: 0 });
    const b = await signedIn("m2@iitb.ac.in");
    await id.createCandidate({ userId: b.userId, email: "m2@iitb.ac.in", gradDate: "2027-06-30", course: "B.Tech", rollNumber: null });
    await id.setCandidateOpen(b.userId, false);
    const campusId = (await id.campusByShortCode("IITB"))!.id;
    const list = await id.listMatchableCandidates({ campusIds: [campusId], statuses: ["final_year"] });
    expect(list.map((c) => c.userId)).toContain(a.userId);
    expect(list.map((c) => c.userId)).not.toContain(b.userId);
  });
});
```

- [ ] **Step 2: Run to see it fail** → FAIL, `seedCampuses` not a function.

- [ ] **Step 3: Implement campus helpers**

`packages/identity/src/campus.ts`:
```ts
import { eq, sql } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";

export function createCampus(db: DbOrTx) {
  return {
    async seedCampuses(rows: Array<{ name: string; shortCode: string; emailDomains: string[]; rollNumberRegex: string | null; internalTier: number }>) {
      for (const r of rows) await db.insert(schema.campus).values(r).onConflictDoNothing();
    },
    async campusForEmail(email: string) {
      const domain = email.toLowerCase().split("@")[1] ?? "";
      const [row] = await db.select().from(schema.campus).where(sql`${domain} = ANY(${schema.campus.emailDomains})`);
      return row ?? null;
    },
    async campusByShortCode(code: string) {
      const [row] = await db.select().from(schema.campus).where(eq(schema.campus.shortCode, code));
      return row ?? null;
    },
    async listCampuses() { return db.select().from(schema.campus); },
  };
}
```

- [ ] **Step 4: Implement candidate**

`packages/identity/src/candidate.ts`:
```ts
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";
import type { CandidateProfile } from "@zenhyre/db/schema";
import { Clock, Invalid, NotFound } from "@zenhyre/shared";
import { createCampus } from "./campus";

type Status = "student" | "final_year" | "alumnus";

export function deriveStatus(gradDate: string, now: Date, finalYearMonths = 12): Status {
  const grad = new Date(gradDate + "T00:00:00Z");
  if (now >= grad) return "alumnus";
  const fy = new Date(grad); fy.setUTCMonth(fy.getUTCMonth() - finalYearMonths);
  return now >= fy ? "final_year" : "student";
}

export interface CreateCandidateInput {
  userId: string; email: string; gradDate: string; course: string; rollNumber: string | null;
  /** alumni direct request only */
  campusShortCode?: string; claimed?: { batch: string; branch: string; linkedinUrl: string };
}

export function createCandidateModule(db: DbOrTx, clock: Clock, opts: { finalYearMonths: number; maxVerificationAttempts: number }) {
  const campus = createCampus(db);

  async function get(userId: string) {
    const [row] = await db.select().from(schema.candidate).where(eq(schema.candidate.userId, userId));
    return row ?? null;
  }

  return {
    ...campus,
    getCandidate: get,

    async createCandidate(input: CreateCandidateInput) {
      const now = clock.now();
      const byEmail = await campus.campusForEmail(input.email);
      let campusId: string, state: "verified" | "verification_pending", source: "campus_email" | "association";
      let rollFlag = false;
      if (byEmail) {
        campusId = byEmail.id; state = "verified"; source = "campus_email";
        if (byEmail.rollNumberRegex && !(input.rollNumber && new RegExp(byEmail.rollNumberRegex).test(input.rollNumber))) rollFlag = true;
        await db.update(schema.userEmail).set({ campusId }).where(eq(schema.userEmail.email, input.email.toLowerCase()));
      } else {
        if (!input.campusShortCode) throw new Invalid("not a campus email; pick a campus to request alumni verification");
        const c = await campus.campusByShortCode(input.campusShortCode);
        if (!c) throw new NotFound("campus");
        campusId = c.id; state = "verification_pending"; source = "association";
      }
      const [row] = await db.insert(schema.candidate).values({
        userId: input.userId, campusId, gradDate: input.gradDate, course: input.course, rollNumber: input.rollNumber,
        rollNumberFlag: rollFlag, status: deriveStatus(input.gradDate, now, opts.finalYearMonths),
        verificationState: state, verificationSource: source, verificationAttempts: byEmail ? 0 : 1,
        verifiedBy: byEmail ? "system" : null, verifiedAt: byEmail ? now : null,
        profile: input.claimed ? { linkedin_url: input.claimed.linkedinUrl, claimed: input.claimed } : {},
      }).returning();
      return row!;
    },

    /** §6.1: campus_email and referral sources are preserved on approval; association/staff set by the approver. */
    async verifyCandidate(userId: string, by: { by: string; source: "association" | "staff" }) {
      const c = await get(userId); if (!c) throw new NotFound("candidate");
      const source = (c.verificationSource === "referral" || c.verificationSource === "campus_email") ? c.verificationSource : by.source;
      const [row] = await db.update(schema.candidate)
        .set({ verificationState: "verified", verificationSource: source, verifiedBy: by.by, verifiedAt: clock.now() })
        .where(eq(schema.candidate.userId, userId)).returning();
      return row!;
    },
    async rejectVerification(userId: string, by: { by: string; reason: string }) {
      const [row] = await db.update(schema.candidate)
        .set({ verificationState: "rejected", verifiedBy: by.by })
        .where(eq(schema.candidate.userId, userId)).returning();
      if (!row) throw new NotFound("candidate");
      return row;
    },
    async requestVerificationAgain(userId: string) {
      const c = await get(userId); if (!c) throw new NotFound("candidate");
      if (c.verificationState !== "rejected") throw new Invalid("not rejected");
      if (c.verificationAttempts >= opts.maxVerificationAttempts) throw new Invalid("no verification attempts left");
      const [row] = await db.update(schema.candidate)
        .set({ verificationState: "verification_pending", verificationAttempts: c.verificationAttempts + 1 })
        .where(eq(schema.candidate.userId, userId)).returning();
      return row!;
    },
    async clearRollNumberFlag(userId: string) {
      await db.update(schema.candidate).set({ rollNumberFlag: false }).where(eq(schema.candidate.userId, userId));
    },
    async setCandidateOpen(userId: string, open: boolean) {
      await db.update(schema.candidate).set({ openToOpportunities: open }).where(eq(schema.candidate.userId, userId));
    },
    async setCandidateTrustStatus(userId: string, status: "ok" | "restricted" | "blocked") {
      await db.update(schema.candidate).set({ trustStatus: status }).where(eq(schema.candidate.userId, userId));
    },
    async saveProfile(userId: string, patch: CandidateProfile) {
      const c = await get(userId); if (!c) throw new NotFound("candidate");
      const [row] = await db.update(schema.candidate).set({ profile: { ...c.profile, ...patch } })
        .where(eq(schema.candidate.userId, userId)).returning();
      return row!;
    },
    async setCandidateStatus(userId: string, status: Status) {
      await db.update(schema.candidate).set({ status }).where(eq(schema.candidate.userId, userId));
    },
    /** Nightly: recompute status from grad_date. Returns rows changed. */
    async refreshCandidateStatuses() {
      const now = clock.now();
      const rows = await db.select({ userId: schema.candidate.userId, gradDate: schema.candidate.gradDate, status: schema.candidate.status }).from(schema.candidate);
      let n = 0;
      for (const r of rows) {
        const s = deriveStatus(r.gradDate, now, opts.finalYearMonths);
        if (s !== r.status) { await db.update(schema.candidate).set({ status: s }).where(eq(schema.candidate.userId, r.userId)); n++; }
      }
      return n;
    },
    async listMatchableCandidates(f: { campusIds: string[]; statuses: Status[]; minYears?: number; maxYears?: number }) {
      const conds = [
        eq(schema.candidate.openToOpportunities, true),
        eq(schema.candidate.verificationState, "verified"),
        ne(schema.candidate.trustStatus, "blocked"),
        inArray(schema.candidate.campusId, f.campusIds),
        inArray(schema.candidate.status, f.statuses),
      ];
      if (f.minYears !== undefined) conds.push(sql`coalesce((${schema.candidate.profile}->>'years_experience')::numeric, 0) >= ${f.minYears}`);
      if (f.maxYears !== undefined) conds.push(sql`coalesce((${schema.candidate.profile}->>'years_experience')::numeric, 0) <= ${f.maxYears}`);
      return db.select().from(schema.candidate).where(and(...conds));
    },
  };
}
```

Update `packages/identity/src/index.ts`: add `finalYearMonths?: number; maxVerificationAttempts?: number` to `IdentityDeps`, import `createCandidateModule`, and spread `...createCandidateModule(db, clock, { finalYearMonths: deps.finalYearMonths ?? 12, maxVerificationAttempts: deps.maxVerificationAttempts ?? 2 })` inside `buildIdentity` after `createAuth`. Add `export * from "./candidate";`. (Task 10 shows the complete final file.)

(Config values are passed in by the caller from `ops.config` so `identity` does not depend on `ops` at runtime; the API's context does the lookup.)

- [ ] **Step 5: Run tests** → candidate.test.ts 7 passed; auth.test.ts still 4 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/identity && git commit -m "feat(identity): campuses, candidate onboarding, verification, profile, matchable query"
```

### Task 10: `packages/identity` — company and association

**Files:**
- Create: `packages/identity/src/company.ts`, `packages/identity/src/association.ts`
- Modify: `packages/identity/src/index.ts`
- Test: `packages/identity/test/company.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDb } from "@zenhyre/db/test";
import { fixedClock } from "@zenhyre/shared";
import { createIdentity } from "../src/index";

let db: any, close: () => Promise<void>, id: ReturnType<typeof createIdentity>;
const FREEMAIL = ["gmail.com", "yahoo.com"];
beforeAll(async () => {
  ({ db, close } = await testDb());
  id = createIdentity(db, { clock: fixedClock("2026-11-05T10:00:00Z"), freemailDomains: FREEMAIL });
});
afterAll(() => close());
const signedIn = async (e: string) => id.redeemMagicLink((await id.issueMagicLink(e, "signin", {})).token);

describe("company", () => {
  it("creates a company from a work email; first user is owner; domain is verified_domain", async () => {
    const { userId } = await signedIn("founder@lab0.ai");
    const { company, membership } = await id.createCompany({ userId, email: "founder@lab0.ai", name: "Lab0" });
    expect(company.verifiedDomain).toBe("lab0.ai");
    expect(membership.role).toBe("owner");
  });
  it("refuses free-mail domains", async () => {
    const { userId } = await signedIn("someone@gmail.com");
    await expect(id.createCompany({ userId, email: "someone@gmail.com", name: "X" })).rejects.toThrow(/work email/i);
  });
  it("invites a member on the same domain and refuses other domains unless staff override", async () => {
    const { userId } = await signedIn("own@acme.io");
    const { company } = await id.createCompany({ userId, email: "own@acme.io", name: "Acme" });
    const inv = await id.inviteCompanyUser({ companyId: company.id, invitedBy: userId, email: "eng@acme.io" });
    expect(inv.token).toBeTruthy();
    await expect(id.inviteCompanyUser({ companyId: company.id, invitedBy: userId, email: "x@other.io" })).rejects.toThrow(/domain/i);
    const ov = await id.inviteCompanyUser({ companyId: company.id, invitedBy: userId, email: "x@other.io", staffOverride: true });
    expect(ov.token).toBeTruthy();
    // redeeming the invite creates the membership
    const r = await id.redeemMagicLink(inv.token);
    const m = await id.acceptCompanyInvite(r.userId, r.payload as any);
    expect(m.role).toBe("member");
    expect(m.companyId).toBe(company.id);
  });
  it("locks users and merges companies", async () => {
    const a = await signedIn("a@one.io"); const ca = (await id.createCompany({ userId: a.userId, email: "a@one.io", name: "One" })).company;
    const b = await signedIn("b@one-dup.io"); const cb = (await id.createCompany({ userId: b.userId, email: "b@one-dup.io", name: "One (dup)" })).company;
    await id.lockCompanyUsers(cb.id);
    expect((await id.listCompanyUsers(cb.id))[0]!.lockedAt).not.toBeNull();
    await id.mergeCompanies({ survivorId: ca.id, absorbedId: cb.id });
    expect((await id.listCompanyUsers(ca.id)).map((u) => u.userId).sort()).toEqual([a.userId, b.userId].sort());
    expect(await id.getCompany(cb.id)).toBeNull();
  });
});

describe("association", () => {
  it("creates an association for a campus and invites an admin", async () => {
    const staff = await signedIn("ops@novaretalent.com");
    await id.seedCampuses([{ name: "IIT Hyderabad", shortCode: "IITH", emailDomains: ["iith.ac.in"], rollNumberRegex: null, internalTier: 2 }]);
    const campusId = (await id.campusByShortCode("IITH"))!.id;
    const assoc = await id.createAssociation({ campusId, name: "IITHAA", shareRate: 0.15, payoutMode: "sponsorship_credit" });
    const inv = await id.inviteAssociationAdmin({ associationId: assoc.id, invitedBy: staff.userId, email: "admin@iithaa.org" });
    const r = await id.redeemMagicLink(inv.token);
    const m = await id.acceptAssociationInvite(r.userId, r.payload as any);
    expect(m.associationId).toBe(assoc.id);
    expect((await id.associationsForUser(r.userId)).map((a) => a.id)).toEqual([assoc.id]);
  });
});
```

- [ ] **Step 2: Run to see it fail** → FAIL, `createCompany` not a function.

- [ ] **Step 3: Implement**

`packages/identity/src/company.ts`:
```ts
import { and, eq } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";
import { Clock, Invalid, NotFound, Forbidden } from "@zenhyre/shared";
import { createAuth } from "./auth";

const domainOf = (e: string) => e.toLowerCase().split("@")[1] ?? "";

export function createCompanyModule(db: DbOrTx, clock: Clock, opts: { freemailDomains: string[] }) {
  const auth = createAuth(db, clock);
  async function get(id: string) {
    const [row] = await db.select().from(schema.company).where(eq(schema.company.id, id));
    return row ?? null;
  }
  return {
    getCompany: get,
    async createCompany(input: { userId: string; email: string; name: string }) {
      const domain = domainOf(input.email);
      if (opts.freemailDomains.includes(domain)) throw new Invalid("use a work email to register a company");
      const [company] = await db.insert(schema.company).values({ name: input.name, verifiedDomain: domain }).returning();
      const [membership] = await db.insert(schema.companyUser).values({ userId: input.userId, companyId: company!.id, role: "owner" }).returning();
      return { company: company!, membership: membership! };
    },
    async inviteCompanyUser(input: { companyId: string; invitedBy: string; email: string; staffOverride?: boolean }) {
      const c = await get(input.companyId); if (!c) throw new NotFound("company");
      if (!input.staffOverride && domainOf(input.email) !== c.verifiedDomain) throw new Invalid(`invitee must be on the ${c.verifiedDomain} domain`);
      return auth.issueMagicLink(input.email, "company_invite", { companyId: c.id, invitedBy: input.invitedBy });
    },
    async acceptCompanyInvite(userId: string, payload: { companyId: string; invitedBy: string }) {
      const [row] = await db.insert(schema.companyUser)
        .values({ userId, companyId: payload.companyId, role: "member", invitedBy: payload.invitedBy })
        .onConflictDoNothing().returning();
      if (row) return row;
      const [existing] = await db.select().from(schema.companyUser).where(and(eq(schema.companyUser.userId, userId), eq(schema.companyUser.companyId, payload.companyId)));
      return existing!;
    },
    async listCompanyUsers(companyId: string) {
      return db.select().from(schema.companyUser).where(eq(schema.companyUser.companyId, companyId));
    },
    async membershipFor(userId: string) {
      const [row] = await db.select().from(schema.companyUser).where(eq(schema.companyUser.userId, userId));
      return row ?? null;
    },
    async requireActiveMember(userId: string, companyId: string) {
      const [m] = await db.select().from(schema.companyUser).where(and(eq(schema.companyUser.userId, userId), eq(schema.companyUser.companyId, companyId)));
      if (!m || m.lockedAt) throw new Forbidden();
      return m;
    },
    async lockCompanyUsers(companyId: string) {
      await db.update(schema.companyUser).set({ lockedAt: clock.now() }).where(eq(schema.companyUser.companyId, companyId));
    },
    async setCompanyStatus(companyId: string, status: "active" | "probation" | "banned") {
      await db.update(schema.company).set({ status, statusChangedAt: clock.now() }).where(eq(schema.company.id, companyId));
    },
    /** Moves users (and, once the roles module exists, roles) to the survivor and deletes the absorbed company. */
    async mergeCompanies(input: { survivorId: string; absorbedId: string }) {
      const users = await db.select().from(schema.companyUser).where(eq(schema.companyUser.companyId, input.absorbedId));
      for (const u of users) {
        // Locks belong to the absorbed company's history; the survivor's status governs from here.
        await db.insert(schema.companyUser).values({ ...u, companyId: input.survivorId, role: "member", lockedAt: null }).onConflictDoNothing();
      }
      await db.delete(schema.companyUser).where(eq(schema.companyUser.companyId, input.absorbedId));
      await db.delete(schema.company).where(eq(schema.company.id, input.absorbedId));
    },
  };
}
```

`packages/identity/src/association.ts`:
```ts
import { eq } from "drizzle-orm";
import { DbOrTx, schema } from "@zenhyre/db";
import { Clock } from "@zenhyre/shared";
import { createAuth } from "./auth";

export function createAssociationModule(db: DbOrTx, clock: Clock) {
  const auth = createAuth(db, clock);
  return {
    async createAssociation(input: { campusId: string; name: string; shareRate: number; payoutMode: "cash" | "sponsorship_credit"; contacts?: Record<string, unknown> }) {
      const [row] = await db.insert(schema.association)
        .values({ campusId: input.campusId, name: input.name, shareRate: input.shareRate.toFixed(4), payoutMode: input.payoutMode, contacts: input.contacts ?? {} }).returning();
      return row!;
    },
    async associationForCampus(campusId: string) {
      const [row] = await db.select().from(schema.association).where(eq(schema.association.campusId, campusId));
      return row ?? null;
    },
    async inviteAssociationAdmin(input: { associationId: string; invitedBy: string; email: string }) {
      return auth.issueMagicLink(input.email, "association_admin_invite", { associationId: input.associationId, invitedBy: input.invitedBy });
    },
    async acceptAssociationInvite(userId: string, payload: { associationId: string; invitedBy: string }) {
      const [row] = await db.insert(schema.associationAdmin)
        .values({ userId, associationId: payload.associationId, invitedBy: payload.invitedBy }).onConflictDoNothing().returning();
      return row ?? { userId, associationId: payload.associationId, invitedBy: payload.invitedBy, joinedAt: clock.now() };
    },
    async associationsForUser(userId: string) {
      const rows = await db.select({ a: schema.association }).from(schema.associationAdmin)
        .innerJoin(schema.association, eq(schema.association.id, schema.associationAdmin.associationId))
        .where(eq(schema.associationAdmin.userId, userId));
      return rows.map((r) => r.a);
    },
  };
}
```

Final `packages/identity/src/index.ts` (this is the version Chunk 3 builds on; it already includes `withDb`):
```ts
import { DbOrTx } from "@zenhyre/db";
import { Clock, systemClock } from "@zenhyre/shared";
import { createAuth } from "./auth";
import { createCandidateModule } from "./candidate";
import { createCompanyModule } from "./company";
import { createAssociationModule } from "./association";
export * from "./candidate";

export interface IdentityDeps {
  clock?: Clock; finalYearMonths?: number; maxVerificationAttempts?: number; freemailDomains?: string[];
}

function buildIdentity(db: DbOrTx, deps: IdentityDeps) {
  const clock = deps.clock ?? systemClock;
  return {
    ...createAuth(db, clock),
    ...createCandidateModule(db, clock, { finalYearMonths: deps.finalYearMonths ?? 12, maxVerificationAttempts: deps.maxVerificationAttempts ?? 2 }),
    ...createCompanyModule(db, clock, { freemailDomains: deps.freemailDomains ?? [] }),
    ...createAssociationModule(db, clock),
  };
}
export type Identity = ReturnType<typeof buildIdentity> & { withDb(tx: DbOrTx): Identity };
export function createIdentity(db: DbOrTx, deps: IdentityDeps = {}): Identity {
  return { ...buildIdentity(db, deps), withDb: (tx) => createIdentity(tx, deps) };
}
```

(The explicit `Identity` type is what keeps `withDb` from being an implicit-any recursion under `strict`; the same pattern is used in `ops` and `notify`.)

- [ ] **Step 4: Run tests** → company.test.ts 5 passed; all identity tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/identity && git commit -m "feat(identity): company onboarding, invites, lock/merge, associations"
```

---

## Chunk 3: API service

### Task 11: `services/api` — app factory, auth middleware, auth routes

**Files:**
- Create: `services/api/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/context.ts`, `src/index.ts`, `src/app.ts`, `src/middleware/auth.ts`, `src/routes/auth.ts`
- Test: `services/api/test/helpers.ts`, `services/api/test/auth.test.ts`

`services/api/package.json`:
```json
{
  "name": "@zenhyre/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "@hono/node-server": "^1.13.0",
    "zod": "^3.23.0",
    "drizzle-orm": "^0.36.0",
    "svix": "^1.40.0",
    "@zenhyre/db": "workspace:*",
    "@zenhyre/shared": "workspace:*",
    "@zenhyre/ops": "workspace:*",
    "@zenhyre/identity": "workspace:*",
    "@zenhyre/notify": "workspace:*"
  },
  "devDependencies": { "tsx": "^4.19.0", "typescript": "^5.6.0", "vitest": "^2.1.0" }
}
```
`tsconfig.json` and `vitest.config.ts`: same as `packages/shared` (tsconfig `include: ["src", "test"]`).

- [ ] **Step 1: Test helper and failing test**

`services/api/test/helpers.ts`:
```ts
import { testDb } from "@zenhyre/db/test";
import { fixedClock } from "@zenhyre/shared";
import { MemoryTransport } from "@zenhyre/notify";
import { buildApp } from "../src/app";

export async function testApp(iso = "2026-11-05T10:00:00Z") {
  const { db, close } = await testDb();
  const transport = new MemoryTransport();
  const app = await buildApp({ db, clock: fixedClock(iso), transport, baseUrl: "http://test" });
  const lastLink = () => transport.sent.at(-1)!.text.match(/https?:\/\/\S+/)![0];
  async function signIn(email: string) {
    await app.request("/auth/magic-link", { method: "POST", body: JSON.stringify({ email }), headers: { "content-type": "application/json" } });
    const url = new URL(lastLink());
    const res = await app.request(url.pathname + url.search);
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    return { cookie, json: await res.json() as any };
  }
  const as = (cookie: string) => (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), cookie, "content-type": "application/json" } });
  return { app, db, close, transport, signIn, as };
}
```

`services/api/test/auth.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testApp } from "./helpers";

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => (t = await testApp()));
afterAll(() => t.close());

describe("auth", () => {
  it("emails a magic link, redeems it, sets a session cookie, and /me works", async () => {
    const { cookie, json } = await t.signIn("x@gmail.com");
    expect(json.created).toBe(true);
    const me = await t.as(cookie)("/me");
    expect(me.status).toBe(200);
    expect((await me.json() as any).user.id).toBe(json.userId);
  });
  it("rejects /me without a session", async () => {
    expect((await t.app.request("/me")).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to see it fail** → FAIL, `../src/app` not found.

- [ ] **Step 3: Implement**

`services/api/src/context.ts`:
```ts
import { Db } from "@zenhyre/db";
import { Clock } from "@zenhyre/shared";
import { createOps, Ops } from "@zenhyre/ops";
import { createIdentity, Identity } from "@zenhyre/identity";
import { createNotify, Notify, Transport } from "@zenhyre/notify";

export interface AppConfig { db: Db; clock: Clock; transport: Transport; baseUrl: string; webhookSecret?: string }
export interface AppDeps extends AppConfig { ops: Ops; identity: Identity; notify: Notify }

export async function buildDeps(cfg: AppConfig): Promise<AppDeps> {
  const ops = createOps(cfg.db);
  const identity = createIdentity(cfg.db, {
    clock: cfg.clock,
    freemailDomains: await ops.config.get("identity.freemail_domains"),
    finalYearMonths: await ops.config.get("identity.final_year_months_before_grad"),
    maxVerificationAttempts: await ops.config.get("identity.max_verification_attempts"),
  });
  return { ...cfg, ops, identity, notify: createNotify(cfg.db, cfg.transport) };
}

export type Vars = { user: { id: string; isStaff: boolean } | null; deps: AppDeps };
```

`services/api/src/middleware/auth.ts`:
```ts
import { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { Forbidden } from "@zenhyre/shared";
import { Vars } from "../context";

export const sessionUser: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
  const sid = getCookie(c, "zh_session");
  const u = sid ? await c.var.deps.identity.userForSession(sid) : null;
  c.set("user", u ? { id: u.id, isStaff: u.isStaff } : null);
  await next();
};
export const requireUser: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
  if (!c.var.user) return c.json({ error: "unauthenticated" }, 401);
  await next();
};
export const requireStaff: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
  if (!c.var.user?.isStaff) throw new Forbidden("staff only");
  await next();
};
```

`services/api/src/routes/auth.ts`:
```ts
import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { z } from "zod";
import { Vars } from "../context";

export const authRoutes = new Hono<{ Variables: Vars }>();

authRoutes.post("/auth/magic-link", async (c) => {
  const { email } = z.object({ email: z.string().email() }).parse(await c.req.json());
  const { identity, notify, baseUrl } = c.var.deps;
  const { token } = await identity.issueMagicLink(email, "signin", {});
  // The user may not exist yet, so address by email rather than by userId.
  await notify.sendToEmail(email, "magic_link", { url: `${baseUrl}/auth/redeem?t=${token}` });
  return c.json({ ok: true });
});

authRoutes.get("/auth/redeem", async (c) => {
  const t = c.req.query("t") ?? "";
  const r = await c.var.deps.identity.redeemMagicLink(t);
  if (r.purpose === "company_invite") await c.var.deps.identity.acceptCompanyInvite(r.userId, r.payload as any);
  if (r.purpose === "association_admin_invite") await c.var.deps.identity.acceptAssociationInvite(r.userId, r.payload as any);
  setCookie(c, "zh_session", r.sessionId, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 30 * 24 * 3600 });
  return c.json({ userId: r.userId, created: r.created, purpose: r.purpose });
});

authRoutes.post("/auth/signout", async (c) => {
  const sid = getCookie(c, "zh_session");
  if (sid) await c.var.deps.identity.endSession(sid);
  deleteCookie(c, "zh_session", { path: "/" });
  return c.json({ ok: true });
});

authRoutes.get("/me", async (c) => {
  if (!c.var.user) return c.json({ error: "unauthenticated" }, 401);
  const { identity } = c.var.deps;
  const [candidate, membership, associations] = await Promise.all([
    identity.getCandidate(c.var.user.id), identity.membershipFor(c.var.user.id), identity.associationsForUser(c.var.user.id)]);
  return c.json({ user: c.var.user, candidate, membership, associations });
});
```

`services/api/src/app.ts`:
```ts
import { Hono } from "hono";
import { DomainError } from "@zenhyre/shared";
import { ZodError } from "zod";
import { AppConfig, Vars, buildDeps } from "./context";
import { sessionUser } from "./middleware/auth";
import { authRoutes } from "./routes/auth";

export async function buildApp(cfg: AppConfig) {
  const deps = await buildDeps(cfg);
  const app = new Hono<{ Variables: Vars }>();
  app.use("*", async (c, next) => { c.set("deps", deps); await next(); });
  app.use("*", sessionUser);
  app.onError((err, c) => {
    if (err instanceof DomainError) return c.json({ error: err.code, message: err.message }, err.status as any);
    if (err instanceof ZodError) return c.json({ error: "invalid", issues: err.issues }, 400);
    if (err instanceof SyntaxError) return c.json({ error: "invalid", message: "malformed JSON" }, 400);
    console.error(err);
    return c.json({ error: "internal" }, 500);
  });
  app.route("/", authRoutes);
  // Task 12 mounts: webhookRoutes (unauthenticated) and the guarded route groups.
  // Guards are applied per path prefix inside each route file, never as `use("*")` on a
  // sub-app, because sub-app middleware registered on "*" leaks onto every later route.
  return app;
}
```

`services/api/src/index.ts`:
```ts
import { serve } from "@hono/node-server";
import { createDb } from "@zenhyre/db";
import { systemClock } from "@zenhyre/shared";
import { ResendTransport, MemoryTransport } from "@zenhyre/notify";
import { buildApp } from "./app";

const { db } = createDb();
const transport = process.env.RESEND_API_KEY
  ? new ResendTransport(process.env.RESEND_API_KEY, process.env.MAIL_FROM ?? "Zenhyre <no-reply@zenhyre.com>")
  : new MemoryTransport();
const app = await buildApp({ db, clock: systemClock, transport, baseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000", webhookSecret: process.env.RESEND_WEBHOOK_SECRET });
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4000) }, (i) => console.log(`api on :${i.port}`));
```

- [ ] **Step 4: Run tests** → 2 passed.

- [ ] **Step 5: Commit**

```bash
git add services/api && git commit -m "feat(api): hono app, session middleware, magic-link routes"
```

### Task 12: `services/api` — candidate and company routes with workflows

**Files:**
- Create: `services/api/src/workflows/signUpCandidate.ts`, `src/workflows/retryVerification.ts`, `src/workflows/resolveVerification.ts`, `src/workflows/saveProfile.ts`, `src/routes/candidate.ts`, `src/routes/company.ts`, `src/routes/admin.ts`, `src/routes/webhooks.ts`
- Modify: `services/api/src/app.ts` (mount order)
- Test: `services/api/test/candidate.test.ts`, `services/api/test/company.test.ts`, `services/api/test/admin.test.ts`, `services/api/test/webhooks.test.ts`

(`withDb`, `emailsFor`, `userIdForEmail`, `sendToEmail`, `hasDeliverableEmail` were all added in Chunk 2; nothing in the packages changes in this task.)

- [ ] **Step 1: Failing tests**

`services/api/test/candidate.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { schema } from "@zenhyre/db";
import { testApp } from "./helpers";

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
  await t.db.insert(schema.campus).values({ name: "IIT Bombay", shortCode: "IITB", emailDomains: ["iitb.ac.in"], rollNumberRegex: "^\\d{2}[a-z]\\d{4}$", internalTier: 1 });
});
afterAll(() => t.close());

describe("candidate sign-up", () => {
  it("campus email: creates verified candidate, no review item", async () => {
    const { cookie } = await t.signIn("22b0001@iitb.ac.in");
    const res = await t.as(cookie)("/candidates", { method: "POST", body: JSON.stringify({ gradDate: "2027-06-30", course: "B.Tech CSE", rollNumber: "22b0001" }) });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.candidate.verificationState).toBe("verified");
    const items = await t.db.select().from(schema.reviewItem);
    expect(items).toHaveLength(0);
  });
  it("campus email with bad roll number: verified but opens a staff verification item", async () => {
    const { cookie } = await t.signIn("weird@iitb.ac.in");
    await t.as(cookie)("/candidates", { method: "POST", body: JSON.stringify({ gradDate: "2027-06-30", course: "B.Tech", rollNumber: "ZZZ" }) });
    const items = await t.db.select().from(schema.reviewItem);
    expect(items.some((i) => i.kind === "verification" && i.associationId === null)).toBe(true);
  });
  it("alumni direct request: pending, review item unscoped when campus has no association", async () => {
    const { cookie } = await t.signIn("alum@gmail.com");
    const res = await t.as(cookie)("/candidates", { method: "POST", body: JSON.stringify({ campusShortCode: "IITB", gradDate: "2018-06-30", course: "B.Tech", claimed: { batch: "2018", branch: "EE", linkedinUrl: "https://linkedin.com/in/a" } }) });
    expect(res.status).toBe(201);
    expect((await res.json() as any).candidate.verificationState).toBe("verification_pending");
  });
  it("profile save and open toggle", async () => {
    const { cookie } = await t.signIn("22b0002@iitb.ac.in");
    await t.as(cookie)("/candidates", { method: "POST", body: JSON.stringify({ gradDate: "2027-06-30", course: "B.Tech", rollNumber: "22b0002" }) });
    const p = await t.as(cookie)("/me/profile", { method: "PUT", body: JSON.stringify({ skills: ["ts", "pg"], years_experience: 0 }) });
    expect((await p.json() as any).profile.skills).toEqual(["ts", "pg"]);
    const o = await t.as(cookie)("/me/open", { method: "PUT", body: JSON.stringify({ open: false }) });
    expect(o.status).toBe(200);
  });
});
```

`services/api/test/company.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testApp } from "./helpers";

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => (t = await testApp()));
afterAll(() => t.close());

describe("company sign-up and invites", () => {
  it("creates a company and invites a teammate who lands as member", async () => {
    const { cookie } = await t.signIn("ceo@lab0.ai");
    const res = await t.as(cookie)("/companies", { method: "POST", body: JSON.stringify({ name: "Lab0" }) });
    expect(res.status).toBe(201);
    const { company } = await res.json() as any;
    const inv = await t.as(cookie)(`/companies/${company.id}/invites`, { method: "POST", body: JSON.stringify({ email: "cto@lab0.ai" }) });
    expect(inv.status).toBe(200);
    expect(t.transport.sent.at(-1)!.to).toBe("cto@lab0.ai");
    const url = new URL(t.transport.sent.at(-1)!.text.match(/https?:\/\/\S+/)![0]);
    const red = await t.app.request(url.pathname + url.search);
    const cookie2 = red.headers.get("set-cookie")!.split(";")[0]!;
    const me = await (await t.as(cookie2)("/me")).json() as any;
    expect(me.membership.companyId).toBe(company.id);
    expect(me.membership.role).toBe("member");
  });
  it("refuses gmail for company sign-up", async () => {
    const { cookie } = await t.signIn("founder@gmail.com");
    const res = await t.as(cookie)("/companies", { method: "POST", body: JSON.stringify({ name: "X" }) });
    expect(res.status).toBe(400);
  });
});
```

`services/api/test/admin.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@zenhyre/db";
import { testApp } from "./helpers";

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
  await t.db.insert(schema.campus).values({ name: "IIT Bombay", shortCode: "IITB", emailDomains: ["iitb.ac.in"], rollNumberRegex: null, internalTier: 1 });
});
afterAll(() => t.close());

async function staff() {
  const s = await t.signIn("ops@novaretalent.com");
  await t.db.update(schema.user).set({ isStaff: true }).where(eq(schema.user.id, s.json.userId));
  return s.cookie;
}

describe("admin", () => {
  it("non-staff is forbidden", async () => {
    const { cookie } = await t.signIn("nobody@gmail.com");
    expect((await t.as(cookie)("/admin/reviews")).status).toBe(403);
  });
  it("staff lists the verification queue and approves via escape hatch, candidate is notified", async () => {
    const alum = await t.signIn("alum@gmail.com");
    await t.as(alum.cookie)("/candidates", { method: "POST", body: JSON.stringify({ campusShortCode: "IITB", gradDate: "2018-06-30", course: "B.Tech", claimed: { batch: "2018", branch: "EE", linkedinUrl: "" } }) });
    const cookie = await staff();
    const list = await (await t.as(cookie)("/admin/reviews?kind=verification&escapeHatchDays=0")).json() as any;
    expect(list.items).toHaveLength(1);
    const res = await t.as(cookie)(`/admin/reviews/${list.items[0].id}/resolve`, { method: "POST", body: JSON.stringify({ resolution: "approve", note: "degree cert seen" }) });
    expect(res.status).toBe(200);
    const [c] = await t.db.select().from(schema.candidate).where(eq(schema.candidate.userId, alum.json.userId));
    expect(c!.verificationState).toBe("verified");
    expect(c!.verificationSource).toBe("staff");
    expect(t.transport.sent.at(-1)!.subject).toMatch(/verified/i);
    const audit = await t.db.select().from(schema.staffAction);
    expect(audit).toHaveLength(1);
  });
  it("staff reads and updates config", async () => {
    const cookie = await staff();
    const put = await t.as(cookie)("/admin/config/match.broadcast_days", { method: "PUT", body: JSON.stringify({ value: 12 }) });
    expect(put.status).toBe(200);
    const get = await (await t.as(cookie)("/admin/config")).json() as any;
    expect(get["match.broadcast_days"]).toBe(12);
  });
});
```

- [ ] **Step 2: Run to see them fail** → FAIL, 404s on the new routes.

- [ ] **Step 3: Workflows**

`services/api/src/workflows/signUpCandidate.ts`:
```ts
import { AppDeps } from "../context";
import { CreateCandidateInput } from "@zenhyre/identity";

/** §3.3 signUpCandidate: identity + ops (roll-number flag / association-scoped verification item). One transaction. */
export async function signUpCandidate(deps: AppDeps, input: CreateCandidateInput) {
  return deps.db.transaction(async (tx) => {
    const identity = deps.identity.withDb(tx);
    const ops = deps.ops.withDb(tx);
    const c = await identity.createCandidate(input);
    if (c.rollNumberFlag) {
      await ops.openReview({ kind: "verification", refType: "candidate", refId: c.userId, associationId: null,
        payload: { reason: "roll_number_mismatch", rollNumber: c.rollNumber } });
    }
    if (c.verificationState === "verification_pending") {
      const assoc = await identity.associationForCampus(c.campusId);
      await ops.openReview({ kind: "verification", refType: "candidate", refId: c.userId, associationId: assoc?.id ?? null,
        payload: { claimed: c.profile.claimed ?? {}, attempt: c.verificationAttempts } });
    }
    return c;
  });
}
```

`services/api/src/workflows/retryVerification.ts`:
```ts
import { AppDeps } from "../context";
/** Candidate re-requests verification after a rejection (§6.1, at most one retry). identity + ops in one transaction. */
export async function retryVerification(deps: AppDeps, userId: string) {
  return deps.db.transaction(async (tx) => {
    const identity = deps.identity.withDb(tx), ops = deps.ops.withDb(tx);
    const row = await identity.requestVerificationAgain(userId);
    const assoc = await identity.associationForCampus(row.campusId);
    await ops.openReview({ kind: "verification", refType: "candidate", refId: row.userId, associationId: assoc?.id ?? null,
      payload: { claimed: row.profile.claimed ?? {}, attempt: row.verificationAttempts } });
    return row;
  });
}
```

`services/api/src/workflows/resolveVerification.ts`:
```ts
import { z } from "zod";
import { AppDeps } from "../context";
import { Forbidden, NotFound } from "@zenhyre/shared";

export const VerificationResolution = z.enum(["approve", "reject", "reject_fraud", "clear_flag"]);
export type VerificationResolution = z.infer<typeof VerificationResolution>;

/**
 * §3.3 resolveVerification: identity + ops + notify in one transaction. Trust (`profile_false`) is attached in Slice 3.
 * Note: notify.send runs inside the transaction here; Plan 1B moves email delivery to a post-commit job.
 */
export async function resolveVerification(deps: AppDeps, input: { reviewId: string; actor: { id: string; isStaff: boolean; associationId?: string }; resolution: VerificationResolution; note?: string }) {
  return deps.db.transaction(async (tx) => {
    const identity = deps.identity.withDb(tx), ops = deps.ops.withDb(tx), notify = deps.notify.withDb(tx);
    const item = await ops.getReview(input.reviewId);
    if (!item || item.kind !== "verification" || item.resolvedAt) throw new NotFound("open verification item");
    if (!input.actor.isStaff && item.associationId !== input.actor.associationId) throw new Forbidden("not your queue");
    const userId = item.refId;
    const by = input.actor.id; // §4.1: verified_by is a user id or "system"
    switch (input.resolution) {
      case "approve":
        await identity.verifyCandidate(userId, { by, source: input.actor.isStaff ? "staff" : "association" });
        await notify.send(userId, "verification_approved", {});
        break;
      case "reject":
      case "reject_fraud":
        await identity.rejectVerification(userId, { by, reason: input.note ?? "" });
        await notify.send(userId, "verification_rejected", { reason: input.note ?? "not verified" });
        break;
      case "clear_flag":
        await identity.clearRollNumberFlag(userId);
        break;
    }
    await ops.resolveReview(item.id, input.actor.isStaff ? `staff:${by}` : `association:${by}`, input.resolution);
    if (input.actor.isStaff) await ops.audit(input.actor.id, `verification.${input.resolution}`, "candidate", userId, input.note);
  });
}
```

`services/api/src/workflows/saveProfile.ts`:
```ts
import { AppDeps } from "../context";
import type { CandidateProfile } from "@zenhyre/db/schema";
/** §3.3 saveProfile. Embedding job enqueue is added in Plan 1B when matching exists. */
export async function saveProfile(deps: AppDeps, userId: string, patch: CandidateProfile) {
  return deps.identity.saveProfile(userId, patch);
}
```

- [ ] **Step 4: Routes**

`services/api/src/routes/candidate.ts`:
```ts
import { Hono } from "hono";
import { z } from "zod";
import { Vars } from "../context";
import { requireUser } from "../middleware/auth";
import { signUpCandidate } from "../workflows/signUpCandidate";
import { retryVerification } from "../workflows/retryVerification";
import { saveProfile } from "../workflows/saveProfile";

export const candidateRoutes = new Hono<{ Variables: Vars }>();
// Prefix-scoped guards: these do not leak onto other route groups mounted on the same parent.
candidateRoutes.use("/candidates", requireUser);
candidateRoutes.use("/me/*", requireUser);
candidateRoutes.use("/campuses", requireUser);

const signUp = z.object({
  gradDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), course: z.string().min(1), rollNumber: z.string().nullable().optional(),
  campusShortCode: z.string().optional(),
  claimed: z.object({ batch: z.string(), branch: z.string(), linkedinUrl: z.string() }).optional(),
});

candidateRoutes.post("/candidates", async (c) => {
  const body = signUp.parse(await c.req.json());
  const me = await c.var.deps.identity.getCandidate(c.var.user!.id);
  if (me) return c.json({ error: "already a candidate" }, 409);
  const emailRow = (await c.var.deps.identity.emailsFor(c.var.user!.id)).find((e) => e.isPrimary)!;
  const candidate = await signUpCandidate(c.var.deps, { userId: c.var.user!.id, email: emailRow.email, gradDate: body.gradDate, course: body.course,
    rollNumber: body.rollNumber ?? null, campusShortCode: body.campusShortCode, claimed: body.claimed });
  return c.json({ candidate }, 201);
});

candidateRoutes.get("/me/profile", async (c) => c.json({ candidate: await c.var.deps.identity.getCandidate(c.var.user!.id) }));

const profilePatch = z.object({
  headline: z.string().optional(), skills: z.array(z.string()).optional(), years_experience: z.number().min(0).optional(),
  current_company: z.string().optional(), current_title: z.string().optional(), preferred_roles: z.array(z.string()).optional(),
  preferred_locations: z.array(z.string()).optional(), notice_period_days: z.number().int().min(0).optional(),
  current_ctc: z.number().int().min(0).optional(), linkedin_url: z.string().optional(), cv_url: z.string().optional(),
});
candidateRoutes.put("/me/profile", async (c) => {
  const row = await saveProfile(c.var.deps, c.var.user!.id, profilePatch.parse(await c.req.json()));
  return c.json({ profile: row.profile });
});
candidateRoutes.put("/me/open", async (c) => {
  const { open } = z.object({ open: z.boolean() }).parse(await c.req.json());
  await c.var.deps.identity.setCandidateOpen(c.var.user!.id, open);
  return c.json({ ok: true });
});
candidateRoutes.post("/me/verification/retry", async (c) => {
  return c.json({ candidate: await retryVerification(c.var.deps, c.var.user!.id) });
});
candidateRoutes.get("/campuses", async (c) => c.json({ campuses: await c.var.deps.identity.listCampuses() }));
```

`services/api/src/routes/company.ts`:
```ts
import { Hono } from "hono";
import { z } from "zod";
import { Vars } from "../context";
import { requireUser } from "../middleware/auth";

export const companyRoutes = new Hono<{ Variables: Vars }>();
companyRoutes.use("/companies", requireUser);
companyRoutes.use("/companies/*", requireUser);

companyRoutes.post("/companies", async (c) => {
  const { name } = z.object({ name: z.string().min(1) }).parse(await c.req.json());
  const { identity } = c.var.deps;
  if (await identity.membershipFor(c.var.user!.id)) return c.json({ error: "already in a company" }, 409);
  const email = (await identity.emailsFor(c.var.user!.id)).find((e) => e.isPrimary)!.email;
  const r = await identity.createCompany({ userId: c.var.user!.id, email, name });
  return c.json(r, 201);
});

companyRoutes.post("/companies/:id/invites", async (c) => {
  const { email } = z.object({ email: z.string().email() }).parse(await c.req.json());
  const { identity, notify, baseUrl } = c.var.deps;
  const companyId = c.req.param("id");
  const isStaff = c.var.user!.isStaff;
  if (!isStaff) {
    const m = await identity.requireActiveMember(c.var.user!.id, companyId);
    if (m.role !== "owner") return c.json({ error: "owner only" }, 403);
  }
  const company = await identity.getCompany(companyId);
  if (!company) return c.json({ error: "not found" }, 404);
  const { token } = await identity.inviteCompanyUser({ companyId, invitedBy: c.var.user!.id, email, staffOverride: isStaff });
  await notify.sendToEmail(email, "company_invite", { companyName: company.name, inviterName: "A teammate", url: `${baseUrl}/auth/redeem?t=${token}` });
  return c.json({ ok: true });
});

companyRoutes.get("/companies/:id", async (c) => {
  const { identity } = c.var.deps;
  await identity.requireActiveMember(c.var.user!.id, c.req.param("id"));
  return c.json({ company: await identity.getCompany(c.req.param("id")), users: await identity.listCompanyUsers(c.req.param("id")) });
});
```

`services/api/src/routes/admin.ts`:
```ts
import { Hono } from "hono";
import { z } from "zod";
import { Vars } from "../context";
import { requireUser, requireStaff } from "../middleware/auth";
import { resolveVerification, VerificationResolution } from "../workflows/resolveVerification";
import { ConfigKey, CONFIG } from "@zenhyre/ops";

export const adminRoutes = new Hono<{ Variables: Vars }>();
adminRoutes.use("/admin/*", requireUser, requireStaff);

adminRoutes.get("/admin/reviews", async (c) => {
  const kind = c.req.query("kind") as any;
  const escapeHatchDays = c.req.query("escapeHatchDays") !== undefined ? Number(c.req.query("escapeHatchDays")) : await c.var.deps.ops.config.get("identity.escape_hatch_days");
  const items = await c.var.deps.ops.listReviews({ kind, open: true, staffQueue: kind === "verification", escapeHatchDays });
  return c.json({ items });
});

adminRoutes.post("/admin/reviews/:id/resolve", async (c) => {
  const body = z.object({ resolution: z.string(), note: z.string().optional() }).parse(await c.req.json());
  const item = await c.var.deps.ops.getReview(c.req.param("id"));
  if (!item) return c.json({ error: "not found" }, 404);
  if (item.kind === "verification") {
    const resolution = VerificationResolution.parse(body.resolution);
    await resolveVerification(c.var.deps, { reviewId: item.id, actor: { id: c.var.user!.id, isStaff: true }, resolution, note: body.note });
  } else {
    await c.var.deps.ops.resolveReview(item.id, `staff:${c.var.user!.id}`, body.resolution);
    await c.var.deps.ops.audit(c.var.user!.id, `review.${item.kind}.${body.resolution}`, item.refType, item.refId, body.note);
  }
  return c.json({ ok: true });
});

adminRoutes.get("/admin/config", async (c) => {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(CONFIG) as ConfigKey[]) out[k] = await c.var.deps.ops.config.get(k);
  return c.json(out);
});
adminRoutes.put("/admin/config/:key", async (c) => {
  const key = c.req.param("key") as ConfigKey;
  if (!(key in CONFIG)) return c.json({ error: "unknown key" }, 404);
  const { value } = z.object({ value: z.unknown() }).parse(await c.req.json());
  await c.var.deps.ops.config.set(key, value as any, `staff:${c.var.user!.id}`);
  await c.var.deps.ops.audit(c.var.user!.id, "config.set", "config", key);
  return c.json({ ok: true });
});

adminRoutes.post("/admin/associations", async (c) => {
  const body = z.object({ campusShortCode: z.string(), name: z.string(), shareRate: z.number().min(0).max(1).default(0.15), payoutMode: z.enum(["cash", "sponsorship_credit"]), adminEmails: z.array(z.string().email()).default([]) }).parse(await c.req.json());
  const { identity, notify, baseUrl } = c.var.deps;
  const campus = await identity.campusByShortCode(body.campusShortCode);
  if (!campus) return c.json({ error: "unknown campus" }, 404);
  if (await identity.associationForCampus(campus.id)) return c.json({ error: "campus already has an association" }, 409);
  const assoc = await identity.createAssociation({ campusId: campus.id, name: body.name, shareRate: body.shareRate, payoutMode: body.payoutMode });
  for (const email of body.adminEmails) {
    const { token } = await identity.inviteAssociationAdmin({ associationId: assoc.id, invitedBy: c.var.user!.id, email });
    await notify.sendToEmail(email, "association_admin_invite", { associationName: assoc.name, url: `${baseUrl}/auth/redeem?t=${token}` });
  }
  await c.var.deps.ops.audit(c.var.user!.id, "association.create", "association", assoc.id);
  return c.json({ association: assoc }, 201);
});
```

`services/api/src/routes/webhooks.ts` (Resend bounce → §11 rule; Svix-signed):
```ts
import { Hono } from "hono";
import { z } from "zod";
import { Webhook } from "svix";
import { Vars } from "../context";

export const webhookRoutes = new Hono<{ Variables: Vars }>();

const bounceEvent = z.object({ type: z.string(), data: z.object({ to: z.array(z.string()), bounce: z.object({ message: z.string() }).optional() }) });

webhookRoutes.post("/webhooks/resend", async (c) => {
  const raw = await c.req.text();
  const secret = c.var.deps.webhookSecret;
  let payload: unknown;
  if (secret) {
    try {
      payload = new Webhook(secret).verify(raw, {
        "svix-id": c.req.header("svix-id") ?? "", "svix-timestamp": c.req.header("svix-timestamp") ?? "", "svix-signature": c.req.header("svix-signature") ?? "" });
    } catch { return c.json({ error: "bad signature" }, 401); }
  } else {
    payload = JSON.parse(raw); // tests and local dev run without a secret
  }
  const body = bounceEvent.parse(payload);
  if (body.type !== "email.bounced") return c.json({ ok: true });
  const { notify, identity, ops } = c.var.deps;
  for (const email of body.data.to) {
    const userId = await identity.userIdForEmail(email);
    if (!userId) continue; // invites to not-yet-users: nothing to record
    await notify.recordBounce(email, body.data.bounce?.message ?? "bounce");
    if (!(await notify.hasDeliverableEmail(userId))) {
      await ops.openReview({ kind: "alert", refType: "user", refId: userId, associationId: null, payload: { reason: "all emails bouncing" } });
    }
  }
  return c.json({ ok: true });
});
```

Add `webhookSecret?: string` to `AppConfig` in `context.ts`, and read it from `RESEND_WEBHOOK_SECRET` in `src/index.ts`.

`services/api/test/webhooks.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { schema } from "@zenhyre/db";
import { testApp } from "./helpers";

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => (t = await testApp()));
afterAll(() => t.close());

describe("resend bounce webhook", () => {
  it("is reachable without a session, ignores unknown addresses, and alerts when a user has no deliverable email", async () => {
    const post = (to: string) => t.app.request("/webhooks/resend", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "email.bounced", data: { to: [to], bounce: { message: "hard" } } }) });
    expect((await post("ghost@nowhere.io")).status).toBe(200);
    const { json } = await t.signIn("only@gmail.com");
    expect((await post("only@gmail.com")).status).toBe(200);
    const alerts = (await t.db.select().from(schema.reviewItem)).filter((i) => i.kind === "alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.refId).toBe(json.userId);
  });
});
```

Mount in `app.ts`, webhooks first: `app.route("/", webhookRoutes); app.route("/", candidateRoutes); app.route("/", companyRoutes); app.route("/", adminRoutes);`

- [ ] **Step 5: Run all tests**

Run: `pnpm -r build && pnpm test`
Expected: every package green; api: auth 2, candidate 4, company 2, admin 3, webhooks 1.

Note: `buildDeps` reads `identity.*` config keys once at boot, so a staff edit to `identity.freemail_domains` takes effect on restart. Acceptable for this slice; recorded here so Plan 1B can switch to per-request reads if it matters.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(api): candidate/company onboarding, admin queues and config, bounce webhook"
```

### Task 13: Seed script and README

**Files:**
- Create: `packages/db/src/seed.ts`, `README.md`

- [ ] **Step 1: Seed the 23 IITs**

`packages/db/src/seed.ts`:
```ts
import { createDb, schema } from "./index";
const IITS: Array<[string, string, string[], number]> = [
  ["IIT Bombay", "IITB", ["iitb.ac.in"], 1], ["IIT Delhi", "IITD", ["iitd.ac.in"], 1], ["IIT Madras", "IITM", ["smail.iitm.ac.in", "iitm.ac.in"], 1],
  ["IIT Kanpur", "IITK", ["iitk.ac.in"], 1], ["IIT Kharagpur", "IITKGP", ["kgpian.iitkgp.ac.in", "iitkgp.ac.in"], 1], ["IIT Roorkee", "IITR", ["iitr.ac.in"], 1],
  ["IIT Guwahati", "IITG", ["iitg.ac.in"], 1], ["IIT Hyderabad", "IITH", ["iith.ac.in"], 2], ["IIT (BHU) Varanasi", "IITBHU", ["itbhu.ac.in", "iitbhu.ac.in"], 2],
  ["IIT Indore", "IITI", ["iiti.ac.in"], 2], ["IIT Gandhinagar", "IITGN", ["iitgn.ac.in"], 2], ["IIT Ropar", "IITRPR", ["iitrpr.ac.in"], 2],
  ["IIT Mandi", "IITMandi", ["iitmandi.ac.in"], 2], ["IIT Jodhpur", "IITJ", ["iitj.ac.in"], 2], ["IIT Patna", "IITP", ["iitp.ac.in"], 2],
  ["IIT Bhubaneswar", "IITBBS", ["iitbbs.ac.in"], 2], ["IIT (ISM) Dhanbad", "IITISM", ["iitism.ac.in"], 2], ["IIT Tirupati", "IITTP", ["iittp.ac.in"], 3],
  ["IIT Palakkad", "IITPKD", ["iitpkd.ac.in"], 3], ["IIT Bhilai", "IITBH", ["iitbhilai.ac.in"], 3], ["IIT Goa", "IITGOA", ["iitgoa.ac.in"], 3],
  ["IIT Jammu", "IITJMU", ["iitjammu.ac.in"], 3], ["IIT Dharwad", "IITDH", ["iitdh.ac.in"], 3],
];
const { db, close } = createDb();
for (const [name, shortCode, emailDomains, internalTier] of IITS)
  await db.insert(schema.campus).values({ name, shortCode, emailDomains, internalTier }).onConflictDoNothing();
await close();
console.log("seeded", IITS.length, "campuses");
```
Add `"seed": "tsx src/seed.ts"` to `packages/db/package.json` scripts and `"db:seed"` at root.

- [ ] **Step 2: README**

```markdown
# Zenhyre 2.0

Spec: docs/superpowers/specs/2026-11-05-zenhyre-2-design.md

## Dev
pnpm install
pnpm test:db:start          # local Postgres 16 on :5433
export DATABASE_URL=postgres://zenhyre:zenhyre@localhost:5433/zenhyre
pnpm db:migrate && pnpm db:seed
pnpm -r build && pnpm test
pnpm --filter @zenhyre/api exec tsx src/index.ts   # API on :4000 (emails printed to memory transport when RESEND_API_KEY unset)
```

- [ ] **Step 3: Run seed against the dev DB, verify count**

Run: `pnpm db:migrate && pnpm db:seed && psql "$DATABASE_URL" -tc "select count(*) from campus"`
Expected: `23`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: seed 23 campuses, README"
```

---

## Done when

- `pnpm -r build && pnpm test` is green with the local test Postgres running.
- A student can sign in with an `@iitb.ac.in` magic link, register, edit their profile, and toggle openness via the API.
- An alumnus can sign in with Gmail, request verification for a campus, and a staff user can approve it from `/admin/reviews`.
- A founder can register a company on a work domain and invite a teammate who lands as `member`.
- Config keys from spec §17 are readable and editable by staff with audit rows.

**Next:** Plan 1B — `roles`, `gate`, `matching`, workflows (`submitRole`, `gateDecision`, `releaseTerms`, `acceptTerms`, `waiveDeposit`, `broadcastRole`, `applyToRole`, `freezeShortlist`, `companyAction`, `recordHire`, `didNotJoin`, `leftEarly`, `closeRole`), pg-boss jobs, pgvector.
