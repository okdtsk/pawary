# Pawary Plan 1: Foundation & Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running monorepo where a user can sign in with Google (or dev-login locally), get a secure session, and see a minimal authenticated app shell — with the complete D1 schema and test harness in place for all later plans.

**Architecture:** npm workspaces monorepo (`shared/`, `worker/`, `app/`). One Cloudflare Worker (Hono) serves `/api/*`; the React PWA (Vite) is served as static assets by the same Worker in production and via the Vite dev server (proxying `/api`) in development. D1 + Drizzle for data, cookie sessions (hashed tokens in D1), CSRF via per-session token.

**Tech Stack:** TypeScript, Hono 4, Drizzle ORM + drizzle-kit, D1, R2, jose (OIDC verification), ulidx, Zod, Vitest + @cloudflare/vitest-pool-workers, React 19, Vite 6, Tailwind CSS 4, TanStack Query 5, React Router 7.

**Spec:** `docs/superpowers/specs/2026-06-11-pawary-design.md` (read sections 2, 4, 6 before starting).

**Roadmap context:** This is plan 1 of 5. Later plans (Pets & Activities API; Frontend Core; Care & Analyzer; PWA & Polish) build on the schema, middleware, and test harness created here. The full DB schema for ALL plans is created in Task 4 — do not trim it.

**Conventions used throughout:**
- IDs are ULIDs (via `ulidx`). Timestamps are epoch milliseconds (`Date.now()`).
- API responses: success `{ data: ... }`, failure `{ error: { code, message } }`.
- Version numbers in package.json are minimums known-good at planning time; if `npm install` reports a conflict, take the latest compatible version — do not pin downward.
- Each task ends with a commit. Use the exact commit messages given.

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `tsconfig.base.json`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "pawary",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "worker", "app"],
  "scripts": {
    "dev": "concurrently -k -n worker,app -c yellow,cyan \"npm run dev -w worker\" \"npm run dev -w app\"",
    "build": "npm run build -w app",
    "test": "npm run test -w worker",
    "typecheck": "npm run typecheck -w worker && npm run typecheck -w app"
  },
  "devDependencies": {
    "concurrently": "^9.1.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
dist/
.wrangler/
.dev.vars
*.local
*.log
.DS_Store
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["esnext"],
    "skipLibCheck": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true
  }
}
```

- [ ] **Step 4: Install and verify**

Run: `npm install`
Expected: completes without errors; `node_modules/` appears. (Workspace dirs don't exist yet — npm tolerates this; if it errors, create empty `shared/ worker/ app/` dirs with `mkdir -p shared worker app` and placeholder `package.json`s per Tasks 2/3/11, or simply defer `npm install` to Step 4 of Task 2.)

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore tsconfig.base.json package-lock.json
git commit -m "chore: scaffold npm workspaces monorepo"
```

---

### Task 2: `shared/` package — constants, envelopes, base schemas

**Files:**
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/index.ts`

`shared/` is a source-only TypeScript package (no build step): both Vite and Wrangler compile it from source. It is the single source of truth for category names, locales, and request schemas used by both client and server.

- [ ] **Step 1: Create `shared/package.json`**

```json
{
  "name": "@pawary/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.24.0"
  }
}
```

- [ ] **Step 2: Create `shared/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 3: Create `shared/src/index.ts`**

```ts
import { z } from "zod";

export const LOCALES = ["system", "en", "ja"] as const;
export type Locale = (typeof LOCALES)[number];

export const CATEGORIES = [
  "food",
  "water",
  "toilet",
  "weight",
  "exercise",
  "symptom",
  "medication",
  "vet_visit",
  "grooming",
  "vaccination",
  "note",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const ROLES = ["owner", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export type ApiOk<T> = { data: T };
export type ApiErr = { error: { code: string; message: string } };

export const updateMeSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).optional(),
    locale: z.enum(LOCALES).optional(),
  })
  .strict();
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export type MeResponse = {
  user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
    locale: Locale;
  };
  pets: Array<{
    id: string;
    name: string;
    species: "dog" | "cat" | "other";
    avatarR2Key: string | null;
    role: Role;
  }>;
  csrfToken: string;
};
```

- [ ] **Step 4: Install and typecheck**

Run: `npm install && npm run typecheck -w shared`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add shared/ package-lock.json
git commit -m "feat: add shared package with categories, locales, and api types"
```

---

### Task 3: Worker skeleton + Vitest workers test harness

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/wrangler.jsonc`
- Create: `worker/src/env.ts`
- Create: `worker/src/index.ts`
- Create: `worker/vitest.config.ts`
- Create: `worker/test/env.d.ts`
- Test: `worker/test/health.test.ts`

- [ ] **Step 1: Create `worker/package.json`**

```json
{
  "name": "@pawary/worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate:local": "wrangler d1 migrations apply pawary --local"
  },
  "dependencies": {
    "@pawary/shared": "*",
    "drizzle-orm": "^0.44.0",
    "hono": "^4.7.0",
    "jose": "^6.0.0",
    "ulidx": "^2.4.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.0",
    "@cloudflare/workers-types": "^4.20250601.0",
    "drizzle-kit": "^0.31.0",
    "vitest": "~3.2.0",
    "wrangler": "^4.20.0"
  }
}
```

- [ ] **Step 2: Create `worker/wrangler.jsonc`**

No `assets` block yet — that arrives in Task 12 once `app/dist` exists.

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "pawary",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-01",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "pawary",
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "drizzle"
    }
  ],
  "r2_buckets": [{ "binding": "PHOTOS", "bucket_name": "pawary-photos" }],
  "vars": { "ENVIRONMENT": "development" },
  "observability": { "enabled": true }
}
```

(`database_id` is a placeholder — local dev and tests never contact the Cloudflare API. It gets a real ID at deploy time, outside this plan's scope.)

- [ ] **Step 3: Create `worker/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"]
  },
  "include": ["src", "test", "vitest.config.ts", "drizzle.config.ts"]
}
```

- [ ] **Step 4: Create `worker/src/env.ts`**

```ts
export type Env = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ENVIRONMENT: "development" | "production";
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
};
```

- [ ] **Step 5: Write the failing test `worker/test/health.test.ts`**

```ts
import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("GET /api/health returns ok envelope", async () => {
  const res = await SELF.fetch("https://app.local/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ data: { status: "ok" } });
});
```

- [ ] **Step 6: Create `worker/vitest.config.ts` and `worker/test/env.d.ts`**

```ts
// worker/vitest.config.ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
});
```

```ts
// worker/test/env.d.ts
import type { Env } from "../src/env";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm install && npm run test -w worker`
Expected: FAIL — `src/index.ts` does not exist / fetch returns error.

- [ ] **Step 8: Create `worker/src/index.ts` (minimal Hono app)**

```ts
import { Hono } from "hono";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ data: { status: "ok" } }));

export default app;
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm run test -w worker`
Expected: PASS (1 test).

- [ ] **Step 10: Commit**

```bash
git add worker/ package-lock.json
git commit -m "feat: add worker skeleton with hono and vitest workers harness"
```

---

### Task 4: Full D1 schema + migrations (covers ALL five plans)

**Files:**
- Create: `worker/src/db/schema.ts`
- Create: `worker/drizzle.config.ts`
- Create: `worker/drizzle/` (generated)
- Modify: `worker/vitest.config.ts`
- Modify: `worker/test/env.d.ts`
- Create: `worker/test/apply-migrations.ts`
- Test: `worker/test/schema.test.ts`

- [ ] **Step 1: Create `worker/src/db/schema.ts`**

This is the COMPLETE schema from spec §4 — later plans depend on every table here.
`createdBy`/`updatedBy`/`auditLog.userId` intentionally have NO foreign key: account
deletion (plan 2) removes the user row while shared pets' history must survive.

```ts
import { CATEGORIES } from "@pawary/shared";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  locale: text("locale", { enum: ["system", "en", "ja"] })
    .notNull()
    .default("system"),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  csrfToken: text("csrf_token").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
});

export const pets = sqliteTable("pets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  species: text("species", { enum: ["dog", "cat", "other"] }).notNull(),
  breed: text("breed"),
  sex: text("sex", { enum: ["male", "female", "unknown"] }),
  birthday: text("birthday"), // ISO date YYYY-MM-DD
  avatarR2Key: text("avatar_r2_key"),
  archivedAt: integer("archived_at"),
  createdAt: integer("created_at").notNull(),
});

export const petMembers = sqliteTable(
  "pet_members",
  {
    petId: text("pet_id")
      .notNull()
      .references(() => pets.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "editor", "viewer"] }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.petId, t.userId] })],
);

export const activities = sqliteTable(
  "activities",
  {
    id: text("id").primaryKey(),
    petId: text("pet_id")
      .notNull()
      .references(() => pets.id, { onDelete: "cascade" }),
    category: text("category", { enum: CATEGORIES }).notNull(),
    occurredAt: integer("occurred_at").notNull(),
    tzOffsetMin: integer("tz_offset_min").notNull(),
    memo: text("memo"),
    details: text("details", { mode: "json" }).notNull(),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    index("idx_activities_pet_time").on(t.petId, t.occurredAt),
    index("idx_activities_pet_cat_time").on(t.petId, t.category, t.occurredAt),
  ],
);

export const activityPhotos = sqliteTable("activity_photos", {
  id: text("id").primaryKey(),
  activityId: text("activity_id")
    .notNull()
    .references(() => activities.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull(),
  width: integer("width"),
  height: integer("height"),
  contentType: text("content_type").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const quickPresets = sqliteTable("quick_presets", {
  id: text("id").primaryKey(),
  petId: text("pet_id")
    .notNull()
    .references(() => pets.id, { onDelete: "cascade" }),
  category: text("category", { enum: CATEGORIES }).notNull(),
  label: text("label").notNull(),
  details: text("details", { mode: "json" }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const careSchedules = sqliteTable(
  "care_schedules",
  {
    id: text("id").primaryKey(),
    petId: text("pet_id")
      .notNull()
      .references(() => pets.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["medication", "vaccination", "vet_visit", "deworming", "grooming", "custom"],
    }).notNull(),
    name: text("name").notNull(),
    categoryLink: text("category_link", { enum: CATEGORIES }).notNull(),
    detailsTemplate: text("details_template", { mode: "json" }).notNull(),
    recurrenceUnit: text("recurrence_unit", {
      enum: ["once", "hour", "day", "week", "month"],
    }).notNull(),
    recurrenceN: integer("recurrence_n"),
    nextDueAt: integer("next_due_at").notNull(),
    endAt: integer("end_at"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_schedules_pet_active_due").on(t.petId, t.active, t.nextDueAt)],
);

export const petTargets = sqliteTable("pet_targets", {
  petId: text("pet_id")
    .primaryKey()
    .references(() => pets.id, { onDelete: "cascade" }),
  foodGPerDay: real("food_g_per_day"),
  waterMlPerDay: real("water_ml_per_day"),
});

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  petId: text("pet_id").notNull(),
  userId: text("user_id").notNull(),
  action: text("action", { enum: ["create", "update", "delete"] }).notNull(),
  entity: text("entity", {
    enum: ["activity", "pet", "schedule", "preset", "member"],
  }).notNull(),
  entityId: text("entity_id").notNull(),
  diff: text("diff", { mode: "json" }),
  createdAt: integer("created_at").notNull(),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Pet = typeof pets.$inferSelect;
export type PetMember = typeof petMembers.$inferSelect;
export type Activity = typeof activities.$inferSelect;
```

- [ ] **Step 2: Create `worker/drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate -w worker -- --name init`
Expected: `worker/drizzle/0000_init.sql` (plus `worker/drizzle/meta/`) created, containing `CREATE TABLE` statements for all 10 tables.

- [ ] **Step 4: Write the failing test `worker/test/schema.test.ts`**

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { petMembers, pets, users } from "../src/db/schema";

it("migrations create the schema; basic insert/select works", async () => {
  const db = drizzle(env.DB);
  const now = Date.now();
  await db.insert(users).values({
    id: "u_test",
    googleSub: "g_test",
    email: "pat@example.com",
    displayName: "Pat",
    createdAt: now,
  });
  await db.insert(pets).values({
    id: "p_test",
    name: "Momo",
    species: "cat",
    createdAt: now,
  });
  await db.insert(petMembers).values({
    petId: "p_test",
    userId: "u_test",
    role: "owner",
    createdAt: now,
  });

  const rows = await db.select().from(petMembers).all();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.role).toBe("owner");
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm run test -w worker`
Expected: FAIL — `no such table: users` (migrations not applied in tests yet).

- [ ] **Step 6: Wire migrations into the test harness**

Replace `worker/vitest.config.ts` with:

```ts
import path from "node:path";
import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "drizzle"));
  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              GOOGLE_CLIENT_ID: "test-client-id",
              GOOGLE_CLIENT_SECRET: "test-client-secret",
            },
          },
        },
      },
    },
  };
});
```

Create `worker/test/apply-migrations.ts`:

```ts
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

Replace `worker/test/env.d.ts` with:

```ts
import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";
import type { Env } from "../src/env";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
```

(If `D1Migration` is not exported from that path in the installed version, use
`type D1Migration = { name: string; queries: string[] }` locally — match whatever
`readD1Migrations` returns per the package's own types.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test -w worker`
Expected: PASS (health + schema tests). Each test gets isolated storage, so the insert does not leak.

- [ ] **Step 8: Apply migrations to the local dev database too**

Run: `npm run db:migrate:local -w worker`
Expected: `1 migration applied` (creates `.wrangler/state` local SQLite).

- [ ] **Step 9: Commit**

```bash
git add worker/src/db/ worker/drizzle.config.ts worker/drizzle/ worker/vitest.config.ts worker/test/
git commit -m "feat: add complete d1 schema with drizzle migrations and test wiring"
```

---

### Task 5: Error envelope, 404/500 handling, security headers

**Files:**
- Create: `worker/src/lib/respond.ts`
- Create: `worker/src/middleware/headers.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/app-shell.test.ts`

- [ ] **Step 1: Write the failing test `worker/test/app-shell.test.ts`**

```ts
import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("sets security headers on every response", async () => {
  const res = await SELF.fetch("https://app.local/api/health");
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
});

it("returns a json error envelope for unknown api routes", async () => {
  const res = await SELF.fetch("https://app.local/api/nope");
  expect(res.status).toBe(404);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("not_found");
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test -w worker`
Expected: both new tests FAIL (headers missing; 404 is plain text).

- [ ] **Step 3: Create `worker/src/lib/respond.ts`**

```ts
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function err(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
) {
  return c.json({ error: { code, message } }, status);
}
```

- [ ] **Step 4: Create `worker/src/middleware/headers.ts`**

`style-src 'unsafe-inline'` is required because React inline `style` attributes
(used by chart libraries later) are governed by style-src. Script stays `'self'`.
Google avatar images are allowed explicitly.

```ts
import { createMiddleware } from "hono/factory";
import type { Env } from "../env";

export const securityHeaders = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: https://lh3.googleusercontent.com; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    if (c.env.ENVIRONMENT === "production") {
      c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  },
);
```

- [ ] **Step 5: Update `worker/src/index.ts`**

```ts
import { Hono } from "hono";
import type { Env } from "./env";
import { err } from "./lib/respond";
import { securityHeaders } from "./middleware/headers";

const app = new Hono<{ Bindings: Env }>();

app.use("*", securityHeaders);

app.get("/api/health", (c) => c.json({ data: { status: "ok" } }));

app.notFound((c) => err(c, 404, "not_found", "Not found"));
app.onError((e, c) => {
  console.error("unhandled error", e);
  return err(c, 500, "internal", "Internal server error");
});

export default app;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -w worker`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add worker/src/ worker/test/app-shell.test.ts
git commit -m "feat: add error envelope, json 404/500, and security headers"
```

---

### Task 6: ID, crypto, and session domain logic

**Files:**
- Create: `worker/src/lib/id.ts`
- Create: `worker/src/lib/crypto.ts`
- Create: `worker/src/domain/sessions.ts`
- Test: `worker/test/crypto.test.ts`
- Test: `worker/test/sessions.test.ts`

- [ ] **Step 1: Write the failing test `worker/test/crypto.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { constantTimeEqual, generateToken, sha256Hex } from "../src/lib/crypto";

describe("generateToken", () => {
  it("returns a 43-char base64url string, unique per call", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
});

describe("sha256Hex", () => {
  it("hashes deterministically to 64 hex chars", async () => {
    const h1 = await sha256Hex("hello");
    const h2 = await sha256Hex("hello");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});

describe("constantTimeEqual", () => {
  it("compares correctly", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "ab")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w worker`
Expected: FAIL — module `../src/lib/crypto` not found.

- [ ] **Step 3: Create `worker/src/lib/id.ts` and `worker/src/lib/crypto.ts`**

```ts
// worker/src/lib/id.ts
import { ulid } from "ulidx";

export function newId(): string {
  return ulid();
}
```

```ts
// worker/src/lib/crypto.ts
function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Base64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return base64url(new Uint8Array(digest));
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
```

- [ ] **Step 4: Run crypto tests to verify they pass**

Run: `npm run test -w worker`
Expected: PASS.

- [ ] **Step 5: Write the failing test `worker/test/sessions.test.ts`**

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import {
  SESSION_ABSOLUTE_MAX_MS,
  SESSION_REFRESH_INTERVAL_MS,
  SESSION_TTL_MS,
  createSession,
  deleteSessionByToken,
  getValidSession,
} from "../src/domain/sessions";
import { users } from "../src/db/schema";

async function seedUser(db: ReturnType<typeof drizzle>) {
  await db.insert(users).values({
    id: "u1",
    googleSub: "g1",
    email: "pat@example.com",
    displayName: "Pat",
    createdAt: Date.now(),
  });
}

it("createSession + getValidSession round-trips", async () => {
  const db = drizzle(env.DB);
  await seedUser(db);
  const { token, csrfToken } = await createSession(db, "u1");
  const session = await getValidSession(db, token, Date.now());
  expect(session?.userId).toBe("u1");
  expect(session?.csrfToken).toBe(csrfToken);
});

it("rejects an unknown token", async () => {
  const db = drizzle(env.DB);
  expect(await getValidSession(db, "bogus", Date.now())).toBeNull();
});

it("rejects and deletes an expired session", async () => {
  const db = drizzle(env.DB);
  await seedUser(db);
  const { token } = await createSession(db, "u1");
  const later = Date.now() + SESSION_TTL_MS + 1;
  expect(await getValidSession(db, token, later)).toBeNull();
  // also gone for a subsequent valid-time lookup
  expect(await getValidSession(db, token, Date.now())).toBeNull();
});

it("enforces the 90-day absolute cap even with refreshes", async () => {
  const db = drizzle(env.DB);
  await seedUser(db);
  const { token } = await createSession(db, "u1");
  // refresh near the cap keeps it alive...
  const nearCap = Date.now() + SESSION_ABSOLUTE_MAX_MS - 1000;
  // ...but lookups past created_at + cap always fail
  const pastCap = Date.now() + SESSION_ABSOLUTE_MAX_MS + 1000;
  expect(await getValidSession(db, token, pastCap)).toBeNull();
  void nearCap;
});

it("slides expiry forward when used after the refresh interval", async () => {
  const db = drizzle(env.DB);
  await seedUser(db);
  const { token } = await createSession(db, "u1");
  const t1 = Date.now() + SESSION_REFRESH_INTERVAL_MS + 1000;
  const refreshed = await getValidSession(db, token, t1);
  expect(refreshed).not.toBeNull();
  // still valid at a time that would have been past the original expiry
  const t2 = t1 + SESSION_TTL_MS - 1000;
  expect(await getValidSession(db, token, t2)).not.toBeNull();
});

it("deleteSessionByToken revokes", async () => {
  const db = drizzle(env.DB);
  await seedUser(db);
  const { token } = await createSession(db, "u1");
  await deleteSessionByToken(db, token);
  expect(await getValidSession(db, token, Date.now())).toBeNull();
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm run test -w worker`
Expected: FAIL — module `../src/domain/sessions` not found.

- [ ] **Step 7: Create `worker/src/domain/sessions.ts`**

```ts
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { sessions, type Session } from "../db/schema";
import { generateToken, sha256Hex } from "../lib/crypto";
import { newId } from "../lib/id";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, sliding
export const SESSION_ABSOLUTE_MAX_MS = 90 * 24 * 60 * 60 * 1000; // hard cap
export const SESSION_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // refresh at most hourly

export async function createSession(
  db: DrizzleD1Database,
  userId: string,
): Promise<{ token: string; csrfToken: string }> {
  const token = generateToken();
  const csrfToken = generateToken();
  const now = Date.now();
  await db.insert(sessions).values({
    id: newId(),
    tokenHash: await sha256Hex(token),
    csrfToken,
    userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    lastSeenAt: now,
  });
  return { token, csrfToken };
}

export async function getValidSession(
  db: DrizzleD1Database,
  token: string,
  now: number,
): Promise<Session | null> {
  const tokenHash = await sha256Hex(token);
  const session = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .get();
  if (!session) return null;

  const expired =
    session.expiresAt < now || now - session.createdAt > SESSION_ABSOLUTE_MAX_MS;
  if (expired) {
    await db.delete(sessions).where(eq(sessions.id, session.id));
    return null;
  }

  if (now - session.lastSeenAt > SESSION_REFRESH_INTERVAL_MS) {
    const expiresAt = Math.min(
      now + SESSION_TTL_MS,
      session.createdAt + SESSION_ABSOLUTE_MAX_MS,
    );
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt })
      .where(eq(sessions.id, session.id));
    session.lastSeenAt = now;
    session.expiresAt = expiresAt;
  }
  return session;
}

export async function deleteSessionByToken(
  db: DrizzleD1Database,
  token: string,
): Promise<void> {
  const tokenHash = await sha256Hex(token);
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test -w worker`
Expected: PASS (all tests).

- [ ] **Step 9: Commit**

```bash
git add worker/src/lib/ worker/src/domain/ worker/test/crypto.test.ts worker/test/sessions.test.ts
git commit -m "feat: add token crypto and session domain logic with sliding expiry"
```

---

### Task 7: Session middleware + `GET /api/me`

**Files:**
- Create: `worker/src/lib/cookies.ts`
- Create: `worker/src/middleware/session.ts`
- Create: `worker/src/routes/me.ts`
- Modify: `worker/src/env.ts`
- Modify: `worker/src/index.ts`
- Create: `worker/test/helpers.ts`
- Test: `worker/test/me.test.ts`

- [ ] **Step 1: Create `worker/test/helpers.ts`** (used by every authenticated test from now on)

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { users } from "../src/db/schema";
import { createSession } from "../src/domain/sessions";
import { newId } from "../src/lib/id";

export async function seedUserWithSession(
  overrides: { email?: string; displayName?: string } = {},
): Promise<{
  userId: string;
  cookie: string;
  csrfToken: string;
}> {
  const db = drizzle(env.DB);
  const userId = newId();
  await db.insert(users).values({
    id: userId,
    googleSub: `g_${userId}`,
    email: overrides.email ?? "pat@example.com",
    displayName: overrides.displayName ?? "Pat",
    createdAt: Date.now(),
  });
  const { token, csrfToken } = await createSession(db, userId);
  return { userId, cookie: `session=${token}`, csrfToken };
}
```

- [ ] **Step 2: Write the failing test `worker/test/me.test.ts`**

```ts
import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";
import { seedUserWithSession } from "./helpers";

it("returns 401 without a session cookie", async () => {
  const res = await SELF.fetch("https://app.local/api/me");
  expect(res.status).toBe(401);
});

it("returns 401 for a garbage session cookie", async () => {
  const res = await SELF.fetch("https://app.local/api/me", {
    headers: { Cookie: "session=not-a-real-token" },
  });
  expect(res.status).toBe(401);
});

it("returns the user, empty pets, and a csrf token with a valid session", async () => {
  const { cookie, csrfToken } = await seedUserWithSession();
  const res = await SELF.fetch("https://app.local/api/me", {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    data: { user: { email: string }; pets: unknown[]; csrfToken: string };
  };
  expect(body.data.user.email).toBe("pat@example.com");
  expect(body.data.pets).toEqual([]);
  expect(body.data.csrfToken).toBe(csrfToken);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test -w worker`
Expected: new tests FAIL (404 on /api/me — route doesn't exist; note 404 ≠ expected 401, that's fine, they fail).

- [ ] **Step 4: Create `worker/src/lib/cookies.ts`**

In production the cookie is `__Host-session` (requires Secure + Path=/ + no Domain).
In development it's plain `session` so it works over `http://localhost` in all browsers.

```ts
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "../env";
import { SESSION_TTL_MS } from "../domain/sessions";

type AppCtx = Context<{ Bindings: Env }>;

export function sessionCookieName(env: Env): string {
  return env.ENVIRONMENT === "production" ? "__Host-session" : "session";
}

export function setSessionCookie(c: AppCtx, token: string): void {
  setCookie(c, sessionCookieName(c.env), token, {
    httpOnly: true,
    secure: c.env.ENVIRONMENT === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function getSessionToken(c: AppCtx): string | undefined {
  return getCookie(c, sessionCookieName(c.env));
}

export function clearSessionCookie(c: AppCtx): void {
  deleteCookie(c, sessionCookieName(c.env), { path: "/" });
}
```

- [ ] **Step 5: Add the app context type to `worker/src/env.ts`**

```ts
import type { Session, User } from "./db/schema";

export type Env = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ENVIRONMENT: "development" | "production";
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: User;
    session: Session;
  };
};
```

- [ ] **Step 6: Create `worker/src/middleware/session.ts`**

```ts
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createMiddleware } from "hono/factory";
import { users } from "../db/schema";
import { getValidSession } from "../domain/sessions";
import type { AppEnv } from "../env";
import { getSessionToken } from "../lib/cookies";
import { err } from "../lib/respond";

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = getSessionToken(c);
  if (!token) return err(c, 401, "unauthorized", "Sign in required");

  const db = drizzle(c.env.DB);
  const session = await getValidSession(db, token, Date.now());
  if (!session) return err(c, 401, "unauthorized", "Sign in required");

  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .get();
  if (!user) return err(c, 401, "unauthorized", "Sign in required");

  c.set("session", session);
  c.set("user", user);
  await next();
});
```

- [ ] **Step 7: Create `worker/src/routes/me.ts`**

```ts
import type { MeResponse } from "@pawary/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { petMembers, pets } from "../db/schema";
import type { AppEnv } from "../env";
import { requireSession } from "../middleware/session";

export const meRoutes = new Hono<AppEnv>();

meRoutes.get("/", requireSession, async (c) => {
  const user = c.get("user");
  const session = c.get("session");
  const db = drizzle(c.env.DB);

  const memberships = await db
    .select({
      id: pets.id,
      name: pets.name,
      species: pets.species,
      avatarR2Key: pets.avatarR2Key,
      role: petMembers.role,
    })
    .from(petMembers)
    .innerJoin(pets, eq(petMembers.petId, pets.id))
    .where(eq(petMembers.userId, user.id))
    .all();

  const data: MeResponse = {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      locale: user.locale,
    },
    pets: memberships,
    csrfToken: session.csrfToken,
  };
  return c.json({ data });
});
```

- [ ] **Step 8: Mount in `worker/src/index.ts`**

```ts
import { Hono } from "hono";
import type { Env } from "./env";
import { err } from "./lib/respond";
import { securityHeaders } from "./middleware/headers";
import { meRoutes } from "./routes/me";

const app = new Hono<{ Bindings: Env }>();

app.use("*", securityHeaders);

app.get("/api/health", (c) => c.json({ data: { status: "ok" } }));
app.route("/api/me", meRoutes);

app.notFound((c) => err(c, 404, "not_found", "Not found"));
app.onError((e, c) => {
  console.error("unhandled error", e);
  return err(c, 500, "internal", "Internal server error");
});

export default app;
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm run test -w worker`
Expected: PASS (all tests).

- [ ] **Step 10: Commit**

```bash
git add worker/src/ worker/test/
git commit -m "feat: add session middleware and GET /api/me"
```

---

### Task 8: CSRF middleware + `PATCH /api/me`

**Files:**
- Create: `worker/src/middleware/csrf.ts`
- Modify: `worker/src/routes/me.ts`
- Test: `worker/test/me.test.ts` (extend)

- [ ] **Step 1: Extend `worker/test/me.test.ts` with failing tests**

Append:

```ts
it("PATCH /api/me rejects without csrf header", async () => {
  const { cookie } = await seedUserWithSession();
  const res = await SELF.fetch("https://app.local/api/me", {
    method: "PATCH",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ locale: "ja" }),
  });
  expect(res.status).toBe(403);
});

it("PATCH /api/me updates locale and display name with csrf header", async () => {
  const { cookie, csrfToken } = await seedUserWithSession();
  const res = await SELF.fetch("https://app.local/api/me", {
    method: "PATCH",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ locale: "ja", displayName: "Pat T" }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    data: { user: { locale: string; displayName: string } };
  };
  expect(body.data.user.locale).toBe("ja");
  expect(body.data.user.displayName).toBe("Pat T");
});

it("PATCH /api/me rejects unknown fields", async () => {
  const { cookie, csrfToken } = await seedUserWithSession();
  const res = await SELF.fetch("https://app.local/api/me", {
    method: "PATCH",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ isAdmin: true }),
  });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npm run test -w worker`
Expected: new tests FAIL (404 — PATCH route doesn't exist).

- [ ] **Step 3: Create `worker/src/middleware/csrf.ts`**

```ts
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { constantTimeEqual } from "../lib/crypto";
import { err } from "../lib/respond";

/** Must run AFTER requireSession (relies on c.get("session")). */
export const requireCsrf = createMiddleware<AppEnv>(async (c, next) => {
  const session = c.get("session");
  const header = c.req.header("X-CSRF-Token");
  if (!header || !constantTimeEqual(header, session.csrfToken)) {
    return err(c, 403, "csrf_invalid", "Invalid or missing CSRF token");
  }
  await next();
});
```

- [ ] **Step 4: Add the PATCH handler to `worker/src/routes/me.ts`**

Append (and add imports for `updateMeSchema` from `@pawary/shared`, `users` from `../db/schema`, `requireCsrf` from `../middleware/csrf`, `err` from `../lib/respond`):

```ts
meRoutes.patch("/", requireSession, requireCsrf, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateMeSchema.safeParse(body);
  if (!parsed.success) {
    return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const user = c.get("user");
  const db = drizzle(c.env.DB);
  await db.update(users).set(parsed.data).where(eq(users.id, user.id));
  const updated = { ...user, ...parsed.data };
  return c.json({
    data: {
      user: {
        id: updated.id,
        email: updated.email,
        displayName: updated.displayName,
        avatarUrl: updated.avatarUrl,
        locale: updated.locale,
      },
    },
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w worker`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add worker/src/ worker/test/me.test.ts
git commit -m "feat: add csrf middleware and PATCH /api/me"
```

---

### Task 9: Google OAuth (PKCE) + logout

**Files:**
- Create: `worker/src/lib/oauth.ts`
- Create: `worker/src/domain/users.ts`
- Create: `worker/src/routes/auth.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/oauth.test.ts`

- [ ] **Step 1: Write the failing test `worker/test/oauth.test.ts`**

Note on mocking: `fetchMock` (from `cloudflare:test`) intercepts the Worker's
outbound fetches to Google. We sign a real RS256 id_token with a test key and
serve the matching JWKS. The JWKS module-level cache means only THIS test may
perform OIDC verification via SELF — fine within this file.

```ts
import { fetchMock, SELF } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, expect, it } from "vitest";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

it("GET /api/auth/google redirects to Google with state + PKCE", async () => {
  const res = await SELF.fetch("https://app.local/api/auth/google", {
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.get("Location")!);
  expect(loc.origin).toBe("https://accounts.google.com");
  expect(loc.searchParams.get("client_id")).toBe("test-client-id");
  expect(loc.searchParams.get("redirect_uri")).toBe(
    "https://app.local/api/auth/google/callback",
  );
  expect(loc.searchParams.get("state")).toBeTruthy();
  expect(loc.searchParams.get("code_challenge")).toBeTruthy();
  expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
  expect(res.headers.get("Set-Cookie")).toContain("oauth_state=");
});

it("callback rejects a mismatched state", async () => {
  const start = await SELF.fetch("https://app.local/api/auth/google", {
    redirect: "manual",
  });
  const stateCookie = start.headers.get("Set-Cookie")!.split(";")[0]!;
  const res = await SELF.fetch(
    "https://app.local/api/auth/google/callback?code=abc&state=WRONG",
    { headers: { Cookie: stateCookie }, redirect: "manual" },
  );
  expect(res.status).toBe(400);
});

it("completes the full flow: callback sets a session; /api/me works; logout revokes", async () => {
  // 1. start: capture state + cookie
  const start = await SELF.fetch("https://app.local/api/auth/google", {
    redirect: "manual",
  });
  const loc = new URL(start.headers.get("Location")!);
  const state = loc.searchParams.get("state")!;
  const stateCookie = start.headers.get("Set-Cookie")!.split(";")[0]!;

  // 2. mock Google: token endpoint returns a signed id_token; JWKS serves the key
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const idToken = await new SignJWT({
    email: "pat@example.com",
    name: "Pat",
    picture: "https://lh3.googleusercontent.com/x",
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setSubject("google-sub-1")
    .setIssuer("https://accounts.google.com")
    .setAudience("test-client-id")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);

  fetchMock
    .get("https://oauth2.googleapis.com")
    .intercept({ method: "POST", path: "/token" })
    .reply(200, JSON.stringify({ id_token: idToken }), {
      headers: { "Content-Type": "application/json" },
    });
  fetchMock
    .get("https://www.googleapis.com")
    .intercept({ path: "/oauth2/v3/certs" })
    .reply(200, JSON.stringify({ keys: [jwk] }), {
      headers: { "Content-Type": "application/json" },
    });

  // 3. callback → session cookie + redirect to /
  const cb = await SELF.fetch(
    `https://app.local/api/auth/google/callback?code=test-code&state=${state}`,
    { headers: { Cookie: stateCookie }, redirect: "manual" },
  );
  expect(cb.status).toBe(302);
  expect(cb.headers.get("Location")).toBe("/");
  const setCookies = cb.headers.getSetCookie();
  const sessionSet = setCookies.find((v) => v.startsWith("session="));
  expect(sessionSet).toBeTruthy();
  const sessionCookie = sessionSet!.split(";")[0]!;

  // 4. session works
  const me = await SELF.fetch("https://app.local/api/me", {
    headers: { Cookie: sessionCookie },
  });
  expect(me.status).toBe(200);
  const meBody = (await me.json()) as {
    data: { user: { email: string }; csrfToken: string };
  };
  expect(meBody.data.user.email).toBe("pat@example.com");

  // 5. logout revokes
  const out = await SELF.fetch("https://app.local/api/auth/logout", {
    method: "POST",
    headers: { Cookie: sessionCookie, "X-CSRF-Token": meBody.data.csrfToken },
  });
  expect(out.status).toBe(200);
  const meAfter = await SELF.fetch("https://app.local/api/me", {
    headers: { Cookie: sessionCookie },
  });
  expect(meAfter.status).toBe(401);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w worker`
Expected: new tests FAIL (404 — auth routes don't exist).

- [ ] **Step 3: Create `worker/src/lib/oauth.ts`**

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";
import { generateToken, sha256Base64url } from "./crypto";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

// Cached across requests within an isolate; jose refreshes keys as needed.
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export async function generatePkce(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const verifier = generateToken(); // 43-char base64url — valid PKCE verifier
  const challenge = await sha256Base64url(verifier);
  return { verifier, challenge };
}

export function buildAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ idToken: string }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
      code_verifier: params.codeVerifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: ${res.status}`);
  }
  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) throw new Error("token response missing id_token");
  return { idToken: json.id_token };
}

export type GoogleClaims = {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
};

export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
): Promise<GoogleClaims> {
  jwks ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
  });
  if (!payload.sub) throw new Error("id_token missing sub");
  const email = typeof payload.email === "string" ? payload.email : "";
  return {
    sub: payload.sub,
    email,
    name: typeof payload.name === "string" ? payload.name : email || "User",
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}
```

- [ ] **Step 4: Create `worker/src/domain/users.ts`**

```ts
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { users, type User } from "../db/schema";
import { newId } from "../lib/id";
import type { GoogleClaims } from "../lib/oauth";

export async function upsertUserFromGoogle(
  db: DrizzleD1Database,
  claims: GoogleClaims,
): Promise<User> {
  const row = await db
    .insert(users)
    .values({
      id: newId(),
      googleSub: claims.sub,
      email: claims.email,
      displayName: claims.name,
      avatarUrl: claims.picture,
      createdAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: users.googleSub,
      set: {
        email: claims.email,
        avatarUrl: claims.picture,
      },
    })
    .returning()
    .get();
  return row;
}
```

(On conflict we refresh email/avatar but NOT displayName — the user may have
customized it via PATCH /api/me.)

- [ ] **Step 5: Create `worker/src/routes/auth.ts`**

```ts
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createSession, deleteSessionByToken } from "../domain/sessions";
import { upsertUserFromGoogle } from "../domain/users";
import type { AppEnv } from "../env";
import {
  clearSessionCookie,
  getSessionToken,
  setSessionCookie,
} from "../lib/cookies";
import { constantTimeEqual } from "../lib/crypto";
import { generateToken } from "../lib/crypto";
import {
  buildAuthUrl,
  exchangeCode,
  generatePkce,
  verifyGoogleIdToken,
} from "../lib/oauth";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requireSession } from "../middleware/session";

export const authRoutes = new Hono<AppEnv>();

const STATE_COOKIE = "oauth_state";

function redirectUri(requestUrl: string): string {
  const url = new URL(requestUrl);
  return `${url.origin}/api/auth/google/callback`;
}

authRoutes.get("/google", async (c) => {
  const state = generateToken();
  const { verifier, challenge } = await generatePkce();
  setCookie(c, STATE_COOKIE, JSON.stringify({ state, verifier }), {
    httpOnly: true,
    secure: c.env.ENVIRONMENT === "production",
    sameSite: "Lax",
    path: "/api/auth",
    maxAge: 600,
  });
  return c.redirect(
    buildAuthUrl({
      clientId: c.env.GOOGLE_CLIENT_ID,
      redirectUri: redirectUri(c.req.url),
      state,
      codeChallenge: challenge,
    }),
  );
});

authRoutes.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const raw = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/api/auth" });

  if (!code || !state || !raw) {
    return err(c, 400, "oauth_invalid", "Missing OAuth parameters");
  }
  let saved: { state: string; verifier: string };
  try {
    saved = JSON.parse(raw) as { state: string; verifier: string };
  } catch {
    return err(c, 400, "oauth_invalid", "Malformed OAuth state");
  }
  if (!constantTimeEqual(saved.state, state)) {
    return err(c, 400, "oauth_invalid", "OAuth state mismatch");
  }

  const { idToken } = await exchangeCode({
    code,
    clientId: c.env.GOOGLE_CLIENT_ID,
    clientSecret: c.env.GOOGLE_CLIENT_SECRET,
    redirectUri: redirectUri(c.req.url),
    codeVerifier: saved.verifier,
  });
  const claims = await verifyGoogleIdToken(idToken, c.env.GOOGLE_CLIENT_ID);

  const db = drizzle(c.env.DB);
  const user = await upsertUserFromGoogle(db, claims);
  const { token } = await createSession(db, user.id);
  setSessionCookie(c, token);
  return c.redirect("/");
});

authRoutes.post("/logout", requireSession, requireCsrf, async (c) => {
  const token = getSessionToken(c);
  if (token) {
    await deleteSessionByToken(drizzle(c.env.DB), token);
  }
  clearSessionCookie(c);
  return c.json({ data: { ok: true } });
});
```

- [ ] **Step 6: Mount in `worker/src/index.ts`**

Add to imports and routes:

```ts
import { authRoutes } from "./routes/auth";
// ...
app.route("/api/auth", authRoutes);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test -w worker`
Expected: PASS (all tests). If the JWKS fetch happens more than once, jose's cache was bypassed — check that `jwks` is module-level, not per-request.

- [ ] **Step 8: Commit**

```bash
git add worker/src/ worker/test/oauth.test.ts
git commit -m "feat: add google oauth with pkce, session issuance, and logout"
```

---

### Task 10: Dev-login (localhost development only)

**Files:**
- Modify: `worker/src/routes/auth.ts`
- Test: `worker/test/dev-login.test.ts`

- [ ] **Step 1: Write the failing test `worker/test/dev-login.test.ts`**

```ts
import {
  createExecutionContext,
  env,
  SELF,
  waitOnExecutionContext,
} from "cloudflare:test";
import { expect, it } from "vitest";
import app from "../src/index";

it("dev-login works on localhost in development", async () => {
  const res = await SELF.fetch("http://localhost/api/auth/dev-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "dev@example.com", name: "Dev" }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .find((v) => v.startsWith("session="));
  expect(cookie).toBeTruthy();

  const me = await SELF.fetch("http://localhost/api/me", {
    headers: { Cookie: cookie!.split(";")[0]! },
  });
  expect(me.status).toBe(200);
});

it("dev-login is 404 on non-localhost hosts even in development", async () => {
  const res = await SELF.fetch("https://app.local/api/auth/dev-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(404);
});

it("dev-login is 404 in production environment", async () => {
  const ctx = createExecutionContext();
  const res = await app.fetch(
    new Request("http://localhost/api/auth/dev-login", { method: "POST" }),
    { ...env, ENVIRONMENT: "production" as const },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w worker`
Expected: new tests FAIL (first test 404s).

- [ ] **Step 3: Add the handler to `worker/src/routes/auth.ts`**

The guard is a runtime check (environment + hostname), which behaves identically
to conditional registration and is directly testable with an env override.

```ts
authRoutes.post("/dev-login", async (c) => {
  const host = new URL(c.req.url).hostname;
  const isLocalhost = host === "localhost" || host === "127.0.0.1";
  if (c.env.ENVIRONMENT !== "development" || !isLocalhost) {
    return err(c, 404, "not_found", "Not found");
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    name?: string;
  };
  const email = body.email ?? "dev@example.com";
  const name = body.name ?? "Dev User";

  const db = drizzle(c.env.DB);
  const user = await upsertUserFromGoogle(db, {
    sub: `dev:${email}`,
    email,
    name,
    picture: null,
  });
  const { token } = await createSession(db, user.id);
  setSessionCookie(c, token);
  return c.json({ data: { ok: true } });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w worker`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/auth.ts worker/test/dev-login.test.ts
git commit -m "feat: add localhost-only dev-login with production 404 guard"
```

---

### Task 11: Frontend scaffold — login screen + authenticated shell + i18n

**Files:**
- Create: `app/package.json`
- Create: `app/tsconfig.json`
- Create: `app/vite.config.ts`
- Create: `app/index.html`
- Create: `app/src/main.tsx`
- Create: `app/src/App.tsx`
- Create: `app/src/index.css`
- Create: `app/src/api/client.ts`
- Create: `app/src/api/me.ts`
- Create: `app/src/i18n/messages.ts`
- Create: `app/src/i18n/en.ts`
- Create: `app/src/i18n/ja.ts`
- Create: `app/src/i18n/index.tsx`
- Create: `app/src/routes/Login.tsx`
- Create: `app/src/routes/Shell.tsx`

This task is scaffolding (no test framework on the frontend yet); verification is typecheck + build + manual smoke. Real screens come in Plan 3 with the frontend-design skill — keep this intentionally minimal.

- [ ] **Step 1: Create `app/package.json`**

```json
{
  "name": "@pawary/app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@pawary/shared": "*",
    "@tanstack/react-query": "^5.66.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router": "^7.1.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0",
    "vite": "^6.1.0"
  }
}
```

- [ ] **Step 2: Create `app/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["esnext", "dom", "dom.iterable"],
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 3: Create `app/vite.config.ts` and `app/index.html`**

```ts
// app/vite.config.ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { "/api": "http://localhost:8787" },
  },
});
```

```html
<!-- app/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#f59e0b" />
    <title>Pawary</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create `app/src/index.css`**

```css
@import "tailwindcss";

@theme {
  --color-warm-50: #fdf8f3;
  --color-warm-100: #faeee0;
  --color-warm-500: #f59e0b;
  --color-warm-600: #d97706;
  --color-warm-900: #451a03;
}
```

- [ ] **Step 5: Create the API client `app/src/api/client.ts`**

```ts
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const method = init.method ?? "GET";
  if (method !== "GET") {
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
    if (init.body) headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  const body = (await res.json().catch(() => null)) as
    | { data?: T; error?: { code: string; message: string } }
    | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error?.code ?? "unknown",
      body?.error?.message ?? "Request failed",
    );
  }
  return body!.data as T;
}
```

- [ ] **Step 6: Create `app/src/api/me.ts`**

```ts
import type { MeResponse } from "@pawary/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, setCsrfToken } from "./client";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const me = await api<MeResponse>("/api/me");
      setCsrfToken(me.csrfToken);
      return me;
    },
    retry: (count, error) =>
      !(error instanceof ApiError && error.status === 401) && count < 2,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await api("/api/auth/logout", { method: "POST" });
    await qc.invalidateQueries({ queryKey: ["me"] });
  };
}
```

- [ ] **Step 7: Create the i18n layer**

```ts
// app/src/i18n/messages.ts
export interface Messages {
  appName: string;
  tagline: string;
  signInWithGoogle: string;
  signInDev: string;
  logout: string;
  loading: string;
  greeting: (name: string) => string;
  comingSoon: string;
}
```

```ts
// app/src/i18n/en.ts
import type { Messages } from "./messages";

export const en: Messages = {
  appName: "Pawary",
  tagline: "Your pet's daily life and health, in one place",
  signInWithGoogle: "Sign in with Google",
  signInDev: "Dev sign-in (local)",
  logout: "Sign out",
  loading: "Loading…",
  greeting: (name) => `Hello, ${name}!`,
  comingSoon: "Your pet's dashboard is coming soon.",
};
```

```ts
// app/src/i18n/ja.ts
import type { Messages } from "./messages";

export const ja: Messages = {
  appName: "Pawary",
  tagline: "ペットの毎日と健康を、ひとつの場所に",
  signInWithGoogle: "Google でサインイン",
  signInDev: "開発用サインイン（ローカル）",
  logout: "サインアウト",
  loading: "読み込み中…",
  greeting: (name) => `こんにちは、${name}さん！`,
  comingSoon: "ペットのダッシュボードは準備中です。",
};
```

```tsx
// app/src/i18n/index.tsx
import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "@pawary/shared";
import { en } from "./en";
import { ja } from "./ja";
import type { Messages } from "./messages";

const catalogs: Record<"en" | "ja", Messages> = { en, ja };

function resolveLocale(setting: Locale | undefined): "en" | "ja" {
  if (setting === "en" || setting === "ja") return setting;
  return navigator.language.toLowerCase().startsWith("ja") ? "ja" : "en";
}

const I18nContext = createContext<Messages>(en);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale | undefined;
  children: ReactNode;
}) {
  return (
    <I18nContext.Provider value={catalogs[resolveLocale(locale)]}>
      {children}
    </I18nContext.Provider>
  );
}

export function useT(): Messages {
  return useContext(I18nContext);
}
```

- [ ] **Step 8: Create login + shell screens**

```tsx
// app/src/routes/Login.tsx
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useT } from "../i18n";

export function Login() {
  const t = useT();
  const qc = useQueryClient();

  const devLogin = async () => {
    await api("/api/auth/dev-login", {
      method: "POST",
      body: JSON.stringify({}),
    });
    await qc.invalidateQueries({ queryKey: ["me"] });
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-warm-50 p-6">
      <div className="text-6xl">🐾</div>
      <h1 className="text-3xl font-bold text-warm-900">{t.appName}</h1>
      <p className="text-warm-900/70">{t.tagline}</p>
      <a
        href="/api/auth/google"
        className="rounded-full bg-warm-500 px-6 py-3 font-semibold text-white shadow hover:bg-warm-600"
      >
        {t.signInWithGoogle}
      </a>
      {import.meta.env.DEV && (
        <button
          type="button"
          onClick={devLogin}
          className="text-sm text-warm-600 underline"
        >
          {t.signInDev}
        </button>
      )}
    </main>
  );
}
```

```tsx
// app/src/routes/Shell.tsx
import type { MeResponse } from "@pawary/shared";
import { useLogout } from "../api/me";
import { useT } from "../i18n";

export function Shell({ me }: { me: MeResponse }) {
  const t = useT();
  const logout = useLogout();

  return (
    <div className="min-h-dvh bg-warm-50">
      <header className="flex items-center justify-between border-b border-warm-100 bg-white px-4 py-3">
        <h1 className="font-bold text-warm-900">🐾 {t.appName}</h1>
        <div className="flex items-center gap-3">
          {me.user.avatarUrl && (
            <img
              src={me.user.avatarUrl}
              alt=""
              className="h-8 w-8 rounded-full"
            />
          )}
          <button
            type="button"
            onClick={logout}
            className="text-sm text-warm-600 underline"
          >
            {t.logout}
          </button>
        </div>
      </header>
      <main className="p-6">
        <p className="text-lg text-warm-900">{t.greeting(me.user.displayName)}</p>
        <p className="mt-2 text-warm-900/60">{t.comingSoon}</p>
      </main>
    </div>
  );
}
```

- [ ] **Step 9: Create `app/src/App.tsx` and `app/src/main.tsx`**

```tsx
// app/src/App.tsx
import { ApiError } from "./api/client";
import { useMe } from "./api/me";
import { I18nProvider, useT } from "./i18n";
import { Login } from "./routes/Login";
import { Shell } from "./routes/Shell";

function Loading() {
  const t = useT();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-warm-50">
      <p className="text-warm-900/60">{t.loading}</p>
    </main>
  );
}

export function App() {
  const me = useMe();

  const locale = me.data?.user.locale;
  return (
    <I18nProvider locale={locale}>
      {me.isLoading ? (
        <Loading />
      ) : me.error instanceof ApiError && me.error.status === 401 ? (
        <Login />
      ) : me.data ? (
        <Shell me={me.data} />
      ) : (
        <Login />
      )}
    </I18nProvider>
  );
}
```

```tsx
// app/src/main.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 10: Install, typecheck, build**

Run: `npm install && npm run build -w app`
Expected: build succeeds, `app/dist/` produced.

- [ ] **Step 11: Smoke-test the dev flow**

Run (background): `npm run dev -w worker` then `curl -s http://localhost:8787/api/health`
Expected: `{"data":{"status":"ok"}}`.
Run: `curl -s -X POST http://localhost:8787/api/auth/dev-login -H "Content-Type: application/json" -d '{}' -i | grep -i set-cookie`
Expected: a `session=` Set-Cookie line. Stop the background worker afterward.

- [ ] **Step 12: Commit**

```bash
git add app/ package-lock.json
git commit -m "feat: add react pwa scaffold with login, shell, and en/ja i18n"
```

---

### Task 12: Production asset serving + dev workflow + README

**Files:**
- Modify: `worker/wrangler.jsonc`
- Modify: `package.json` (root)
- Create: `worker/.dev.vars.example`
- Create: `README.md`

- [ ] **Step 1: Add the assets binding to `worker/wrangler.jsonc`**

Add this top-level key:

```jsonc
  "assets": {
    "directory": "../app/dist",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
```

- [ ] **Step 2: Make tests build the app first (assets dir must exist)**

Update root `package.json` scripts:

```json
  "scripts": {
    "dev": "concurrently -k -n worker,app -c yellow,cyan \"npm run dev -w worker\" \"npm run dev -w app\"",
    "build": "npm run build -w app",
    "test": "npm run build -w app && npm run test -w worker",
    "typecheck": "npm run typecheck -w shared && npm run typecheck -w worker && npm run typecheck -w app"
  }
```

- [ ] **Step 3: Create `worker/.dev.vars.example`**

```
# Copy to worker/.dev.vars (git-ignored) and fill in to use real Google sign-in.
# Without these, use the "Dev sign-in (local)" button instead.
#
# Create an OAuth client at https://console.cloud.google.com/apis/credentials
# Application type: Web application
# Authorized redirect URIs:
#   http://localhost:5173/api/auth/google/callback   (vite dev server)
#   http://localhost:8787/api/auth/google/callback   (wrangler dev direct)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

- [ ] **Step 4: Create `README.md`**

````markdown
# Pawary

Pet activity log & health management. Mobile-first PWA on Cloudflare Workers.

## Stack

React 19 + Vite + Tailwind (PWA) · Hono on Cloudflare Workers · D1 + Drizzle · R2

## Development

```bash
npm install
npm run db:migrate:local -w worker   # once, and after schema changes
npm run dev                           # worker on :8787, app on :5173
```

Open http://localhost:5173 and use **Dev sign-in (local)**, or configure real
Google OAuth via `worker/.dev.vars` (see `worker/.dev.vars.example`).

## Testing

```bash
npm test          # builds the app, then runs worker tests (vitest + miniflare)
npm run typecheck
```

## Docs

- Spec: `docs/superpowers/specs/2026-06-11-pawary-design.md`
- Plans: `docs/superpowers/plans/`
````

- [ ] **Step 5: Verify the full production-shape flow**

Run: `npm run test`
Expected: app builds, all worker tests pass (assets binding now active in test config too).

Run (background): `npm run dev -w worker`, then:
- `curl -s http://localhost:8787/ | head -5` → the built `index.html` (assets served)
- `curl -s http://localhost:8787/api/health` → `{"data":{"status":"ok"}}`
Stop the background worker.

- [ ] **Step 6: Commit**

```bash
git add worker/wrangler.jsonc worker/.dev.vars.example package.json README.md
git commit -m "feat: serve spa assets from the worker and document dev workflow"
```

---

## Done criteria for Plan 1

- `npm run test` green (≈15 tests: health, headers/envelope, schema, crypto, sessions, me, csrf, oauth flow, dev-login incl. production 404).
- `npm run dev` serves the app at :5173; dev-login lands on the authenticated shell showing the Google (or dev) profile; logout returns to the login screen; UI strings switch to Japanese when the browser language is Japanese.
- Complete D1 schema migrated locally — Plans 2–5 add no scaffolding, only features.

## Next plans (written after this one is executed)

2. **Pets & Activities API** — pet CRUD + members, activities CRUD/query/summary, photo upload (R2, EXIF strip), presets, audit middleware, rate limiting, export, account deletion.
3. **Frontend Core** — tab shell, pet switcher + onboarding, add flow, Home dashboard, calendar modes, log view, activity detail, settings (uses frontend-design skill).
4. **Care & Analyzer** — schedules CRUD + complete + care-status, insights endpoint + anomaly rules, Health tab charts.
5. **PWA & Polish** — manifest + service worker caching, iOS install hint, data export/deletion UI, desktop sidebar layout.
