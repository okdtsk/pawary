# Pawlog Plan 2: Pets & Activities API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The complete pet-scoped API: pet CRUD with role-based access, activity CRUD with per-category validated details, filtered/paginated activity lists, monthly summaries in household time, Quick Add presets, photo upload/serving with metadata stripping, rate limiting, data export, and self-service account deletion — all audited and fully integration-tested.

**Architecture:** Everything builds on Plan 1's merged foundation: Hono routes on the Worker, D1 via Drizzle, sessions + CSRF middleware, the `err()` envelope, and the Vitest workers harness. New in this plan: a `requirePetRole` middleware factory that resolves `(user, :petId) → role` through `pet_members`, a mandatory `writeAudit` domain helper called by every mutating pet-scoped handler, a pure-JS image pipeline (no native codecs on Workers), and an in-memory fixed-window rate limiter. All new route files register **absolute paths** and are mounted with `app.route("/", ...)` — no nested-mount subtleties.

**Tech Stack:** No new dependencies. TypeScript, Hono 4, Drizzle ORM, D1, R2, ulidx, Zod, Vitest + @cloudflare/vitest-pool-workers.

**Spec:** `docs/superpowers/specs/2026-06-11-pawlog-design.md` (read sections 4, 5, 6 before starting).

**Roadmap context:** This is plan 2 of 5. Plan 1 (Foundation & Auth) is merged on `main`. The D1 schema is complete and FROZEN: migrations `0000_init.sql` and `0001_add-fk-indexes.sql` must not be modified, and **this plan adds NO schema changes**. If you believe a schema change is needed, STOP and report instead of improvising. Plans 3–5 (Frontend Core; Care & Analyzer; PWA & Polish) consume the API built here.

**Conventions used throughout (carried from Plan 1):**
- IDs are ULIDs via `newId()` (`worker/src/lib/id.ts`). Timestamps are epoch milliseconds (`Date.now()`).
- API responses: success `{ data: ... }`, failure `{ error: { code, message } }` via `err()` (`worker/src/lib/respond.ts`).
- Validation: Zod schemas in `shared/src/index.ts`, all `.strict()` (unknown keys rejected). First issue message is surfaced with code `validation`.
- Middleware order on mutating pet routes: `requireSession` → `requireCsrf` → `requirePetRole(...)` (spec §5 chain).
- Each task ends with `npm run test -w worker` and `npm run typecheck -w worker` green, then a commit with the exact message given.
- Version numbers are minimums; never pin downward.

**Locked decisions for this plan (do not relitigate):**

| Decision | Choice | Why / spec note |
|---|---|---|
| Non-member or missing pet | **404 `not_found`** | Anti-probing (spec §5): pet IDs must not be confirmable. |
| Member with insufficient role | **403 `forbidden`** | The member already knows the pet exists; 403 is accurate and testable. |
| Minimum roles | GET = viewer; mutations (incl. `PUT targets`) = editor; `DELETE pet` = owner | Spec §6; spec §5 says "owner/editor" for targets → editor minimum. |
| Audit | Explicit `writeAudit()` helper called in **every** mutating pet-scoped handler, not a Hono middleware | Handlers know entity IDs and diffs; middleware can't. The spec §4 "written by middleware" intent (no mutation escapes auditing) is satisfied by the helper being mandatory — tests assert audit rows per mutation. |
| Activity `category` | Immutable after create (same for presets) | A category change would orphan the typed `details` payload; client deletes + recreates instead. |
| Photo flow | Upload **after** the activity exists: `POST .../activities/:activityId/photos` | `activity_photos.activity_id` is NOT NULL in the frozen schema; orphaned uploads become impossible. |
| Orphan-photo cron | **None** (deliberate deviation from spec §5) | With upload-after-create, R2 objects are deleted synchronously with their photo row / pet; no orphans can exist. |
| Photo resizing (`size=thumb\|full`) | Param accepted and **ignored**; original always served | Workers has no image codec; resizing is deferred to deployment (Cloudflare Images). |
| EXIF/GPS stripping | Pure-JS metadata-segment removal, **no re-encode** (deviation from spec §5 "re-encode" wording) | No native codec on Workers. JPEG: drop APP1/APP2 segments. PNG: drop `eXIf`/`tEXt`/`zTXt`/`iTXt` chunks. WebP: drop `EXIF`/`XMP ` RIFF chunks + fix RIFF size. Pixel data is untouched. |
| Rate limiter | In-memory fixed-window Map, per isolate (best effort) | Free, dependency-free, honest about limits; swap to the Cloudflare rate-limiting binding at deploy time (noted in code). |
| R2 keys | `pets/{petId}/photos/{photoId}` and `pets/{petId}/avatar` | One prefix per pet → one prefix-list loop deletes everything. |

---

### Task 1: Shared schemas & types (categories, pets, activities, presets)

**Files:**
- Modify: `shared/src/index.ts`

Pure additions — nothing existing in the file changes. No runtime tests (the schemas are exercised by integration tests from Task 4 onward, plus a full per-category accept/reject matrix in Task 7); verification here is typecheck.

- [ ] **Step 1: Append to `shared/src/index.ts`**

```ts
// ---------------------------------------------------------------------------
// Plan 2: pets, activities, presets, account deletion
// ---------------------------------------------------------------------------

export const SPECIES = ["dog", "cat", "other"] as const;
export type Species = (typeof SPECIES)[number];

export const SEXES = ["male", "female", "unknown"] as const;
export type Sex = (typeof SEXES)[number];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Per-category `details` payload schemas (spec §4). All strict. */
export const activityDetailsSchemas = {
  food: z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      foodType: z.enum(["dry", "wet", "treat", "supplement"]),
      amount: z.number().positive().max(100000).optional(),
      unit: z.enum(["g", "ml", "pieces"]),
      leftoverPct: z.number().min(0).max(100).optional(),
    })
    .strict(),
  water: z.object({ amountMl: z.number().positive().max(100000) }).strict(),
  toilet: z
    .object({
      kind: z.enum(["pee", "poop"]),
      condition: z.enum(["normal", "soft", "diarrhea", "hard", "bloody"]),
      colorNote: z.string().trim().max(200).optional(),
    })
    .strict(),
  weight: z.object({ kg: z.number().positive().max(500) }).strict(),
  exercise: z
    .object({
      kind: z.enum(["walk", "play", "other"]),
      durationMin: z.number().int().positive().max(1440).optional(),
      distanceKm: z.number().positive().max(1000).optional(),
    })
    .strict(),
  symptom: z
    .object({
      name: z.string().trim().min(1).max(100),
      severity: z.enum(["mild", "moderate", "severe"]),
    })
    .strict(),
  medication: z
    .object({
      name: z.string().trim().min(1).max(100),
      dose: z.number().positive().max(100000).optional(),
      doseUnit: z.string().trim().min(1).max(20).optional(),
      scheduleId: z.string().min(1).max(40).optional(),
    })
    .strict(),
  vet_visit: z
    .object({
      clinic: z.string().trim().max(200).optional(),
      reason: z.string().trim().max(500).optional(),
      diagnosis: z.string().trim().max(500).optional(),
      nextVisitDate: z.string().regex(ISO_DATE_RE).optional(),
    })
    .strict(),
  grooming: z
    .object({ kind: z.enum(["bath", "brush", "nails", "trim", "other"]) })
    .strict(),
  vaccination: z
    .object({
      vaccineName: z.string().trim().min(1).max(100),
      nextDueDate: z.string().regex(ISO_DATE_RE).optional(),
    })
    .strict(),
  note: z.object({}).strict(),
} as const satisfies Record<Category, z.ZodTypeAny>;

function refineDetails(
  category: Category,
  details: unknown,
  ctx: z.RefinementCtx,
): void {
  const parsed = activityDetailsSchemas[category].safeParse(details ?? {});
  if (!parsed.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["details"],
      message: parsed.error.issues[0]?.message ?? "Invalid details",
    });
  }
}

export const createActivitySchema = z
  .object({
    category: z.enum(CATEGORIES),
    occurredAt: z.number().int().positive(),
    tzOffsetMin: z.number().int().min(-840).max(840),
    memo: z.string().trim().max(2000).optional(),
    details: z.unknown().optional(), // omitted ⇒ {} (only valid for `note`)
  })
  .strict()
  .superRefine((val, ctx) => refineDetails(val.category, val.details, ctx));
export type CreateActivityInput = z.infer<typeof createActivitySchema>;

// `category` is immutable after creation (changing it would orphan the typed
// details payload). `details`, when present, is re-validated in the handler
// against the activity's EXISTING category — it cannot be checked here.
export const updateActivitySchema = z
  .object({
    occurredAt: z.number().int().positive().optional(),
    tzOffsetMin: z.number().int().min(-840).max(840).optional(),
    memo: z.string().trim().max(2000).nullable().optional(),
    details: z.unknown().optional(),
  })
  .strict();
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;

export const createPetSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    species: z.enum(SPECIES),
    breed: z.string().trim().min(1).max(100).optional(),
    sex: z.enum(SEXES).optional(),
    birthday: z.string().regex(ISO_DATE_RE).optional(),
  })
  .strict();
export type CreatePetInput = z.infer<typeof createPetSchema>;

// `archived: true|false` maps to pets.archived_at (set now / clear).
// breed/sex/birthday accept null to clear.
export const updatePetSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    species: z.enum(SPECIES).optional(),
    breed: z.string().trim().min(1).max(100).nullable().optional(),
    sex: z.enum(SEXES).nullable().optional(),
    birthday: z.string().regex(ISO_DATE_RE).nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict();
export type UpdatePetInput = z.infer<typeof updatePetSchema>;

// PUT semantics: full replace; null clears a target.
export const petTargetsSchema = z
  .object({
    foodGPerDay: z.number().positive().max(100000).nullable(),
    waterMlPerDay: z.number().positive().max(100000).nullable(),
  })
  .strict();
export type PetTargetsInput = z.infer<typeof petTargetsSchema>;

export const presetSchema = z
  .object({
    category: z.enum(CATEGORIES),
    label: z.string().trim().min(1).max(30),
    details: z.unknown().optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
  })
  .strict()
  .superRefine((val, ctx) => refineDetails(val.category, val.details, ctx));
export type PresetInput = z.infer<typeof presetSchema>;

// `category` immutable, like activities; details re-validated in the handler.
export const updatePresetSchema = z
  .object({
    label: z.string().trim().min(1).max(30).optional(),
    details: z.unknown().optional(),
    sortOrder: z.number().int().min(0).max(10000).optional(),
  })
  .strict();
export type UpdatePresetInput = z.infer<typeof updatePresetSchema>;

export const deleteMeSchema = z
  .object({ confirmEmail: z.string().min(1).max(320) })
  .strict();
export type DeleteMeInput = z.infer<typeof deleteMeSchema>;

export type PetTargets = {
  foodGPerDay: number | null;
  waterMlPerDay: number | null;
};

export type PetResponse = {
  id: string;
  name: string;
  species: Species;
  breed: string | null;
  sex: Sex | null;
  birthday: string | null;
  avatarR2Key: string | null;
  archived: boolean;
  createdAt: number;
  role: Role;
  targets: PetTargets | null;
};

export type ActivityPhotoMeta = {
  id: string;
  width: number | null;
  height: number | null;
  contentType: string;
};

export type ActivityResponse = {
  id: string;
  petId: string;
  category: Category;
  occurredAt: number;
  tzOffsetMin: number;
  memo: string | null;
  details: unknown;
  createdBy: string;
  updatedBy: string | null;
  createdAt: number;
  updatedAt: number;
  photos: ActivityPhotoMeta[];
};

export type ActivityListResponse = {
  items: ActivityResponse[];
  nextCursor: string | null;
};

/** days: "YYYY-MM-DD" (household time) → category → count */
export type DaySummaryResponse = {
  month: string;
  days: Record<string, Partial<Record<Category, number>>>;
};

export type PresetResponse = {
  id: string;
  category: Category;
  label: string;
  details: unknown;
  sortOrder: number;
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w shared && npm run typecheck -w worker`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add shared/src/index.ts
git commit -m "feat: add plan 2 shared schemas and api types for pets and activities"
```

---

### Task 2: Pet access middleware + test helpers

**Files:**
- Modify: `worker/src/env.ts`
- Create: `worker/src/middleware/pet-access.ts`
- Modify: `worker/test/helpers.ts`
- Test: `worker/test/pet-access.test.ts`

- [ ] **Step 1: Extend `AppEnv` Variables in `worker/src/env.ts`**

Replace the whole file with:

```ts
import type { Role } from "@pawlog/shared";
import type { Pet, Session, User } from "./db/schema";

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
    // Set by requirePetRole (worker/src/middleware/pet-access.ts):
    pet: Pet;
    petId: string;
    petRole: Role;
  };
};
```

- [ ] **Step 2: Extend `worker/test/helpers.ts`**

Append (and add the new imports to the existing import block: `petMembers`, `pets` from `../src/db/schema`; `type Role` from `@pawlog/shared`):

```ts
export async function seedPet(
  userId: string,
  role: Role = "owner",
  overrides: { name?: string; species?: "dog" | "cat" | "other" } = {},
): Promise<{ petId: string }> {
  const db = drizzle(env.DB);
  const now = Date.now();
  const petId = newId();
  await db.insert(pets).values({
    id: petId,
    name: overrides.name ?? "Momo",
    species: overrides.species ?? "cat",
    createdAt: now,
  });
  await db.insert(petMembers).values({ petId, userId, role, createdAt: now });
  return { petId };
}

export async function withMember(
  petId: string,
  userId: string,
  role: Role,
): Promise<void> {
  const db = drizzle(env.DB);
  await db
    .insert(petMembers)
    .values({ petId, userId, role, createdAt: Date.now() });
}

export function authHeaders(
  cookie: string,
  csrfToken?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Cookie: cookie,
    "Content-Type": "application/json",
  };
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  return headers;
}
```

- [ ] **Step 3: Write the failing test `worker/test/pet-access.test.ts`**

The middleware is tested through a minimal probe app (the real routes arrive in Task 4) — `app.request(path, init, env)` runs it against the test bindings.

```ts
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../src/env";
import { requirePetRole } from "../src/middleware/pet-access";
import { requireSession } from "../src/middleware/session";
import { seedPet, seedUserWithSession, withMember } from "./helpers";

const probe = new Hono<AppEnv>();
probe.get(
  "/api/pets/:petId/probe",
  requireSession,
  requirePetRole("viewer"),
  (c) => c.json({ data: { role: c.get("petRole"), name: c.get("pet").name } }),
);
probe.post(
  "/api/pets/:petId/probe",
  requireSession,
  requirePetRole("editor"),
  (c) => c.json({ data: { ok: true } }),
);
probe.delete(
  "/api/pets/:petId/probe",
  requireSession,
  requirePetRole("owner"),
  (c) => c.json({ data: { ok: true } }),
);

function req(path: string, cookie: string, method = "GET") {
  return probe.request(path, { method, headers: { Cookie: cookie } }, env);
}

describe("requirePetRole", () => {
  it("404 not_found for a pet that does not exist", async () => {
    const { cookie } = await seedUserWithSession();
    const res = await req("/api/pets/01HZZZZZZZZZZZZZZZZZZZZZZZ/probe", cookie);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  it("404 (not 403) for a non-member, even though the pet exists", async () => {
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    const outsider = await seedUserWithSession({ email: "eve@example.com" });
    const res = await req(`/api/pets/${petId}/probe`, outsider.cookie);
    expect(res.status).toBe(404);
  });

  it("attaches petRole and the pet row for a member", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId, "viewer", { name: "Hana" });
    const res = await req(`/api/pets/${petId}/probe`, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { role: "viewer", name: "Hana" },
    });
  });

  it("403 forbidden when a viewer hits an editor route", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId, "viewer");
    const res = await req(`/api/pets/${petId}/probe`, cookie, "POST");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden");
  });

  it("403 when an editor hits an owner route", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId, "editor");
    const res = await req(`/api/pets/${petId}/probe`, cookie, "DELETE");
    expect(res.status).toBe(403);
  });

  it("owner passes viewer, editor, and owner routes", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId, "owner");
    for (const method of ["GET", "POST", "DELETE"]) {
      const res = await req(`/api/pets/${petId}/probe`, cookie, method);
      expect(res.status).toBe(200);
    }
  });

  it("withMember grants a second user access at the given role", async () => {
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    const editor = await seedUserWithSession({ email: "ed@example.com" });
    await withMember(petId, editor.userId, "editor");
    const res = await req(`/api/pets/${petId}/probe`, editor.cookie, "POST");
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm run test -w worker`
Expected: FAIL — module `../src/middleware/pet-access` not found.

- [ ] **Step 5: Create `worker/src/middleware/pet-access.ts`**

```ts
import type { Role } from "@pawlog/shared";
import { and, eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { createMiddleware } from "hono/factory";
import { petMembers, pets, type Pet } from "../db/schema";
import type { AppEnv } from "../env";
import { err } from "../lib/respond";

const ROLE_ORDER: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

export function roleAtLeast(role: Role, minRole: Role): boolean {
  return ROLE_ORDER[role] >= ROLE_ORDER[minRole];
}

/** One query resolves membership + pet row. Null = no pet OR not a member. */
export async function resolvePetAccess(
  db: DrizzleD1Database,
  petId: string,
  userId: string,
): Promise<{ pet: Pet; role: Role } | null> {
  const row = await db
    .select({ pet: pets, role: petMembers.role })
    .from(petMembers)
    .innerJoin(pets, eq(petMembers.petId, pets.id))
    .where(and(eq(petMembers.petId, petId), eq(petMembers.userId, userId)))
    .get();
  return row ?? null;
}

/**
 * Resolves the session user's role on the `:petId` route param.
 * - Missing pet and non-member are both 404 (anti-probing, spec §5).
 * - Member with insufficient role is 403 `forbidden`.
 * Role order: viewer < editor < owner. Must run AFTER requireSession.
 */
export function requirePetRole(minRole: Role) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const petId = c.req.param("petId");
    if (!petId) return err(c, 404, "not_found", "Not found");
    const db = drizzle(c.env.DB);
    const access = await resolvePetAccess(db, petId, c.get("user").id);
    if (!access) return err(c, 404, "not_found", "Not found");
    if (!roleAtLeast(access.role, minRole)) {
      return err(c, 403, "forbidden", "Insufficient role");
    }
    c.set("pet", access.pet);
    c.set("petId", petId);
    c.set("petRole", access.role);
    await next();
  });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all tests, 7 new).

- [ ] **Step 7: Commit**

```bash
git add worker/src/env.ts worker/src/middleware/pet-access.ts worker/test/helpers.ts worker/test/pet-access.test.ts
git commit -m "feat: add pet access middleware with role resolution and test helpers"
```

---

### Task 3: Audit domain helper

**Files:**
- Create: `worker/src/domain/audit.ts`
- Test: `worker/test/audit.test.ts`

Convention established here: **every mutating pet-scoped handler MUST call `writeAudit` exactly once per mutation**, and every route-group test file asserts the audit row. This (not a Hono middleware) implements spec §4's "written on every mutation" — only the handler knows the entity ID and diff.

- [ ] **Step 1: Write the failing test `worker/test/audit.test.ts`**

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { auditLog } from "../src/db/schema";
import { writeAudit } from "../src/domain/audit";

it("writeAudit inserts a row with a ulid id, timestamp, and json diff", async () => {
  const db = drizzle(env.DB);
  const before = Date.now();
  await writeAudit(db, {
    petId: "p1",
    userId: "u1",
    action: "create",
    entity: "pet",
    entityId: "p1",
    diff: { name: "Momo" },
  });
  const rows = await db.select().from(auditLog).all();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID
  expect(rows[0]?.action).toBe("create");
  expect(rows[0]?.entity).toBe("pet");
  expect(rows[0]?.entityId).toBe("p1");
  expect(rows[0]?.diff).toEqual({ name: "Momo" });
  expect(rows[0]?.createdAt).toBeGreaterThanOrEqual(before);
});

it("diff is optional and stored as null", async () => {
  const db = drizzle(env.DB);
  await writeAudit(db, {
    petId: "p1",
    userId: "u1",
    action: "delete",
    entity: "activity",
    entityId: "a1",
  });
  const rows = await db.select().from(auditLog).all();
  expect(rows[0]?.diff).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w worker`
Expected: FAIL — module `../src/domain/audit` not found.

- [ ] **Step 3: Create `worker/src/domain/audit.ts`**

```ts
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { auditLog } from "../db/schema";
import { newId } from "../lib/id";

export type AuditEntry = {
  petId: string;
  userId: string;
  action: "create" | "update" | "delete";
  entity: "activity" | "pet" | "schedule" | "preset" | "member";
  entityId: string;
  diff?: unknown;
};

/**
 * MUST be called by every mutating pet-scoped handler (project convention —
 * this is how spec §4's "audit on every mutation" is enforced; tests assert
 * the rows). audit_log has no FKs on purpose: rows survive user/pet deletion.
 */
export async function writeAudit(
  db: DrizzleD1Database,
  entry: AuditEntry,
): Promise<void> {
  await db.insert(auditLog).values({
    id: newId(),
    petId: entry.petId,
    userId: entry.userId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    diff: entry.diff ?? null,
    createdAt: Date.now(),
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all tests, 2 new).

- [ ] **Step 5: Commit**

```bash
git add worker/src/domain/audit.ts worker/test/audit.test.ts
git commit -m "feat: add audit log domain helper"
```

---

### Task 4: Pet routes — POST / GET / PATCH

`DELETE /api/pets/:petId` is deliberately NOT in this task: it needs the R2 prefix-cleanup helper, so it lands in Task 13 with the rest of the R2 work.

**Files:**
- Create: `worker/src/routes/pets.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/pets.test.ts`

- [ ] **Step 1: Write the failing test `worker/test/pets.test.ts`**

```ts
import { env, SELF } from "cloudflare:test";
import type { PetResponse } from "@pawlog/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { auditLog } from "../src/db/schema";
import {
  authHeaders,
  seedPet,
  seedUserWithSession,
  withMember,
} from "./helpers";

async function createPet(
  cookie: string,
  csrfToken: string,
  body: unknown = { name: "Momo", species: "cat" },
) {
  return SELF.fetch("https://app.local/api/pets", {
    method: "POST",
    headers: authHeaders(cookie, csrfToken),
    body: JSON.stringify(body),
  });
}

it("POST /api/pets creates a pet, owner membership, and audit row", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const res = await createPet(cookie, csrfToken, {
    name: "Momo",
    species: "cat",
    breed: "Mixed",
    birthday: "2020-04-01",
  });
  expect(res.status).toBe(201);
  const { data } = (await res.json()) as { data: PetResponse };
  expect(data.name).toBe("Momo");
  expect(data.role).toBe("owner");
  expect(data.archived).toBe(false);
  expect(data.targets).toBeNull();

  // visible in /api/me with owner role
  const me = await SELF.fetch("https://app.local/api/me", {
    headers: { Cookie: cookie },
  });
  const meBody = (await me.json()) as {
    data: { pets: Array<{ id: string; role: string }> };
  };
  expect(meBody.data.pets).toEqual([
    expect.objectContaining({ id: data.id, role: "owner" }),
  ]);

  const db = drizzle(env.DB);
  const audits = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.petId, data.id))
    .all();
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    userId,
    action: "create",
    entity: "pet",
    entityId: data.id,
  });
});

it("POST /api/pets rejects invalid bodies", async () => {
  const { cookie, csrfToken } = await seedUserWithSession();
  for (const body of [
    { name: "", species: "cat" },
    { name: "x".repeat(51), species: "cat" },
    { name: "Momo", species: "hamster" },
    { name: "Momo", species: "cat", birthday: "April 1" },
    { name: "Momo", species: "cat", isAdmin: true },
  ]) {
    const res = await createPet(cookie, csrfToken, body);
    expect(res.status).toBe(400);
  }
});

it("POST /api/pets requires a csrf token", async () => {
  const { cookie } = await seedUserWithSession();
  const res = await SELF.fetch("https://app.local/api/pets", {
    method: "POST",
    headers: authHeaders(cookie),
    body: JSON.stringify({ name: "Momo", species: "cat" }),
  });
  expect(res.status).toBe(403);
});

it("GET /api/pets/:petId is 404 for non-members and unknown ids", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const outsider = await seedUserWithSession({ email: "eve@example.com" });
  for (const id of [petId, "01HZZZZZZZZZZZZZZZZZZZZZZZ"]) {
    const res = await SELF.fetch(`https://app.local/api/pets/${id}`, {
      headers: { Cookie: outsider.cookie },
    });
    expect(res.status).toBe(404);
  }
});

it("GET /api/pets/:petId returns the pet with the caller's role", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId, "owner", { name: "Hana" });
  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  const res = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    headers: { Cookie: viewer.cookie },
  });
  expect(res.status).toBe(200);
  const { data } = (await res.json()) as { data: PetResponse };
  expect(data.name).toBe("Hana");
  expect(data.role).toBe("viewer");
});

it("PATCH /api/pets/:petId updates fields as editor and writes an audit diff", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const editor = await seedUserWithSession({ email: "ed@example.com" });
  await withMember(petId, editor.userId, "editor");
  const res = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    method: "PATCH",
    headers: authHeaders(editor.cookie, editor.csrfToken),
    body: JSON.stringify({ name: "Hana", breed: null }),
  });
  expect(res.status).toBe(200);
  const { data } = (await res.json()) as { data: PetResponse };
  expect(data.name).toBe("Hana");
  expect(data.breed).toBeNull();

  const db = drizzle(env.DB);
  const audits = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.petId, petId))
    .all();
  expect(audits).toHaveLength(1);
  expect(audits[0]?.action).toBe("update");
  expect(audits[0]?.diff).toMatchObject({
    before: { name: "Momo" },
    after: { name: "Hana" },
  });
});

it("PATCH /api/pets/:petId is 403 for viewers and 404 for non-members", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  const asViewer = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    method: "PATCH",
    headers: authHeaders(viewer.cookie, viewer.csrfToken),
    body: JSON.stringify({ name: "Hana" }),
  });
  expect(asViewer.status).toBe(403);

  const outsider = await seedUserWithSession({ email: "eve@example.com" });
  const asOutsider = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    method: "PATCH",
    headers: authHeaders(outsider.cookie, outsider.csrfToken),
    body: JSON.stringify({ name: "Hana" }),
  });
  expect(asOutsider.status).toBe(404);
});

it("PATCH /api/pets/:petId rejects an empty body", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const res = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    method: "PATCH",
    headers: authHeaders(cookie, csrfToken),
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w worker`
Expected: new tests FAIL (404 — routes don't exist).

- [ ] **Step 3: Create `worker/src/routes/pets.ts`**

```ts
import type { PetResponse, PetTargets, Role } from "@pawlog/shared";
import { createPetSchema, updatePetSchema } from "@pawlog/shared";
import { eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { Hono } from "hono";
import { petMembers, pets, petTargets, type Pet } from "../db/schema";
import { writeAudit } from "../domain/audit";
import type { AppEnv } from "../env";
import { newId } from "../lib/id";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requirePetRole } from "../middleware/pet-access";
import { requireSession } from "../middleware/session";

export const petRoutes = new Hono<AppEnv>();

async function getTargets(
  db: DrizzleD1Database,
  petId: string,
): Promise<PetTargets | null> {
  const row = await db
    .select({
      foodGPerDay: petTargets.foodGPerDay,
      waterMlPerDay: petTargets.waterMlPerDay,
    })
    .from(petTargets)
    .where(eq(petTargets.petId, petId))
    .get();
  return row ?? null;
}

function petToResponse(
  pet: Pet,
  role: Role,
  targets: PetTargets | null,
): PetResponse {
  return {
    id: pet.id,
    name: pet.name,
    species: pet.species,
    breed: pet.breed,
    sex: pet.sex,
    birthday: pet.birthday,
    avatarR2Key: pet.avatarR2Key,
    archived: pet.archivedAt !== null,
    createdAt: pet.createdAt,
    role,
    targets,
  };
}

petRoutes.post("/api/pets", requireSession, requireCsrf, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createPetSchema.safeParse(body);
  if (!parsed.success) {
    return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const user = c.get("user");
  const db = drizzle(c.env.DB);
  const now = Date.now();
  const pet: Pet = {
    id: newId(),
    name: parsed.data.name,
    species: parsed.data.species,
    breed: parsed.data.breed ?? null,
    sex: parsed.data.sex ?? null,
    birthday: parsed.data.birthday ?? null,
    avatarR2Key: null,
    archivedAt: null,
    createdAt: now,
  };
  await db.insert(pets).values(pet);
  await db.insert(petMembers).values({
    petId: pet.id,
    userId: user.id,
    role: "owner",
    createdAt: now,
  });
  await writeAudit(db, {
    petId: pet.id,
    userId: user.id,
    action: "create",
    entity: "pet",
    entityId: pet.id,
    diff: parsed.data,
  });
  return c.json({ data: petToResponse(pet, "owner", null) }, 201);
});

petRoutes.get(
  "/api/pets/:petId",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const pet = c.get("pet");
    const db = drizzle(c.env.DB);
    const targets = await getTargets(db, pet.id);
    return c.json({ data: petToResponse(pet, c.get("petRole"), targets) });
  },
);

petRoutes.patch(
  "/api/pets/:petId",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updatePetSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    if (Object.keys(parsed.data).length === 0) {
      return err(c, 400, "validation", "No fields to update");
    }
    const pet = c.get("pet");
    const user = c.get("user");
    const db = drizzle(c.env.DB);
    const { archived, ...fields } = parsed.data;
    const changes: Partial<Pet> = { ...fields };
    if (archived !== undefined) {
      // idempotent: re-archiving keeps the original archivedAt
      changes.archivedAt = archived ? (pet.archivedAt ?? Date.now()) : null;
    }
    await db.update(pets).set(changes).where(eq(pets.id, pet.id));
    const before: Record<string, unknown> = {};
    for (const key of Object.keys(changes) as Array<keyof Pet>) {
      before[key] = pet[key];
    }
    await writeAudit(db, {
      petId: pet.id,
      userId: user.id,
      action: "update",
      entity: "pet",
      entityId: pet.id,
      diff: { before, after: changes },
    });
    const updated: Pet = { ...pet, ...changes };
    const targets = await getTargets(db, pet.id);
    return c.json({ data: petToResponse(updated, c.get("petRole"), targets) });
  },
);
```

- [ ] **Step 4: Mount in `worker/src/index.ts`**

Add the import and route line (route paths inside `petRoutes` are absolute):

```ts
import { petRoutes } from "./routes/pets";
// ... after app.route("/api/me", meRoutes):
app.route("/", petRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all tests, 8 new).

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/pets.ts worker/src/index.ts worker/test/pets.test.ts
git commit -m "feat: add pet create, read, and update routes with audit"
```

---

### Task 5: Pet daily targets (PUT) + archive round-trip coverage

**Files:**
- Modify: `worker/src/routes/pets.ts`
- Test: `worker/test/pets.test.ts` (extend)

- [ ] **Step 1: Append failing tests to `worker/test/pets.test.ts`**

```ts
it("PUT /api/pets/:petId/targets upserts and is returned by GET", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const put = await SELF.fetch(`https://app.local/api/pets/${petId}/targets`, {
    method: "PUT",
    headers: authHeaders(cookie, csrfToken),
    body: JSON.stringify({ foodGPerDay: 60, waterMlPerDay: 250 }),
  });
  expect(put.status).toBe(200);

  const get = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    headers: { Cookie: cookie },
  });
  const { data } = (await get.json()) as { data: PetResponse };
  expect(data.targets).toEqual({ foodGPerDay: 60, waterMlPerDay: 250 });

  // second PUT replaces; null clears one target
  const put2 = await SELF.fetch(`https://app.local/api/pets/${petId}/targets`, {
    method: "PUT",
    headers: authHeaders(cookie, csrfToken),
    body: JSON.stringify({ foodGPerDay: 70, waterMlPerDay: null }),
  });
  expect(put2.status).toBe(200);
  const get2 = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    headers: { Cookie: cookie },
  });
  const body2 = (await get2.json()) as { data: PetResponse };
  expect(body2.data.targets).toEqual({ foodGPerDay: 70, waterMlPerDay: null });
});

it("PUT targets validates and enforces editor role", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const bad = await SELF.fetch(`https://app.local/api/pets/${petId}/targets`, {
    method: "PUT",
    headers: authHeaders(owner.cookie, owner.csrfToken),
    body: JSON.stringify({ foodGPerDay: -5, waterMlPerDay: null }),
  });
  expect(bad.status).toBe(400);

  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  const forbidden = await SELF.fetch(
    `https://app.local/api/pets/${petId}/targets`,
    {
      method: "PUT",
      headers: authHeaders(viewer.cookie, viewer.csrfToken),
      body: JSON.stringify({ foodGPerDay: 60, waterMlPerDay: null }),
    },
  );
  expect(forbidden.status).toBe(403);
});

it("archive and unarchive round-trip via PATCH archived", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const archive = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    method: "PATCH",
    headers: authHeaders(cookie, csrfToken),
    body: JSON.stringify({ archived: true }),
  });
  expect(archive.status).toBe(200);
  expect(((await archive.json()) as { data: PetResponse }).data.archived).toBe(true);

  const unarchive = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    method: "PATCH",
    headers: authHeaders(cookie, csrfToken),
    body: JSON.stringify({ archived: false }),
  });
  expect(unarchive.status).toBe(200);
  expect(((await unarchive.json()) as { data: PetResponse }).data.archived).toBe(false);
});
```

- [ ] **Step 2: Run to verify the targets tests fail**

Run: `npm run test -w worker`
Expected: the two targets tests FAIL (404 — PUT route missing); the archive test PASSES already (Task 4 implemented `archived`) — that is expected, it locks the behavior in.

- [ ] **Step 3: Append the PUT handler to `worker/src/routes/pets.ts`**

Add `petTargetsSchema` to the `@pawlog/shared` import, then append:

```ts
petRoutes.put(
  "/api/pets/:petId/targets",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = petTargetsSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const pet = c.get("pet");
    const db = drizzle(c.env.DB);
    await db
      .insert(petTargets)
      .values({ petId: pet.id, ...parsed.data })
      .onConflictDoUpdate({ target: petTargets.petId, set: parsed.data });
    await writeAudit(db, {
      petId: pet.id,
      userId: c.get("user").id,
      action: "update",
      entity: "pet",
      entityId: pet.id,
      diff: { targets: parsed.data },
    });
    return c.json({ data: parsed.data });
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all tests, 3 new).

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/pets.ts worker/test/pets.test.ts
git commit -m "feat: add pet daily targets upsert and archive coverage"
```

---

### Task 6: Rate limiter + application to auth routes

**Files:**
- Create: `worker/src/lib/rate-limit.ts`
- Modify: `worker/src/routes/auth.ts`
- Test: `worker/test/rate-limit.test.ts`
- Test: `worker/test/rate-limit-auth.test.ts`

- [ ] **Step 1: Write the failing unit test `worker/test/rate-limit.test.ts`**

```ts
import { beforeEach, expect, it } from "vitest";
import { checkRateLimit, resetRateLimits } from "../src/lib/rate-limit";

beforeEach(() => resetRateLimits());

it("allows up to `limit` hits inside one window, then blocks", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) {
    expect(checkRateLimit("k:a", 5, 60_000, t0 + i)).toBe(true);
  }
  expect(checkRateLimit("k:a", 5, 60_000, t0 + 5)).toBe(false);
});

it("opens a fresh window after windowMs", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) checkRateLimit("k:a", 5, 60_000, t0);
  expect(checkRateLimit("k:a", 5, 60_000, t0 + 59_999)).toBe(false);
  expect(checkRateLimit("k:a", 5, 60_000, t0 + 60_000)).toBe(true);
});

it("keys are independent", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) checkRateLimit("k:a", 5, 60_000, t0);
  expect(checkRateLimit("k:b", 5, 60_000, t0)).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w worker`
Expected: FAIL — module `../src/lib/rate-limit` not found.

- [ ] **Step 3: Create `worker/src/lib/rate-limit.ts`**

```ts
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { err } from "./respond";

// Fixed-window counter in module scope. LIMITATION: this is per-isolate and
// best-effort — counters reset when the isolate recycles and are not shared
// across colos. Good enough for local dev and for slowing abuse in v1.
// DEPLOY-TIME SWAP: replace checkRateLimit with the Cloudflare rate-limiting
// binding (wrangler `unsafe.bindings` ratelimit) keeping this middleware's
// signature; nothing else changes.
type Bucket = { count: number; windowStart: number };
const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/** Test helper: clears all counters (tests share the worker's module state). */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * keyBy "ip": pre-auth routes (CF-Connecting-IP; "local" in dev/tests).
 * keyBy "user": authed routes — must run AFTER requireSession.
 */
export function rateLimit(
  keyPrefix: string,
  limit: number,
  windowMs: number,
  keyBy: "ip" | "user" = "ip",
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const id =
      keyBy === "user"
        ? c.get("user").id
        : (c.req.header("CF-Connecting-IP") ?? "local");
    if (!checkRateLimit(`${keyPrefix}:${id}`, limit, windowMs)) {
      return err(c, 429, "rate_limited", "Too many requests");
    }
    await next();
  });
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `npm run test -w worker`
Expected: PASS (3 new).

- [ ] **Step 5: Write the failing integration test `worker/test/rate-limit-auth.test.ts`**

`resetRateLimits()` works through `SELF` because vitest-pool-workers runs tests in the same isolate (same module registry) as the worker — the same property Plan 1's oauth test relied on for the JWKS cache. Reset in BOTH hooks so this file's 11 hits never leak into other test files sharing the isolate.

```ts
import { SELF } from "cloudflare:test";
import { afterEach, beforeEach, expect, it } from "vitest";
import { resetRateLimits } from "../src/lib/rate-limit";

beforeEach(() => resetRateLimits());
afterEach(() => resetRateLimits());

it("11th hit on /api/auth/google within a minute is 429", async () => {
  for (let i = 0; i < 10; i++) {
    const res = await SELF.fetch("https://app.local/api/auth/google", {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
  }
  const blocked = await SELF.fetch("https://app.local/api/auth/google", {
    redirect: "manual",
  });
  expect(blocked.status).toBe(429);
  const body = (await blocked.json()) as { error: { code: string } };
  expect(body.error.code).toBe("rate_limited");
});

it("dev-login is rate limited per IP too", async () => {
  for (let i = 0; i < 10; i++) {
    await SELF.fetch("http://localhost/api/auth/dev-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  }
  const blocked = await SELF.fetch("http://localhost/api/auth/dev-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(blocked.status).toBe(429);
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm run test -w worker`
Expected: the two new tests FAIL (11th request still 302/200).

- [ ] **Step 7: Apply the limiter in `worker/src/routes/auth.ts`**

Add the import:

```ts
import { rateLimit } from "../lib/rate-limit";
```

Then change exactly these three route registration lines (handler bodies are untouched — only the middleware is inserted). Each auth entry point gets its own counter, 10/min per IP:

```ts
// was: authRoutes.get("/google", async (c) => {
authRoutes.get("/google", rateLimit("auth-google", 10, 60_000), async (c) => {

// was: authRoutes.get("/google/callback", async (c) => {
authRoutes.get("/google/callback", rateLimit("auth-callback", 10, 60_000), async (c) => {

// was: authRoutes.post("/dev-login", async (c) => {
authRoutes.post("/dev-login", rateLimit("auth-dev-login", 10, 60_000), async (c) => {
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all tests, 5 new in this task). If `oauth.test.ts` or `dev-login.test.ts` started failing with 429, the afterEach reset is missing — fix that, do not raise the limits.

- [ ] **Step 9: Commit**

```bash
git add worker/src/lib/rate-limit.ts worker/src/routes/auth.ts worker/test/rate-limit.test.ts worker/test/rate-limit-auth.test.ts
git commit -m "feat: add fixed-window rate limiter and apply to auth routes"
```

---

### Task 7: Activities — POST + GET /:id + per-category validation matrix

**Files:**
- Create: `worker/src/routes/activities.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/activities.test.ts`

- [ ] **Step 1: Write the failing test `worker/test/activities.test.ts`**

```ts
import { env, SELF } from "cloudflare:test";
import type { ActivityResponse, Category } from "@pawlog/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { auditLog } from "../src/db/schema";
import {
  authHeaders,
  seedPet,
  seedUserWithSession,
  withMember,
} from "./helpers";

export async function postActivity(
  petId: string,
  cookie: string,
  csrfToken: string,
  body: unknown,
) {
  return SELF.fetch(`https://app.local/api/pets/${petId}/activities`, {
    method: "POST",
    headers: authHeaders(cookie, csrfToken),
    body: JSON.stringify(body),
  });
}

it("POST creates an activity and writes an audit row", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const res = await postActivity(petId, cookie, csrfToken, {
    category: "weight",
    occurredAt: Date.now(),
    tzOffsetMin: 540,
    memo: "monthly weigh-in",
    details: { kg: 4.2 },
  });
  expect(res.status).toBe(201);
  const { data } = (await res.json()) as { data: ActivityResponse };
  expect(data.category).toBe("weight");
  expect(data.details).toEqual({ kg: 4.2 });
  expect(data.createdBy).toBe(userId);
  expect(data.photos).toEqual([]);

  const db = drizzle(env.DB);
  const audits = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityId, data.id))
    .all();
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    action: "create",
    entity: "activity",
    petId,
  });
});

it("POST defaults details to {} so `note` needs only a memo", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const res = await postActivity(petId, cookie, csrfToken, {
    category: "note",
    occurredAt: Date.now(),
    tzOffsetMin: 0,
    memo: "sleepy day",
  });
  expect(res.status).toBe(201);
});

describe("per-category details validation", () => {
  const cases: Array<{ category: Category; details: unknown; ok: boolean }> = [
    { category: "food", details: { foodType: "dry", unit: "g", amount: 50 }, ok: true },
    { category: "food", details: { foodType: "fried", unit: "g" }, ok: false },
    { category: "food", details: { foodType: "dry", unit: "g", leftoverPct: 101 }, ok: false },
    { category: "water", details: { amountMl: 120 }, ok: true },
    { category: "water", details: { amountMl: -1 }, ok: false },
    { category: "water", details: {}, ok: false },
    { category: "toilet", details: { kind: "poop", condition: "soft" }, ok: true },
    { category: "toilet", details: { kind: "poop" }, ok: false },
    { category: "weight", details: { kg: 4.2 }, ok: true },
    { category: "weight", details: { kg: "4.2" }, ok: false },
    { category: "exercise", details: { kind: "walk", durationMin: 30 }, ok: true },
    { category: "exercise", details: { kind: "swim" }, ok: false },
    { category: "symptom", details: { name: "cough", severity: "mild" }, ok: true },
    { category: "symptom", details: { name: "cough", severity: "fatal" }, ok: false },
    { category: "medication", details: { name: "antibiotic", dose: 5, doseUnit: "mg" }, ok: true },
    { category: "medication", details: { dose: 5 }, ok: false },
    { category: "vet_visit", details: { clinic: "Ueno Clinic", nextVisitDate: "2026-07-01" }, ok: true },
    { category: "vet_visit", details: { nextVisitDate: "July 1st" }, ok: false },
    { category: "grooming", details: { kind: "nails" }, ok: true },
    { category: "grooming", details: { kind: "perm" }, ok: false },
    { category: "vaccination", details: { vaccineName: "rabies" }, ok: true },
    { category: "vaccination", details: {}, ok: false },
    { category: "note", details: {}, ok: true },
    { category: "note", details: { extra: 1 }, ok: false },
  ];

  it.each(cases)("$category $ok", async ({ category, details, ok }) => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const res = await postActivity(petId, cookie, csrfToken, {
      category,
      occurredAt: Date.now(),
      tzOffsetMin: 0,
      details,
    });
    expect(res.status).toBe(ok ? 201 : 400);
  });
});

it("POST rejects bad envelopes: tz out of range, unknown key, bad category", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  for (const body of [
    { category: "note", occurredAt: Date.now(), tzOffsetMin: 900, details: {} },
    { category: "note", occurredAt: Date.now(), tzOffsetMin: 0, details: {}, extra: 1 },
    { category: "nap", occurredAt: Date.now(), tzOffsetMin: 0, details: {} },
    { category: "note", occurredAt: -5, tzOffsetMin: 0, details: {} },
  ]) {
    const res = await postActivity(petId, cookie, csrfToken, body);
    expect(res.status).toBe(400);
  }
});

it("POST authz: viewer 403, non-member 404, no csrf 403, no session 401", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const valid = {
    category: "note",
    occurredAt: Date.now(),
    tzOffsetMin: 0,
    details: {},
  };

  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  expect(
    (await postActivity(petId, viewer.cookie, viewer.csrfToken, valid)).status,
  ).toBe(403);

  const outsider = await seedUserWithSession({ email: "eve@example.com" });
  expect(
    (await postActivity(petId, outsider.cookie, outsider.csrfToken, valid)).status,
  ).toBe(404);

  const noCsrf = await SELF.fetch(
    `https://app.local/api/pets/${petId}/activities`,
    {
      method: "POST",
      headers: authHeaders(owner.cookie),
      body: JSON.stringify(valid),
    },
  );
  expect(noCsrf.status).toBe(403);

  const noSession = await SELF.fetch(
    `https://app.local/api/pets/${petId}/activities`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(valid),
    },
  );
  expect(noSession.status).toBe(401);
});

it("GET /:id returns the activity for a viewer; cross-pet id is 404", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const created = await postActivity(petId, owner.cookie, owner.csrfToken, {
    category: "water",
    occurredAt: Date.now(),
    tzOffsetMin: 540,
    details: { amountMl: 100 },
  });
  const { data } = (await created.json()) as { data: ActivityResponse };

  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/activities/${data.id}`,
    { headers: { Cookie: viewer.cookie } },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: ActivityResponse };
  expect(body.data.details).toEqual({ amountMl: 100 });

  // the same activity id under a DIFFERENT pet the viewer owns → 404
  const { petId: otherPet } = await seedPet(viewer.userId);
  const cross = await SELF.fetch(
    `https://app.local/api/pets/${otherPet}/activities/${data.id}`,
    { headers: { Cookie: viewer.cookie } },
  );
  expect(cross.status).toBe(404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w worker`
Expected: new tests FAIL (404 — routes don't exist).

- [ ] **Step 3: Create `worker/src/routes/activities.ts`**

```ts
import type { ActivityPhotoMeta, ActivityResponse } from "@pawlog/shared";
import { createActivitySchema } from "@pawlog/shared";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { Hono } from "hono";
import { activities, activityPhotos, type Activity } from "../db/schema";
import { writeAudit } from "../domain/audit";
import type { AppEnv } from "../env";
import { newId } from "../lib/id";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requirePetRole } from "../middleware/pet-access";
import { requireSession } from "../middleware/session";

export const activityRoutes = new Hono<AppEnv>();

function activityToResponse(
  a: Activity,
  photos: ActivityPhotoMeta[],
): ActivityResponse {
  return {
    id: a.id,
    petId: a.petId,
    category: a.category,
    occurredAt: a.occurredAt,
    tzOffsetMin: a.tzOffsetMin,
    memo: a.memo,
    details: a.details,
    createdBy: a.createdBy,
    updatedBy: a.updatedBy,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    photos,
  };
}

/** Scoped to the pet and excluding soft-deleted rows. */
async function getLiveActivity(
  db: DrizzleD1Database,
  petId: string,
  id: string | undefined,
): Promise<Activity | undefined> {
  if (!id) return undefined;
  return db
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.id, id),
        eq(activities.petId, petId),
        isNull(activities.deletedAt),
      ),
    )
    .get();
}

async function getPhotoMeta(
  db: DrizzleD1Database,
  activityId: string,
): Promise<ActivityPhotoMeta[]> {
  return db
    .select({
      id: activityPhotos.id,
      width: activityPhotos.width,
      height: activityPhotos.height,
      contentType: activityPhotos.contentType,
    })
    .from(activityPhotos)
    .where(eq(activityPhotos.activityId, activityId))
    .all();
}

activityRoutes.post(
  "/api/pets/:petId/activities",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createActivitySchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const petId = c.get("petId");
    const user = c.get("user");
    const db = drizzle(c.env.DB);
    const now = Date.now();
    const activity: Activity = {
      id: newId(),
      petId,
      category: parsed.data.category,
      occurredAt: parsed.data.occurredAt,
      tzOffsetMin: parsed.data.tzOffsetMin,
      memo: parsed.data.memo ?? null,
      details: parsed.data.details ?? {},
      createdBy: user.id,
      updatedBy: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await db.insert(activities).values(activity);
    await writeAudit(db, {
      petId,
      userId: user.id,
      action: "create",
      entity: "activity",
      entityId: activity.id,
      diff: { category: activity.category },
    });
    return c.json({ data: activityToResponse(activity, []) }, 201);
  },
);

activityRoutes.get(
  "/api/pets/:petId/activities/:id",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const activity = await getLiveActivity(
      db,
      c.get("petId"),
      c.req.param("id"),
    );
    if (!activity) return err(c, 404, "not_found", "Not found");
    const photos = await getPhotoMeta(db, activity.id);
    return c.json({ data: activityToResponse(activity, photos) });
  },
);
```

- [ ] **Step 4: Mount in `worker/src/index.ts`**

```ts
import { activityRoutes } from "./routes/activities";
// ... after app.route("/", petRoutes):
app.route("/", activityRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all tests; ~30 new including the 24 matrix cases).

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/activities.ts worker/src/index.ts worker/test/activities.test.ts
git commit -m "feat: add activity create and detail routes with per-category validation"
```

---

### Task 8: Activities — PATCH + soft DELETE with audit diffs

**Files:**
- Modify: `worker/src/routes/activities.ts`
- Test: `worker/test/activities.test.ts` (extend)

- [ ] **Step 1: Append failing tests to `worker/test/activities.test.ts`**

```ts
it("PATCH updates memo/details and audits a before/after diff", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const created = await postActivity(petId, owner.cookie, owner.csrfToken, {
    category: "weight",
    occurredAt: Date.now(),
    tzOffsetMin: 540,
    memo: "old memo",
    details: { kg: 4.2 },
  });
  const { data } = (await created.json()) as { data: ActivityResponse };

  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/activities/${data.id}`,
    {
      method: "PATCH",
      headers: authHeaders(owner.cookie, owner.csrfToken),
      body: JSON.stringify({ memo: "new memo", details: { kg: 4.4 } }),
    },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: ActivityResponse };
  expect(body.data.memo).toBe("new memo");
  expect(body.data.details).toEqual({ kg: 4.4 });
  expect(body.data.updatedBy).toBe(owner.userId);

  const db = drizzle(env.DB);
  const audits = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityId, data.id))
    .all();
  const update = audits.find((a) => a.action === "update");
  expect(update?.diff).toEqual({
    before: { memo: "old memo", details: { kg: 4.2 } },
    after: { memo: "new memo", details: { kg: 4.4 } },
  });
});

it("PATCH rejects details invalid for the EXISTING category and any category change", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const created = await postActivity(petId, owner.cookie, owner.csrfToken, {
    category: "weight",
    occurredAt: Date.now(),
    tzOffsetMin: 0,
    details: { kg: 4.2 },
  });
  const { data } = (await created.json()) as { data: ActivityResponse };

  for (const body of [
    { details: { amountMl: 100 } }, // water details on a weight activity
    { category: "water" }, // category is immutable (strict schema rejects)
    {}, // nothing to update
  ]) {
    const res = await SELF.fetch(
      `https://app.local/api/pets/${petId}/activities/${data.id}`,
      {
        method: "PATCH",
        headers: authHeaders(owner.cookie, owner.csrfToken),
        body: JSON.stringify(body),
      },
    );
    expect(res.status).toBe(400);
  }
});

it("DELETE soft-deletes: GET 404s, second DELETE 404s, audit row written", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const created = await postActivity(petId, owner.cookie, owner.csrfToken, {
    category: "note",
    occurredAt: Date.now(),
    tzOffsetMin: 0,
    details: {},
  });
  const { data } = (await created.json()) as { data: ActivityResponse };

  const del = await SELF.fetch(
    `https://app.local/api/pets/${petId}/activities/${data.id}`,
    { method: "DELETE", headers: authHeaders(owner.cookie, owner.csrfToken) },
  );
  expect(del.status).toBe(200);

  const get = await SELF.fetch(
    `https://app.local/api/pets/${petId}/activities/${data.id}`,
    { headers: { Cookie: owner.cookie } },
  );
  expect(get.status).toBe(404);

  const again = await SELF.fetch(
    `https://app.local/api/pets/${petId}/activities/${data.id}`,
    { method: "DELETE", headers: authHeaders(owner.cookie, owner.csrfToken) },
  );
  expect(again.status).toBe(404);

  const db = drizzle(env.DB);
  const audits = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityId, data.id))
    .all();
  expect(audits.some((a) => a.action === "delete")).toBe(true);

  // the row still exists in D1 (soft delete)
  const { activities } = await import("../src/db/schema");
  const row = await db
    .select()
    .from(activities)
    .where(eq(activities.id, data.id))
    .get();
  expect(row?.deletedAt).not.toBeNull();
});

it("PATCH/DELETE authz: viewer 403, non-member 404", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const created = await postActivity(petId, owner.cookie, owner.csrfToken, {
    category: "note",
    occurredAt: Date.now(),
    tzOffsetMin: 0,
    details: {},
  });
  const { data } = (await created.json()) as { data: ActivityResponse };
  const url = `https://app.local/api/pets/${petId}/activities/${data.id}`;

  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  const outsider = await seedUserWithSession({ email: "eve@example.com" });

  for (const method of ["PATCH", "DELETE"]) {
    const asViewer = await SELF.fetch(url, {
      method,
      headers: authHeaders(viewer.cookie, viewer.csrfToken),
      body: method === "PATCH" ? JSON.stringify({ memo: "x" }) : undefined,
    });
    expect(asViewer.status).toBe(403);

    const asOutsider = await SELF.fetch(url, {
      method,
      headers: authHeaders(outsider.cookie, outsider.csrfToken),
      body: method === "PATCH" ? JSON.stringify({ memo: "x" }) : undefined,
    });
    expect(asOutsider.status).toBe(404);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w worker`
Expected: new tests FAIL (404 — PATCH/DELETE routes don't exist).

- [ ] **Step 3: Append the handlers to `worker/src/routes/activities.ts`**

Add `activityDetailsSchemas, updateActivitySchema` to the `@pawlog/shared` import, then append:

```ts
activityRoutes.patch(
  "/api/pets/:petId/activities/:id",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateActivitySchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    if (Object.keys(parsed.data).length === 0) {
      return err(c, 400, "validation", "No fields to update");
    }
    const db = drizzle(c.env.DB);
    const activity = await getLiveActivity(
      db,
      c.get("petId"),
      c.req.param("id"),
    );
    if (!activity) return err(c, 404, "not_found", "Not found");

    if (parsed.data.details !== undefined) {
      // category is immutable, so details must fit the EXISTING category
      const details = activityDetailsSchemas[activity.category].safeParse(
        parsed.data.details,
      );
      if (!details.success) {
        return err(c, 400, "validation", details.error.issues[0]?.message ?? "Invalid details");
      }
    }

    const user = c.get("user");
    const now = Date.now();
    const changes: Partial<Activity> = { updatedBy: user.id, updatedAt: now };
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of ["occurredAt", "tzOffsetMin", "memo", "details"] as const) {
      const value = parsed.data[key];
      if (value !== undefined) {
        changes[key] = value as never;
        before[key] = activity[key];
        after[key] = value;
      }
    }
    await db.update(activities).set(changes).where(eq(activities.id, activity.id));
    await writeAudit(db, {
      petId: activity.petId,
      userId: user.id,
      action: "update",
      entity: "activity",
      entityId: activity.id,
      diff: { before, after },
    });
    const updated: Activity = { ...activity, ...changes };
    const photos = await getPhotoMeta(db, activity.id);
    return c.json({ data: activityToResponse(updated, photos) });
  },
);

activityRoutes.delete(
  "/api/pets/:petId/activities/:id",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const activity = await getLiveActivity(
      db,
      c.get("petId"),
      c.req.param("id"),
    );
    if (!activity) return err(c, 404, "not_found", "Not found");
    const user = c.get("user");
    const now = Date.now();
    await db
      .update(activities)
      .set({ deletedAt: now, updatedBy: user.id, updatedAt: now })
      .where(eq(activities.id, activity.id));
    await writeAudit(db, {
      petId: activity.petId,
      userId: user.id,
      action: "delete",
      entity: "activity",
      entityId: activity.id,
    });
    return c.json({ data: { ok: true } });
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all tests, 4 new).

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/activities.ts worker/test/activities.test.ts
git commit -m "feat: add activity update and soft delete with audit diffs"
```

---

### Task 9: Activities list — keyset pagination, filters, memo search

**Files:**
- Create: `worker/src/lib/cursor.ts`
- Modify: `worker/src/routes/activities.ts`
- Modify: `worker/test/helpers.ts`
- Test: `worker/test/cursor.test.ts`
- Test: `worker/test/activities-list.test.ts`

- [ ] **Step 1: Write the failing unit test `worker/test/cursor.test.ts`**

```ts
import { expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../src/lib/cursor";

it("round-trips occurredAt + id", () => {
  const cursor = encodeCursor(1765432100000, "01HZX5N8Q2T3V4W5X6Y7Z8A9B0");
  expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
  expect(decodeCursor(cursor)).toEqual({
    o: 1765432100000,
    i: "01HZX5N8Q2T3V4W5X6Y7Z8A9B0",
  });
});

it("rejects garbage, valid-base64-wrong-shape, and empty cursors", () => {
  expect(decodeCursor("not base64!!")).toBeNull();
  expect(decodeCursor(btoa(JSON.stringify({ x: 1 })))).toBeNull();
  expect(decodeCursor(btoa(JSON.stringify({ o: "1", i: 2 })))).toBeNull();
  expect(decodeCursor("")).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w worker`
Expected: FAIL — module `../src/lib/cursor` not found.

- [ ] **Step 3: Create `worker/src/lib/cursor.ts`**

```ts
/** Opaque keyset cursor: base64url(JSON {o: occurredAt, i: id}). */

export function encodeCursor(occurredAt: number, id: string): string {
  return btoa(JSON.stringify({ o: occurredAt, i: id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function decodeCursor(raw: string): { o: number; i: string } | null {
  try {
    const padded =
      raw.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - (raw.length % 4)) % 4);
    const value = JSON.parse(atob(padded)) as { o?: unknown; i?: unknown };
    if (typeof value.o !== "number" || typeof value.i !== "string") return null;
    return { o: value.o, i: value.i };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run cursor tests to verify they pass**

Run: `npm run test -w worker`
Expected: PASS (2 new).

- [ ] **Step 5: Add `seedActivity` to `worker/test/helpers.ts`**

Append (add `activities` to the schema import and `type Category` to the `@pawlog/shared` import):

```ts
export async function seedActivity(
  petId: string,
  userId: string,
  overrides: Partial<{
    category: Category;
    occurredAt: number;
    tzOffsetMin: number;
    memo: string | null;
    details: unknown;
    deletedAt: number | null;
  }> = {},
): Promise<{ activityId: string }> {
  const db = drizzle(env.DB);
  const now = Date.now();
  const activityId = newId();
  await db.insert(activities).values({
    id: activityId,
    petId,
    category: overrides.category ?? "note",
    occurredAt: overrides.occurredAt ?? now,
    tzOffsetMin: overrides.tzOffsetMin ?? 0,
    memo: overrides.memo ?? null,
    details: overrides.details ?? {},
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    deletedAt: overrides.deletedAt ?? null,
  });
  return { activityId };
}
```

- [ ] **Step 6: Write the failing test `worker/test/activities-list.test.ts`**

```ts
import { SELF } from "cloudflare:test";
import type { ActivityListResponse } from "@pawlog/shared";
import { expect, it } from "vitest";
import { seedActivity, seedPet, seedUserWithSession } from "./helpers";

async function list(petId: string, cookie: string, query = "") {
  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/activities${query}`,
    { headers: { Cookie: cookie } },
  );
  return { status: res.status, body: (await res.json()) as { data: ActivityListResponse } };
}

it("lists newest-first, excludes soft-deleted, default limit", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const t0 = 1_760_000_000_000;
  await seedActivity(petId, userId, { occurredAt: t0 + 1000, memo: "first" });
  await seedActivity(petId, userId, { occurredAt: t0 + 3000, memo: "third" });
  await seedActivity(petId, userId, { occurredAt: t0 + 2000, memo: "second" });
  await seedActivity(petId, userId, {
    occurredAt: t0 + 4000,
    memo: "ghost",
    deletedAt: Date.now(),
  });

  const { status, body } = await list(petId, cookie);
  expect(status).toBe(200);
  expect(body.data.items.map((a) => a.memo)).toEqual([
    "third",
    "second",
    "first",
  ]);
  expect(body.data.nextCursor).toBeNull();
});

it("filters by from/to and repeated category params", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const t0 = 1_760_000_000_000;
  await seedActivity(petId, userId, { category: "food", occurredAt: t0 + 1000 });
  await seedActivity(petId, userId, { category: "water", occurredAt: t0 + 2000 });
  await seedActivity(petId, userId, { category: "weight", occurredAt: t0 + 3000 });

  const byTime = await list(petId, cookie, `?from=${t0 + 1500}&to=${t0 + 2500}`);
  expect(byTime.body.data.items.map((a) => a.category)).toEqual(["water"]);

  const byCat = await list(petId, cookie, "?category=food&category=weight");
  expect(byCat.body.data.items.map((a) => a.category)).toEqual([
    "weight",
    "food",
  ]);

  const badCat = await SELF.fetch(
    `https://app.local/api/pets/${petId}/activities?category=nap`,
    { headers: { Cookie: cookie } },
  );
  expect(badCat.status).toBe(400);
});

it("q matches memo substrings; LIKE wildcards in q are literal", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  await seedActivity(petId, userId, { memo: "ate 100% of breakfast" });
  await seedActivity(petId, userId, { memo: "ate some breakfast" });
  await seedActivity(petId, userId, { memo: "walk in the park" });

  const sub = await list(petId, cookie, "?q=breakfast");
  expect(sub.body.data.items).toHaveLength(2);

  // "%" must match only the literal percent sign, not act as a wildcard
  const literal = await list(petId, cookie, `?q=${encodeURIComponent("100%")}`);
  expect(literal.body.data.items).toHaveLength(1);
  expect(literal.body.data.items[0]?.memo).toBe("ate 100% of breakfast");

  const underscore = await list(petId, cookie, `?q=${encodeURIComponent("_")}`);
  expect(underscore.body.data.items).toHaveLength(0);
});

it("paginates with stable cursors: no duplicates, no skips, id tiebreak", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const t0 = 1_760_000_000_000;
  // 5 activities; two share the same occurredAt to force the id tiebreak
  await seedActivity(petId, userId, { occurredAt: t0 + 1, memo: "a" });
  await seedActivity(petId, userId, { occurredAt: t0 + 2, memo: "b" });
  await seedActivity(petId, userId, { occurredAt: t0 + 3, memo: "c1" });
  await seedActivity(petId, userId, { occurredAt: t0 + 3, memo: "c2" });
  await seedActivity(petId, userId, { occurredAt: t0 + 4, memo: "d" });

  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const query = cursor
      ? `?limit=2&cursor=${encodeURIComponent(cursor)}`
      : "?limit=2";
    const { status, body } = await list(petId, cookie, query);
    expect(status).toBe(200);
    for (const item of body.data.items) seen.push(item.id);
    cursor = body.data.nextCursor;
    pages += 1;
  } while (cursor !== null && pages < 10);

  expect(pages).toBe(3); // 2 + 2 + 1
  expect(new Set(seen).size).toBe(5);
});

it("exact-limit boundary: total == limit yields one page, null cursor after", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const t0 = 1_760_000_000_000;
  await seedActivity(petId, userId, { occurredAt: t0 + 1 });
  await seedActivity(petId, userId, { occurredAt: t0 + 2 });

  const page1 = await list(petId, cookie, "?limit=2");
  expect(page1.body.data.items).toHaveLength(2);
  expect(page1.body.data.nextCursor).toBeNull();
});

it("rejects bad limit and bad cursor", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  for (const query of ["?limit=0", "?limit=201", "?limit=ten", "?cursor=@@@"]) {
    const res = await SELF.fetch(
      `https://app.local/api/pets/${petId}/activities${query}`,
      { headers: { Cookie: cookie } },
    );
    expect(res.status).toBe(400);
  }
});

it("list is 404 for non-members", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const outsider = await seedUserWithSession({ email: "eve@example.com" });
  const { status } = await list(petId, outsider.cookie);
  expect(status).toBe(404);
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npm run test -w worker`
Expected: new tests FAIL (404 — the list route doesn't exist; `GET /api/pets/:petId/activities` currently matches nothing).

- [ ] **Step 8: Append the list handler to `worker/src/routes/activities.ts`**

Extend the imports: add `CATEGORIES, type ActivityListResponse, type Category` to the `@pawlog/shared` import; add `desc, gte, inArray, lt, lte, or, sql` to the `drizzle-orm` import; add:

```ts
import { decodeCursor, encodeCursor } from "../lib/cursor";
```

Then append:

```ts
function parseEpoch(raw: string | undefined): number | undefined | "invalid" {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : "invalid";
}

function escapeLike(input: string): string {
  return input
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

activityRoutes.get(
  "/api/pets/:petId/activities",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const limitRaw = c.req.query("limit");
    const limit = limitRaw === undefined ? 50 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return err(c, 400, "validation", "limit must be an integer 1..200");
    }
    const from = parseEpoch(c.req.query("from"));
    const to = parseEpoch(c.req.query("to"));
    if (from === "invalid" || to === "invalid") {
      return err(c, 400, "validation", "from/to must be epoch milliseconds");
    }
    const cats = c.req.queries("category") ?? [];
    for (const cat of cats) {
      if (!(CATEGORIES as readonly string[]).includes(cat)) {
        return err(c, 400, "validation", `Unknown category: ${cat}`);
      }
    }
    const cursorRaw = c.req.query("cursor");
    let cursor: { o: number; i: string } | undefined;
    if (cursorRaw !== undefined) {
      const decoded = decodeCursor(cursorRaw);
      if (!decoded) return err(c, 400, "validation", "Invalid cursor");
      cursor = decoded;
    }
    const q = c.req.query("q");

    const petId = c.get("petId");
    const conds = [eq(activities.petId, petId), isNull(activities.deletedAt)];
    if (from !== undefined) conds.push(gte(activities.occurredAt, from));
    if (to !== undefined) conds.push(lte(activities.occurredAt, to));
    if (cats.length > 0) {
      conds.push(inArray(activities.category, cats as Category[]));
    }
    if (q) {
      const pattern = `%${escapeLike(q)}%`;
      conds.push(sql`${activities.memo} LIKE ${pattern} ESCAPE '\\'`);
    }
    if (cursor) {
      conds.push(
        or(
          lt(activities.occurredAt, cursor.o),
          and(
            eq(activities.occurredAt, cursor.o),
            lt(activities.id, cursor.i),
          ),
        )!,
      );
    }

    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(activities)
      .where(and(...conds))
      .orderBy(desc(activities.occurredAt), desc(activities.id))
      .limit(limit + 1) // sentinel row: page is full AND more exist
      .all();
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > limit && last ? encodeCursor(last.occurredAt, last.id) : null;

    const ids = page.map((a) => a.id);
    const photoRows =
      ids.length > 0
        ? await db
            .select({
              id: activityPhotos.id,
              activityId: activityPhotos.activityId,
              width: activityPhotos.width,
              height: activityPhotos.height,
              contentType: activityPhotos.contentType,
            })
            .from(activityPhotos)
            .where(inArray(activityPhotos.activityId, ids))
            .all()
        : [];
    const photosByActivity = new Map<string, ActivityPhotoMeta[]>();
    for (const photo of photoRows) {
      const meta: ActivityPhotoMeta = {
        id: photo.id,
        width: photo.width,
        height: photo.height,
        contentType: photo.contentType,
      };
      const bucket = photosByActivity.get(photo.activityId);
      if (bucket) bucket.push(meta);
      else photosByActivity.set(photo.activityId, [meta]);
    }

    const data: ActivityListResponse = {
      items: page.map((a) =>
        activityToResponse(a, photosByActivity.get(a.id) ?? []),
      ),
      nextCursor,
    };
    return c.json({ data });
  },
);
```

Note on the `ESCAPE '\\'` fragment: the TS source `'\\'` renders as `'\'` in SQL — a single-character escape, which is what SQLite requires.

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all tests, 7 new in the list file).

- [ ] **Step 10: Commit**

```bash
git add worker/src/lib/cursor.ts worker/src/routes/activities.ts worker/test/helpers.ts worker/test/cursor.test.ts worker/test/activities-list.test.ts
git commit -m "feat: add activity list with keyset pagination and filters"
```

---

### Task 10: Monthly summary in household time

**Files:**
- Modify: `worker/src/routes/activities.ts`
- Test: `worker/test/summary.test.ts`

The household-time day of an activity is `occurred_at + tz_offset_min * 60000` interpreted as if UTC: `date((occurred_at + tz_offset_min * 60000) / 1000, 'unixepoch')`. Month boundaries are computed the same way, so an activity at 23:30 household time lands on the correct local day regardless of the UTC date.

- [ ] **Step 1: Write the failing test `worker/test/summary.test.ts`**

```ts
import { SELF } from "cloudflare:test";
import type { DaySummaryResponse } from "@pawlog/shared";
import { expect, it } from "vitest";
import { seedActivity, seedPet, seedUserWithSession } from "./helpers";

async function summary(petId: string, cookie: string, month: string) {
  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/summary?month=${month}`,
    { headers: { Cookie: cookie } },
  );
  return { status: res.status, body: (await res.json()) as { data: DaySummaryResponse } };
}

it("counts per day per category in household time", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  // Mar 10 2026, 10:00 UTC, JST (+540) → Mar 10 19:00 household
  const base = Date.UTC(2026, 2, 10, 10, 0);
  await seedActivity(petId, userId, { category: "food", occurredAt: base, tzOffsetMin: 540 });
  await seedActivity(petId, userId, { category: "food", occurredAt: base + 3600_000, tzOffsetMin: 540 });
  await seedActivity(petId, userId, { category: "water", occurredAt: base, tzOffsetMin: 540 });

  const { status, body } = await summary(petId, cookie, "2026-03");
  expect(status).toBe(200);
  expect(body.data.month).toBe("2026-03");
  expect(body.data.days["2026-03-10"]).toEqual({ food: 2, water: 1 });
});

it("tz boundary: 23:30 household lands on the local day, 00:30 on the next", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  // Mar 1 14:30 UTC + 9h = Mar 1 23:30 household (JST)
  await seedActivity(petId, userId, {
    category: "note",
    occurredAt: Date.UTC(2026, 2, 1, 14, 30),
    tzOffsetMin: 540,
  });
  // Mar 1 15:30 UTC + 9h = Mar 2 00:30 household
  await seedActivity(petId, userId, {
    category: "note",
    occurredAt: Date.UTC(2026, 2, 1, 15, 30),
    tzOffsetMin: 540,
  });

  const { body } = await summary(petId, cookie, "2026-03");
  expect(body.data.days["2026-03-01"]).toEqual({ note: 1 });
  expect(body.data.days["2026-03-02"]).toEqual({ note: 1 });
});

it("negative offset: early-UTC March activity belongs to February locally", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  // Mar 1 02:00 UTC - 5h = Feb 28 21:00 household (EST-like)
  await seedActivity(petId, userId, {
    category: "note",
    occurredAt: Date.UTC(2026, 2, 1, 2, 0),
    tzOffsetMin: -300,
  });

  const march = await summary(petId, cookie, "2026-03");
  expect(march.body.data.days).toEqual({});

  const feb = await summary(petId, cookie, "2026-02");
  expect(feb.body.data.days["2026-02-28"]).toEqual({ note: 1 });
});

it("excludes soft-deleted activities and validates the month param", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  await seedActivity(petId, userId, {
    category: "note",
    occurredAt: Date.UTC(2026, 2, 5, 12, 0),
    tzOffsetMin: 0,
    deletedAt: Date.now(),
  });
  const { body } = await summary(petId, cookie, "2026-03");
  expect(body.data.days).toEqual({});

  for (const month of ["2026-13", "2026-3", "march", ""]) {
    const res = await SELF.fetch(
      `https://app.local/api/pets/${petId}/summary?month=${month}`,
      { headers: { Cookie: cookie } },
    );
    expect(res.status).toBe(400);
  }
});

it("summary is 404 for non-members", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const outsider = await seedUserWithSession({ email: "eve@example.com" });
  const { status } = await summary(petId, outsider.cookie, "2026-03");
  expect(status).toBe(404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w worker`
Expected: new tests FAIL (404 — route doesn't exist).

- [ ] **Step 3: Append the summary handler to `worker/src/routes/activities.ts`**

Add `type DaySummaryResponse` to the `@pawlog/shared` import, then append:

```ts
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

activityRoutes.get(
  "/api/pets/:petId/summary",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const month = c.req.query("month");
    if (!month || !MONTH_RE.test(month)) {
      return err(c, 400, "validation", "month must be YYYY-MM");
    }
    const year = Number(month.slice(0, 4));
    const mon = Number(month.slice(5, 7));
    const startMs = Date.UTC(year, mon - 1, 1);
    const endMs = Date.UTC(year, mon, 1);
    const petId = c.get("petId");
    const db = drizzle(c.env.DB);
    const rows = await db.all<{ day: string; category: Category; count: number }>(sql`
      SELECT date((occurred_at + tz_offset_min * 60000) / 1000, 'unixepoch') AS day,
             category,
             COUNT(*) AS count
      FROM activities
      WHERE pet_id = ${petId}
        AND deleted_at IS NULL
        AND occurred_at + tz_offset_min * 60000 >= ${startMs}
        AND occurred_at + tz_offset_min * 60000 < ${endMs}
      GROUP BY day, category
    `);
    const days: DaySummaryResponse["days"] = {};
    for (const row of rows) {
      const day = (days[row.day] ??= {});
      day[row.category] = row.count;
    }
    const data: DaySummaryResponse = { month, days };
    return c.json({ data });
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all tests, 5 new).

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/activities.ts worker/test/summary.test.ts
git commit -m "feat: add monthly summary endpoint in household time"
```

---

### Task 11: Quick Add presets CRUD

**Files:**
- Create: `worker/src/routes/presets.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/presets.test.ts`

- [ ] **Step 1: Write the failing test `worker/test/presets.test.ts`**

```ts
import { env, SELF } from "cloudflare:test";
import type { PresetResponse } from "@pawlog/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { auditLog } from "../src/db/schema";
import {
  authHeaders,
  seedPet,
  seedUserWithSession,
  withMember,
} from "./helpers";

async function createPreset(
  petId: string,
  cookie: string,
  csrfToken: string,
  body: unknown,
) {
  return SELF.fetch(`https://app.local/api/pets/${petId}/presets`, {
    method: "POST",
    headers: authHeaders(cookie, csrfToken),
    body: JSON.stringify(body),
  });
}

it("CRUD round-trip with sort order and audit rows", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);

  const a = await createPreset(petId, cookie, csrfToken, {
    category: "food",
    label: "Morning kibble",
    details: { foodType: "dry", unit: "g", amount: 50 },
    sortOrder: 2,
  });
  expect(a.status).toBe(201);
  const presetA = ((await a.json()) as { data: PresetResponse }).data;

  const b = await createPreset(petId, cookie, csrfToken, {
    category: "water",
    label: "Bowl refill",
    details: { amountMl: 200 },
    sortOrder: 1,
  });
  expect(b.status).toBe(201);

  // list ordered by sortOrder asc
  const listed = await SELF.fetch(`https://app.local/api/pets/${petId}/presets`, {
    headers: { Cookie: cookie },
  });
  expect(listed.status).toBe(200);
  const items = ((await listed.json()) as { data: PresetResponse[] }).data;
  expect(items.map((p) => p.label)).toEqual(["Bowl refill", "Morning kibble"]);

  // patch label + details
  const patched = await SELF.fetch(
    `https://app.local/api/pets/${petId}/presets/${presetA.id}`,
    {
      method: "PATCH",
      headers: authHeaders(cookie, csrfToken),
      body: JSON.stringify({
        label: "Evening kibble",
        details: { foodType: "dry", unit: "g", amount: 40 },
      }),
    },
  );
  expect(patched.status).toBe(200);
  expect(((await patched.json()) as { data: PresetResponse }).data.label).toBe(
    "Evening kibble",
  );

  // delete
  const deleted = await SELF.fetch(
    `https://app.local/api/pets/${petId}/presets/${presetA.id}`,
    { method: "DELETE", headers: authHeaders(cookie, csrfToken) },
  );
  expect(deleted.status).toBe(200);
  const after = await SELF.fetch(`https://app.local/api/pets/${petId}/presets`, {
    headers: { Cookie: cookie },
  });
  expect(((await after.json()) as { data: PresetResponse[] }).data).toHaveLength(1);

  const db = drizzle(env.DB);
  const audits = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.petId, petId))
    .all();
  const presetAudits = audits.filter((x) => x.entity === "preset");
  expect(presetAudits.map((x) => x.action).sort()).toEqual([
    "create",
    "create",
    "delete",
    "update",
  ]);
});

it("rejects details that do not match the preset category", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const res = await createPreset(petId, cookie, csrfToken, {
    category: "water",
    label: "Bad",
    details: { kg: 4 },
  });
  expect(res.status).toBe(400);

  const ok = await createPreset(petId, cookie, csrfToken, {
    category: "water",
    label: "Good",
    details: { amountMl: 100 },
  });
  const preset = ((await ok.json()) as { data: PresetResponse }).data;
  const patched = await SELF.fetch(
    `https://app.local/api/pets/${petId}/presets/${preset.id}`,
    {
      method: "PATCH",
      headers: authHeaders(cookie, csrfToken),
      body: JSON.stringify({ details: { kg: 4 } }), // wrong for water
    },
  );
  expect(patched.status).toBe(400);
});

it("authz: viewer can list but not mutate; non-member 404; cross-pet id 404", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const created = await createPreset(petId, owner.cookie, owner.csrfToken, {
    category: "note",
    label: "Nap",
  });
  const preset = ((await created.json()) as { data: PresetResponse }).data;

  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  const listed = await SELF.fetch(`https://app.local/api/pets/${petId}/presets`, {
    headers: { Cookie: viewer.cookie },
  });
  expect(listed.status).toBe(200);
  const asViewer = await createPreset(petId, viewer.cookie, viewer.csrfToken, {
    category: "note",
    label: "Nope",
  });
  expect(asViewer.status).toBe(403);

  const outsider = await seedUserWithSession({ email: "eve@example.com" });
  const asOutsider = await SELF.fetch(
    `https://app.local/api/pets/${petId}/presets`,
    { headers: { Cookie: outsider.cookie } },
  );
  expect(asOutsider.status).toBe(404);

  // preset id under a different pet → 404
  const { petId: otherPet } = await seedPet(owner.userId);
  const cross = await SELF.fetch(
    `https://app.local/api/pets/${otherPet}/presets/${preset.id}`,
    { method: "DELETE", headers: authHeaders(owner.cookie, owner.csrfToken) },
  );
  expect(cross.status).toBe(404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w worker`
Expected: new tests FAIL (404 — routes don't exist).

- [ ] **Step 3: Create `worker/src/routes/presets.ts`**

```ts
import type { PresetResponse } from "@pawlog/shared";
import {
  activityDetailsSchemas,
  presetSchema,
  updatePresetSchema,
} from "@pawlog/shared";
import { and, asc, eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { Hono } from "hono";
import { quickPresets } from "../db/schema";
import { writeAudit } from "../domain/audit";
import type { AppEnv } from "../env";
import { newId } from "../lib/id";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requirePetRole } from "../middleware/pet-access";
import { requireSession } from "../middleware/session";

export const presetRoutes = new Hono<AppEnv>();

type PresetRow = typeof quickPresets.$inferSelect;

function presetToResponse(row: PresetRow): PresetResponse {
  return {
    id: row.id,
    category: row.category,
    label: row.label,
    details: row.details,
    sortOrder: row.sortOrder,
  };
}

async function getPreset(
  db: DrizzleD1Database,
  petId: string,
  id: string | undefined,
): Promise<PresetRow | undefined> {
  if (!id) return undefined;
  return db
    .select()
    .from(quickPresets)
    .where(and(eq(quickPresets.id, id), eq(quickPresets.petId, petId)))
    .get();
}

presetRoutes.get(
  "/api/pets/:petId/presets",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(quickPresets)
      .where(eq(quickPresets.petId, c.get("petId")))
      .orderBy(asc(quickPresets.sortOrder), asc(quickPresets.createdAt))
      .all();
    return c.json({ data: rows.map(presetToResponse) });
  },
);

presetRoutes.post(
  "/api/pets/:petId/presets",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = presetSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const petId = c.get("petId");
    const db = drizzle(c.env.DB);
    const row: PresetRow = {
      id: newId(),
      petId,
      category: parsed.data.category,
      label: parsed.data.label,
      details: parsed.data.details ?? {},
      sortOrder: parsed.data.sortOrder ?? 0,
      createdAt: Date.now(),
    };
    await db.insert(quickPresets).values(row);
    await writeAudit(db, {
      petId,
      userId: c.get("user").id,
      action: "create",
      entity: "preset",
      entityId: row.id,
      diff: { label: row.label, category: row.category },
    });
    return c.json({ data: presetToResponse(row) }, 201);
  },
);

presetRoutes.patch(
  "/api/pets/:petId/presets/:id",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updatePresetSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    if (Object.keys(parsed.data).length === 0) {
      return err(c, 400, "validation", "No fields to update");
    }
    const db = drizzle(c.env.DB);
    const row = await getPreset(db, c.get("petId"), c.req.param("id"));
    if (!row) return err(c, 404, "not_found", "Not found");
    if (parsed.data.details !== undefined) {
      const details = activityDetailsSchemas[row.category].safeParse(
        parsed.data.details,
      );
      if (!details.success) {
        return err(c, 400, "validation", details.error.issues[0]?.message ?? "Invalid details");
      }
    }
    const changes: Partial<PresetRow> = {};
    if (parsed.data.label !== undefined) changes.label = parsed.data.label;
    if (parsed.data.details !== undefined) changes.details = parsed.data.details;
    if (parsed.data.sortOrder !== undefined) changes.sortOrder = parsed.data.sortOrder;
    await db.update(quickPresets).set(changes).where(eq(quickPresets.id, row.id));
    await writeAudit(db, {
      petId: row.petId,
      userId: c.get("user").id,
      action: "update",
      entity: "preset",
      entityId: row.id,
      diff: { after: changes },
    });
    return c.json({ data: presetToResponse({ ...row, ...changes }) });
  },
);

presetRoutes.delete(
  "/api/pets/:petId/presets/:id",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const row = await getPreset(db, c.get("petId"), c.req.param("id"));
    if (!row) return err(c, 404, "not_found", "Not found");
    await db.delete(quickPresets).where(eq(quickPresets.id, row.id));
    await writeAudit(db, {
      petId: row.petId,
      userId: c.get("user").id,
      action: "delete",
      entity: "preset",
      entityId: row.id,
      diff: { label: row.label },
    });
    return c.json({ data: { ok: true } });
  },
);
```

- [ ] **Step 4: Mount in `worker/src/index.ts`**

```ts
import { presetRoutes } from "./routes/presets";
// ... after app.route("/", activityRoutes):
app.route("/", presetRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all tests, 3 new).

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/presets.ts worker/src/index.ts worker/test/presets.test.ts
git commit -m "feat: add quick preset crud routes"
```

---

### Task 12: Image library — sniffing, metadata stripping, dimensions

The hardest code in this plan. Workers has no native image codec, so EXIF/GPS removal is done by dropping metadata segments/chunks without touching pixel data:

- **JPEG** — stream of segments `FF <marker> <len:u16be> <payload>` where `len` includes its own 2 bytes. EXIF/GPS live in APP1 (`FFE1`), ICC/extra EXIF in APP2 (`FFE2`) — both dropped. From SOS (`FFDA`) onward is entropy-coded data: copied verbatim. Standalone markers (`FF01`, `FFD0`–`FFD8`) have no length field. Dimensions come from any SOFn segment (`FFC0`–`FFCF` except `C4`/`C8`/`CC`): payload is `precision:u8, height:u16be, width:u16be`.
- **PNG** — 8-byte signature then chunks `len:u32be, type:4cc, data[len], crc:u32be`. Metadata chunks `eXIf`, `tEXt`, `zTXt`, `iTXt` are dropped whole; retained chunks keep their original bytes so their CRCs stay valid. Dimensions: IHDR data at fixed offset 16 (`width:u32be, height:u32be`).
- **WebP** — RIFF container: `"RIFF" size:u32le "WEBP"` then chunks `4cc size:u32le data[size] pad?` (chunks are 2-byte aligned). `EXIF` and `"XMP "` chunks are dropped and the RIFF size field is recomputed (`4 + body bytes`). If a `VP8X` header remains, its EXIF (0x08) and XMP (0x04) flag bits are cleared. Dimensions: VP8X stores `width-1`/`height-1` as 24-bit LE at data offsets 4 and 7; lossy `VP8 ` has the start code `9D 01 2A` at data offset 3 followed by 14-bit LE width/height; lossless `VP8L` has signature byte `0x2F` then 28 bits packed LE (`width-1` in bits 0–13, `height-1` in bits 14–27).

**Files:**
- Create: `worker/src/lib/image.ts`
- Create: `worker/test/image-fixtures.ts`
- Test: `worker/test/image.test.ts`

- [ ] **Step 1: Create the fixture builders `worker/test/image-fixtures.ts`**

A plain module (not a `.test.ts` file) so Task 13's photo route tests reuse it. The image lib never validates CRCs or decodes pixels, so checksums and pixel payloads are fake.

```ts
// Hand-crafted minimal image byte fixtures for image.ts tests and photo
// route tests. All fixtures decode as 120x80.

function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}
function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function u16le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff];
}
function u32le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}
function ascii(s: string): number[] {
  return [...s].map((ch) => ch.charCodeAt(0));
}

export function buildJpeg(opts: { withExif?: boolean } = {}): Uint8Array {
  const bytes: number[] = [0xff, 0xd8]; // SOI
  if (opts.withExif ?? true) {
    const payload = [...ascii("Exif"), 0, 0, 0x12, 0x34, 0x56, 0x78];
    bytes.push(0xff, 0xe1, ...u16be(payload.length + 2), ...payload); // APP1
  }
  const dqt = [0, ...Array<number>(64).fill(1)];
  bytes.push(0xff, 0xdb, ...u16be(dqt.length + 2), ...dqt); // DQT (must survive)
  const sof0 = [8, ...u16be(80), ...u16be(120), 1, 0x11, 0x11, 0]; // h=80 w=120
  bytes.push(0xff, 0xc0, ...u16be(sof0.length + 2), ...sof0);
  const sos = [1, 0x11, 0, 0, 63, 0];
  bytes.push(0xff, 0xda, ...u16be(sos.length + 2), ...sos);
  bytes.push(0xaa, 0xbb, 0xcc); // fake entropy-coded data
  bytes.push(0xff, 0xd9); // EOI
  return new Uint8Array(bytes);
}

export function buildPng(opts: { withText?: boolean } = {}): Uint8Array {
  const bytes: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunk = (type: string, data: number[]): number[] => [
    ...u32be(data.length),
    ...ascii(type),
    ...data,
    0, 0, 0, 0, // fake CRC (never validated)
  ];
  const ihdr = [...u32be(120), ...u32be(80), 8, 6, 0, 0, 0]; // w=120 h=80
  bytes.push(...chunk("IHDR", ihdr));
  if (opts.withText ?? true) {
    bytes.push(...chunk("tEXt", [...ascii("Comment"), 0, ...ascii("gps secret")]));
  }
  bytes.push(...chunk("IDAT", [1, 2, 3, 4]));
  bytes.push(...chunk("IEND", []));
  return new Uint8Array(bytes);
}

function webpChunk(cc: string, data: number[]): number[] {
  const out = [...ascii(cc), ...u32le(data.length), ...data];
  if (data.length % 2 === 1) out.push(0); // 2-byte alignment padding
  return out;
}

function riff(body: number[]): Uint8Array {
  return new Uint8Array([
    ...ascii("RIFF"),
    ...u32le(4 + body.length), // "WEBP" + chunks
    ...ascii("WEBP"),
    ...body,
  ]);
}

/** Extended (VP8X) WebP, EXIF+XMP flags set, optional EXIF chunk. */
export function buildWebp(opts: { withExif?: boolean } = {}): Uint8Array {
  const body: number[] = [];
  // VP8X data: flags, 3 reserved, width-1 (24le), height-1 (24le)
  body.push(...webpChunk("VP8X", [0x0c, 0, 0, 119, 0, 0, 79, 0, 0, 0]));
  if (opts.withExif ?? true) {
    body.push(...webpChunk("EXIF", [1, 2, 3, 4, 5])); // odd size → padded
  }
  body.push(
    ...webpChunk("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(120), ...u16le(80)]),
  );
  return riff(body);
}

/** Simple lossy WebP: a lone VP8 chunk, no VP8X. */
export function buildWebpLossy(): Uint8Array {
  return riff(
    webpChunk("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(120), ...u16le(80)]),
  );
}

/** Simple lossless WebP: a lone VP8L chunk. */
export function buildWebpLossless(): Uint8Array {
  // bits 0-13 = width-1 = 119, bits 14-27 = height-1 = 79
  const bits = 119 | (79 << 14);
  return riff(webpChunk("VP8L", [0x2f, ...u32le(bits)]));
}

export function buildGif(): Uint8Array {
  return new Uint8Array([...ascii("GIF89a"), 1, 0, 1, 0, 0, 0, 0]);
}

export function containsSeq(haystack: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}
```

Byte-check on the VP8X data: `width-1 = 119` → bytes `119, 0, 0`; `height-1 = 79` → bytes `79, 0, 0`; with 1 flags byte + 3 reserved that is 10 data bytes — even, no padding. The `VP8 ` data is `3 + 3 + 2 + 2 = 10` bytes — also even. The `VP8L` data is 5 bytes — odd, so `webpChunk` pads it.

- [ ] **Step 2: Write the failing test `worker/test/image.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  imageDimensions,
  sniffImage,
  stripImageMetadata,
} from "../src/lib/image";
import {
  buildGif,
  buildJpeg,
  buildPng,
  buildWebp,
  buildWebpLossless,
  buildWebpLossy,
  containsSeq,
} from "./image-fixtures";

describe("sniffImage", () => {
  it("recognizes jpeg, png, and webp by magic bytes", () => {
    expect(sniffImage(buildJpeg())).toBe("image/jpeg");
    expect(sniffImage(buildPng())).toBe("image/png");
    expect(sniffImage(buildWebp())).toBe("image/webp");
  });

  it("rejects gif, truncated, and empty inputs", () => {
    expect(sniffImage(buildGif())).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull(); // jpeg needs 3
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe("jpeg", () => {
  it("strips the APP1 segment but keeps DQT, SOF, SOS, and entropy data", () => {
    const original = buildJpeg();
    const stripped = stripImageMetadata(original, "image/jpeg");
    expect(stripped.length).toBe(original.length - 14); // APP1: 2+2+10 bytes
    expect(containsSeq(stripped, [0xff, 0xe1])).toBe(false);
    expect(containsSeq(stripped, [0x45, 0x78, 0x69, 0x66])).toBe(false); // "Exif"
    expect(stripped[0]).toBe(0xff);
    expect(stripped[1]).toBe(0xd8);
    expect(containsSeq(stripped, [0xff, 0xdb])).toBe(true); // DQT survives
    // trailing entropy data + EOI intact
    expect([...stripped.slice(-5)]).toEqual([0xaa, 0xbb, 0xcc, 0xff, 0xd9]);
  });

  it("is a no-op on an already-clean jpeg (idempotent)", () => {
    const clean = buildJpeg({ withExif: false });
    expect([...stripImageMetadata(clean, "image/jpeg")]).toEqual([...clean]);
  });

  it("reads dimensions from SOF0, before and after stripping", () => {
    const original = buildJpeg();
    expect(imageDimensions(original, "image/jpeg")).toEqual({
      width: 120,
      height: 80,
    });
    const stripped = stripImageMetadata(original, "image/jpeg");
    expect(imageDimensions(stripped, "image/jpeg")).toEqual({
      width: 120,
      height: 80,
    });
  });
});

describe("png", () => {
  it("strips tEXt but keeps IHDR, IDAT, IEND byte-for-byte", () => {
    const original = buildPng();
    const stripped = stripImageMetadata(original, "image/png");
    expect(containsSeq(stripped, [0x74, 0x45, 0x58, 0x74])).toBe(false); // "tEXt"
    expect(
      containsSeq(stripped, [...("gps secret".split("").map((c) => c.charCodeAt(0)))]),
    ).toBe(false);
    for (const type of ["IHDR", "IDAT", "IEND"]) {
      expect(
        containsSeq(stripped, [...type].map((c) => c.charCodeAt(0))),
      ).toBe(true);
    }
    // signature intact
    expect([...stripped.slice(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });

  it("is idempotent and reads IHDR dimensions", () => {
    const clean = buildPng({ withText: false });
    expect([...stripImageMetadata(clean, "image/png")]).toEqual([...clean]);
    expect(imageDimensions(clean, "image/png")).toEqual({
      width: 120,
      height: 80,
    });
  });
});

describe("webp", () => {
  it("drops the EXIF chunk, fixes the RIFF size, clears VP8X flags", () => {
    const original = buildWebp();
    const stripped = stripImageMetadata(original, "image/webp");
    expect(containsSeq(stripped, [0x45, 0x58, 0x49, 0x46])).toBe(false); // "EXIF"
    // RIFF size field == total length - 8
    const riffSize =
      stripped[4]! |
      (stripped[5]! << 8) |
      (stripped[6]! << 16) |
      (stripped[7]! << 24);
    expect(riffSize).toBe(stripped.length - 8);
    // VP8X EXIF (0x08) and XMP (0x04) flag bits cleared
    expect(stripped[20]! & 0x0c).toBe(0);
    // pixel chunk survives
    expect(containsSeq(stripped, [0x56, 0x50, 0x38, 0x20])).toBe(true); // "VP8 "
  });

  it("is idempotent on a clean file", () => {
    const clean = stripImageMetadata(buildWebp(), "image/webp");
    expect([...stripImageMetadata(clean, "image/webp")]).toEqual([...clean]);
  });

  it("reads dimensions from VP8X, VP8, and VP8L", () => {
    expect(imageDimensions(buildWebp(), "image/webp")).toEqual({
      width: 120,
      height: 80,
    });
    expect(imageDimensions(buildWebpLossy(), "image/webp")).toEqual({
      width: 120,
      height: 80,
    });
    expect(imageDimensions(buildWebpLossless(), "image/webp")).toEqual({
      width: 120,
      height: 80,
    });
  });
});

it("dimension parsers return null on garbage rather than throwing", () => {
  const junk = new Uint8Array(64).fill(0x42);
  expect(imageDimensions(junk, "image/jpeg")).toBeNull();
  expect(imageDimensions(junk, "image/png")).toBeNull();
  expect(imageDimensions(junk, "image/webp")).toBeNull();
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test -w worker`
Expected: FAIL — module `../src/lib/image` not found.

- [ ] **Step 4: Create `worker/src/lib/image.ts`**

```ts
// Pure-JS image handling for Workers (no native codec available).
// Strips metadata WITHOUT re-encoding:
//   JPEG: drops APP1/APP2 segments (EXIF/GPS/XMP/ICC live there).
//   PNG:  drops eXIf/tEXt/zTXt/iTXt chunks. Retained chunks keep their
//         original bytes, so their CRCs remain valid.
//   WebP: drops EXIF/"XMP " RIFF chunks, recomputes the RIFF size field,
//         and clears the VP8X EXIF/XMP flag bits.
// Malformed input is handled conservatively: the unparseable remainder is
// kept verbatim (the upload was already magic-byte-sniffed as an image).

export type ImageContentType = "image/jpeg" | "image/png" | "image/webp";

export function sniffImage(bytes: Uint8Array): ImageContentType | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    fourCC(bytes, 0) === "RIFF" &&
    fourCC(bytes, 8) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function readU16BE(b: Uint8Array, pos: number): number {
  return (b[pos]! << 8) | b[pos + 1]!;
}
function readU32BE(b: Uint8Array, pos: number): number {
  return (
    ((b[pos]! << 24) | (b[pos + 1]! << 16) | (b[pos + 2]! << 8) | b[pos + 3]!) >>>
    0
  );
}
function readU16LE(b: Uint8Array, pos: number): number {
  return b[pos]! | (b[pos + 1]! << 8);
}
function readU32LE(b: Uint8Array, pos: number): number {
  return (
    (b[pos]! | (b[pos + 1]! << 8) | (b[pos + 2]! << 16) | (b[pos + 3]! << 24)) >>>
    0
  );
}
function fourCC(b: Uint8Array, pos: number): string {
  return String.fromCharCode(b[pos]!, b[pos + 1]!, b[pos + 2]!, b[pos + 3]!);
}

function assemble(bytes: Uint8Array, keep: Array<[number, number]>): Uint8Array {
  const total = keep.reduce((n, [s, e]) => n + (e - s), 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const [s, e] of keep) {
    out.set(bytes.subarray(s, e), off);
    off += e - s;
  }
  return out;
}

// --- JPEG --------------------------------------------------------------

function isStandaloneJpegMarker(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8);
}

function stripJpeg(bytes: Uint8Array): Uint8Array {
  const keep: Array<[number, number]> = [[0, 2]]; // SOI
  let pos = 2;
  while (pos + 2 <= bytes.length) {
    if (bytes[pos] !== 0xff) break; // malformed: keep remainder verbatim
    const marker = bytes[pos + 1]!;
    if (marker === 0xda || marker === 0xd9) {
      // SOS (entropy-coded data follows) or EOI: keep everything from here
      keep.push([pos, bytes.length]);
      return assemble(bytes, keep);
    }
    if (isStandaloneJpegMarker(marker)) {
      keep.push([pos, pos + 2]); // no length field
      pos += 2;
      continue;
    }
    if (pos + 4 > bytes.length) break;
    const len = readU16BE(bytes, pos + 2); // includes the 2 length bytes
    const segEnd = pos + 2 + len;
    if (len < 2 || segEnd > bytes.length) break;
    if (marker !== 0xe1 && marker !== 0xe2) keep.push([pos, segEnd]); // drop APP1/APP2
    pos = segEnd;
  }
  if (pos < bytes.length) keep.push([pos, bytes.length]);
  return assemble(bytes, keep);
}

function jpegDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return null;
    const marker = bytes[pos + 1]!;
    if (marker === 0xda || marker === 0xd9) return null; // no SOF before scan
    if (isStandaloneJpegMarker(marker)) {
      pos += 2;
      continue;
    }
    const len = readU16BE(bytes, pos + 2);
    if (len < 2 || pos + 2 + len > bytes.length) return null;
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 && // DHT
      marker !== 0xc8 && // JPG extension
      marker !== 0xcc; // DAC
    if (isSof && len >= 7) {
      // payload: precision(1) height(2 BE) width(2 BE) ...
      return {
        height: readU16BE(bytes, pos + 5),
        width: readU16BE(bytes, pos + 7),
      };
    }
    pos += 2 + len;
  }
  return null;
}

// --- PNG ---------------------------------------------------------------

const PNG_METADATA_CHUNKS = new Set(["eXIf", "tEXt", "zTXt", "iTXt"]);

function stripPng(bytes: Uint8Array): Uint8Array {
  const keep: Array<[number, number]> = [[0, 8]]; // signature
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = readU32BE(bytes, pos);
    const type = fourCC(bytes, pos + 4);
    const chunkEnd = pos + 8 + len + 4; // len + type + data + crc
    if (chunkEnd > bytes.length) break;
    if (!PNG_METADATA_CHUNKS.has(type)) keep.push([pos, chunkEnd]);
    pos = chunkEnd;
    if (type === "IEND") break;
  }
  if (pos < bytes.length) keep.push([pos, bytes.length]);
  return assemble(bytes, keep);
}

function pngDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.length < 24 || fourCC(bytes, 12) !== "IHDR") return null;
  return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) };
}

// --- WebP --------------------------------------------------------------

const WEBP_METADATA_CHUNKS = new Set(["EXIF", "XMP "]);

function stripWebp(bytes: Uint8Array): Uint8Array {
  const keep: Array<[number, number]> = [];
  let pos = 12; // past "RIFF" + size + "WEBP"
  while (pos + 8 <= bytes.length) {
    const cc = fourCC(bytes, pos);
    const size = readU32LE(bytes, pos + 4);
    const chunkEnd = pos + 8 + size + (size % 2); // chunks are 2-byte aligned
    if (chunkEnd > bytes.length) break;
    if (!WEBP_METADATA_CHUNKS.has(cc)) keep.push([pos, chunkEnd]);
    pos = chunkEnd;
  }
  if (pos < bytes.length) keep.push([pos, bytes.length]);
  const bodySize = keep.reduce((n, [s, e]) => n + (e - s), 0);
  const out = new Uint8Array(12 + bodySize);
  out.set(bytes.subarray(0, 12), 0);
  const riffSize = 4 + bodySize; // "WEBP" + chunks
  out[4] = riffSize & 0xff;
  out[5] = (riffSize >>> 8) & 0xff;
  out[6] = (riffSize >>> 16) & 0xff;
  out[7] = (riffSize >>> 24) & 0xff;
  let off = 12;
  for (const [s, e] of keep) {
    out.set(bytes.subarray(s, e), off);
    off += e - s;
  }
  // VP8X flags byte is the first data byte of the first chunk:
  // bit 0x08 = EXIF present, 0x04 = XMP present — both now false.
  if (out.length >= 21 && fourCC(out, 12) === "VP8X") {
    out[20] = out[20]! & ~0x0c;
  }
  return out;
}

function webpDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const cc = fourCC(bytes, pos);
    const size = readU32LE(bytes, pos + 4);
    const data = pos + 8;
    if (data + size > bytes.length) return null;
    if (cc === "VP8X" && size >= 10) {
      return {
        width:
          1 + (bytes[data + 4]! | (bytes[data + 5]! << 8) | (bytes[data + 6]! << 16)),
        height:
          1 + (bytes[data + 7]! | (bytes[data + 8]! << 8) | (bytes[data + 9]! << 16)),
      };
    }
    if (cc === "VP8 " && size >= 10) {
      // lossy key frame: 3-byte frame tag, start code 9D 01 2A, then dims
      if (
        bytes[data + 3] === 0x9d &&
        bytes[data + 4] === 0x01 &&
        bytes[data + 5] === 0x2a
      ) {
        return {
          width: readU16LE(bytes, data + 6) & 0x3fff,
          height: readU16LE(bytes, data + 8) & 0x3fff,
        };
      }
      return null;
    }
    if (cc === "VP8L" && size >= 5 && bytes[data] === 0x2f) {
      const bits = readU32LE(bytes, data + 1);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
    pos = data + size + (size % 2);
  }
  return null;
}

// --- public API ---------------------------------------------------------

export function stripImageMetadata(
  bytes: Uint8Array,
  type: ImageContentType,
): Uint8Array {
  switch (type) {
    case "image/jpeg":
      return stripJpeg(bytes);
    case "image/png":
      return stripPng(bytes);
    case "image/webp":
      return stripWebp(bytes);
  }
}

export function imageDimensions(
  bytes: Uint8Array,
  type: ImageContentType,
): { width: number; height: number } | null {
  switch (type) {
    case "image/jpeg":
      return jpegDimensions(bytes);
    case "image/png":
      return pngDimensions(bytes);
    case "image/webp":
      return webpDimensions(bytes);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all tests, 11 new). If the JPEG length test fails, recount: the APP1 segment is marker (2) + length field (2) + 10 payload bytes = 14.

- [ ] **Step 6: Commit**

```bash
git add worker/src/lib/image.ts worker/test/image-fixtures.ts worker/test/image.test.ts
git commit -m "feat: add pure-js image sniffing, metadata stripping, and dimensions"
```

---

### Task 13: Photos, avatar, and pet deletion with R2 cleanup

Completes the pet route group: `DELETE /api/pets/:petId` (excluded from Task 4) lands here because it needs `deletePetWithStorage`.

**Files:**
- Create: `worker/src/domain/pet-deletion.ts`
- Create: `worker/src/routes/photos.ts`
- Modify: `worker/src/routes/pets.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/photos.test.ts`

- [ ] **Step 1: Write the failing test `worker/test/photos.test.ts`**

```ts
import { env, SELF } from "cloudflare:test";
import type { ActivityPhotoMeta, ActivityResponse } from "@pawlog/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { activityPhotos, auditLog, pets } from "../src/db/schema";
import {
  authHeaders,
  seedActivity,
  seedPet,
  seedUserWithSession,
  withMember,
} from "./helpers";
import { buildGif, buildJpeg, buildPng, containsSeq } from "./image-fixtures";

function upload(
  url: string,
  cookie: string,
  csrfToken: string,
  bytes: Uint8Array,
  filename = "p.jpg",
) {
  const form = new FormData();
  form.append("file", new File([bytes], filename));
  return SELF.fetch(url, {
    method: "POST",
    headers: { Cookie: cookie, "X-CSRF-Token": csrfToken },
    body: form,
  });
}

async function seedOwnerWithActivity() {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const { activityId } = await seedActivity(petId, owner.userId);
  return { ...owner, petId, activityId };
}

it("uploads a jpeg: 201, EXIF stripped in R2, dimensions recorded", async () => {
  const { cookie, csrfToken, petId, activityId } = await seedOwnerWithActivity();
  const res = await upload(
    `https://app.local/api/pets/${petId}/activities/${activityId}/photos`,
    cookie,
    csrfToken,
    buildJpeg(),
  );
  expect(res.status).toBe(201);
  const { data } = (await res.json()) as { data: ActivityPhotoMeta };
  expect(data).toMatchObject({
    width: 120,
    height: 80,
    contentType: "image/jpeg",
  });

  const stored = await env.PHOTOS.get(`pets/${petId}/photos/${data.id}`);
  expect(stored).not.toBeNull();
  const bytes = new Uint8Array(await stored!.arrayBuffer());
  expect(containsSeq(bytes, [0x45, 0x78, 0x69, 0x66])).toBe(false); // "Exif"

  // photo appears on the activity detail
  const detail = await SELF.fetch(
    `https://app.local/api/pets/${petId}/activities/${activityId}`,
    { headers: { Cookie: cookie } },
  );
  const body = (await detail.json()) as { data: ActivityResponse };
  expect(body.data.photos).toEqual([data]);

  // audit row on the activity
  const db = drizzle(env.DB);
  const audits = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityId, activityId))
    .all();
  expect(audits.some((a) => a.action === "update")).toBe(true);
});

it("rejects non-images (400) and oversized files (413)", async () => {
  const { cookie, csrfToken, petId, activityId } = await seedOwnerWithActivity();
  const url = `https://app.local/api/pets/${petId}/activities/${activityId}/photos`;

  const gif = await upload(url, cookie, csrfToken, buildGif(), "p.gif");
  expect(gif.status).toBe(400);
  expect(((await gif.json()) as { error: { code: string } }).error.code).toBe(
    "unsupported_media",
  );

  const big = await upload(
    url,
    cookie,
    csrfToken,
    new Uint8Array(10 * 1024 * 1024 + 1),
  );
  expect(big.status).toBe(413);
});

it("enforces the 6-photo limit per activity", async () => {
  const { cookie, csrfToken, petId, activityId } = await seedOwnerWithActivity();
  const db = drizzle(env.DB);
  for (let i = 0; i < 6; i++) {
    await db.insert(activityPhotos).values({
      id: `photo_${i}`,
      activityId,
      r2Key: `pets/${petId}/photos/photo_${i}`,
      width: 1,
      height: 1,
      contentType: "image/png",
      createdAt: Date.now(),
    });
  }
  const res = await upload(
    `https://app.local/api/pets/${petId}/activities/${activityId}/photos`,
    cookie,
    csrfToken,
    buildPng(),
  );
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
    "photo_limit",
  );
});

it("upload authz: viewer 403, non-member 404, deleted activity 404", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const { activityId } = await seedActivity(petId, owner.userId);
  const url = `https://app.local/api/pets/${petId}/activities/${activityId}/photos`;

  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  expect(
    (await upload(url, viewer.cookie, viewer.csrfToken, buildPng())).status,
  ).toBe(403);

  const outsider = await seedUserWithSession({ email: "eve@example.com" });
  expect(
    (await upload(url, outsider.cookie, outsider.csrfToken, buildPng())).status,
  ).toBe(404);

  const { activityId: ghost } = await seedActivity(petId, owner.userId, {
    deletedAt: Date.now(),
  });
  expect(
    (
      await upload(
        `https://app.local/api/pets/${petId}/activities/${ghost}/photos`,
        owner.cookie,
        owner.csrfToken,
        buildPng(),
      )
    ).status,
  ).toBe(404);
});

it("serves a photo to members with private caching; size param ignored", async () => {
  const { cookie, csrfToken, petId, activityId } =
    await seedOwnerWithActivity();
  const created = await upload(
    `https://app.local/api/pets/${petId}/activities/${activityId}/photos`,
    cookie,
    csrfToken,
    buildPng(),
    "p.png",
  );
  const { data } = (await created.json()) as { data: ActivityPhotoMeta };

  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  const res = await SELF.fetch(
    `https://app.local/api/photos/${data.id}?size=thumb`,
    { headers: { Cookie: viewer.cookie } },
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("image/png");
  expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");
  expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);

  const outsider = await seedUserWithSession({ email: "eve@example.com" });
  const denied = await SELF.fetch(`https://app.local/api/photos/${data.id}`, {
    headers: { Cookie: outsider.cookie },
  });
  expect(denied.status).toBe(404);
});

it("DELETE photo removes the row and the R2 object, with audit", async () => {
  const { cookie, csrfToken, petId, activityId } = await seedOwnerWithActivity();
  const created = await upload(
    `https://app.local/api/pets/${petId}/activities/${activityId}/photos`,
    cookie,
    csrfToken,
    buildPng(),
    "p.png",
  );
  const { data } = (await created.json()) as { data: ActivityPhotoMeta };

  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  const asViewer = await SELF.fetch(`https://app.local/api/photos/${data.id}`, {
    method: "DELETE",
    headers: authHeaders(viewer.cookie, viewer.csrfToken),
  });
  expect(asViewer.status).toBe(403);

  const res = await SELF.fetch(`https://app.local/api/photos/${data.id}`, {
    method: "DELETE",
    headers: authHeaders(cookie, csrfToken),
  });
  expect(res.status).toBe(200);
  expect(await env.PHOTOS.get(`pets/${petId}/photos/${data.id}`)).toBeNull();

  const db = drizzle(env.DB);
  const rows = await db
    .select()
    .from(activityPhotos)
    .where(eq(activityPhotos.id, data.id))
    .all();
  expect(rows).toHaveLength(0);
});

it("avatar upload + serve round-trip; GET 404 when unset", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);

  const missing = await SELF.fetch(
    `https://app.local/api/pets/${petId}/avatar`,
    { headers: { Cookie: cookie } },
  );
  expect(missing.status).toBe(404);

  const up = await upload(
    `https://app.local/api/pets/${petId}/avatar`,
    cookie,
    csrfToken,
    buildPng(),
    "avatar.png",
  );
  expect(up.status).toBe(200);

  const res = await SELF.fetch(`https://app.local/api/pets/${petId}/avatar`, {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("image/png");

  const db = drizzle(env.DB);
  const pet = await db.select().from(pets).where(eq(pets.id, petId)).get();
  expect(pet?.avatarR2Key).toBe(`pets/${petId}/avatar`);
});

it("DELETE pet: owner only; cascades rows and wipes the R2 prefix", async () => {
  const { userId, cookie, csrfToken, petId, activityId } =
    await seedOwnerWithActivity();
  await upload(
    `https://app.local/api/pets/${petId}/activities/${activityId}/photos`,
    cookie,
    csrfToken,
    buildPng(),
    "p.png",
  );
  await upload(
    `https://app.local/api/pets/${petId}/avatar`,
    cookie,
    csrfToken,
    buildPng(),
    "avatar.png",
  );

  const editor = await seedUserWithSession({ email: "ed@example.com" });
  await withMember(petId, editor.userId, "editor");
  const asEditor = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    method: "DELETE",
    headers: authHeaders(editor.cookie, editor.csrfToken),
  });
  expect(asEditor.status).toBe(403);

  const res = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    method: "DELETE",
    headers: authHeaders(cookie, csrfToken),
  });
  expect(res.status).toBe(200);

  const gone = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    headers: { Cookie: cookie },
  });
  expect(gone.status).toBe(404);

  const listing = await env.PHOTOS.list({ prefix: `pets/${petId}/` });
  expect(listing.objects).toHaveLength(0);

  const db = drizzle(env.DB);
  const { activities } = await import("../src/db/schema");
  const rows = await db
    .select()
    .from(activities)
    .where(eq(activities.petId, petId))
    .all();
  expect(rows).toHaveLength(0); // FK cascade

  const audits = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.petId, petId))
    .all();
  expect(
    audits.some((a) => a.entity === "pet" && a.action === "delete"),
  ).toBe(true);
  expect(audits.at(-1)?.userId).toBe(userId);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w worker`
Expected: new tests FAIL (404 — photo routes and DELETE pet don't exist).

- [ ] **Step 3: Create `worker/src/domain/pet-deletion.ts`**

```ts
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { pets } from "../db/schema";

/**
 * Deletes every R2 object under the pet's prefix (cursor loop handles
 * truncated listings), then the pet row — FK cascades remove memberships,
 * activities, photos rows, presets, schedules, and targets.
 * Callers write the audit row BEFORE calling this.
 */
export async function deletePetWithStorage(
  db: DrizzleD1Database,
  bucket: R2Bucket,
  petId: string,
): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const listing = await bucket.list({ prefix: `pets/${petId}/`, cursor });
    if (listing.objects.length > 0) {
      await bucket.delete(listing.objects.map((o) => o.key));
    }
    if (!listing.truncated) break;
    cursor = listing.cursor;
  }
  await db.delete(pets).where(eq(pets.id, petId));
}
```

- [ ] **Step 4: Create `worker/src/routes/photos.ts`**

```ts
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import type { Context } from "hono";
import { activities, activityPhotos, pets } from "../db/schema";
import { writeAudit } from "../domain/audit";
import type { AppEnv } from "../env";
import { newId } from "../lib/id";
import {
  imageDimensions,
  sniffImage,
  stripImageMetadata,
  type ImageContentType,
} from "../lib/image";
import { rateLimit } from "../lib/rate-limit";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import {
  requirePetRole,
  resolvePetAccess,
  roleAtLeast,
} from "../middleware/pet-access";
import { requireSession } from "../middleware/session";

export const photoRoutes = new Hono<AppEnv>();

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_PHOTOS_PER_ACTIVITY = 6;
const uploadLimit = rateLimit("upload", 20, 60_000, "user");

type Upload = {
  bytes: Uint8Array;
  contentType: ImageContentType;
  width: number | null;
  height: number | null;
};

/** Shared upload pipeline: size caps, magic-byte sniff, metadata strip. */
async function readImageUpload(
  c: Context<AppEnv>,
): Promise<Upload | Response> {
  const contentLength = Number(c.req.header("Content-Length") ?? "0");
  // fast reject before buffering (multipart overhead allowance: 4 KiB)
  if (contentLength > MAX_PHOTO_BYTES + 4096) {
    return err(c, 413, "too_large", "File exceeds 10 MB");
  }
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return err(c, 400, "validation", "Multipart field 'file' is required");
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return err(c, 413, "too_large", "File exceeds 10 MB");
  }
  const raw = new Uint8Array(await file.arrayBuffer());
  const contentType = sniffImage(raw);
  if (!contentType) {
    return err(c, 400, "unsupported_media", "Only JPEG, PNG, and WebP are accepted");
  }
  const bytes = stripImageMetadata(raw, contentType);
  const dims = imageDimensions(bytes, contentType);
  return {
    bytes,
    contentType,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
  };
}

photoRoutes.post(
  "/api/pets/:petId/activities/:activityId/photos",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  uploadLimit,
  async (c) => {
    const petId = c.get("petId");
    const activityId = c.req.param("activityId");
    const db = drizzle(c.env.DB);
    const activity = await db
      .select()
      .from(activities)
      .where(
        and(
          eq(activities.id, activityId),
          eq(activities.petId, petId),
          isNull(activities.deletedAt),
        ),
      )
      .get();
    if (!activity) return err(c, 404, "not_found", "Not found");

    const existing = await db
      .select({ id: activityPhotos.id })
      .from(activityPhotos)
      .where(eq(activityPhotos.activityId, activity.id))
      .all();
    if (existing.length >= MAX_PHOTOS_PER_ACTIVITY) {
      return err(c, 400, "photo_limit", "An activity can have at most 6 photos");
    }

    const upload = await readImageUpload(c);
    if (upload instanceof Response) return upload;

    const photoId = newId();
    const r2Key = `pets/${petId}/photos/${photoId}`;
    await c.env.PHOTOS.put(r2Key, upload.bytes, {
      httpMetadata: { contentType: upload.contentType },
    });
    await db.insert(activityPhotos).values({
      id: photoId,
      activityId: activity.id,
      r2Key,
      width: upload.width,
      height: upload.height,
      contentType: upload.contentType,
      createdAt: Date.now(),
    });
    await writeAudit(db, {
      petId,
      userId: c.get("user").id,
      action: "update",
      entity: "activity",
      entityId: activity.id,
      diff: { photoAdded: photoId },
    });
    return c.json(
      {
        data: {
          id: photoId,
          width: upload.width,
          height: upload.height,
          contentType: upload.contentType,
        },
      },
      201,
    );
  },
);

photoRoutes.get("/api/photos/:photoId", requireSession, async (c) => {
  // `size=thumb|full` is accepted and IGNORED: resizing is deferred to
  // deployment (Cloudflare Images); the stripped original is always served.
  const db = drizzle(c.env.DB);
  const row = await db
    .select({ photo: activityPhotos, petId: activities.petId })
    .from(activityPhotos)
    .innerJoin(activities, eq(activityPhotos.activityId, activities.id))
    .where(eq(activityPhotos.id, c.req.param("photoId")))
    .get();
  if (!row) return err(c, 404, "not_found", "Not found");
  const access = await resolvePetAccess(db, row.petId, c.get("user").id);
  if (!access) return err(c, 404, "not_found", "Not found");
  const obj = await c.env.PHOTOS.get(row.photo.r2Key);
  if (!obj) return err(c, 404, "not_found", "Not found");
  return c.body(obj.body, 200, {
    "Content-Type": row.photo.contentType,
    "Cache-Control": "private, max-age=86400",
  });
});

photoRoutes.delete(
  "/api/photos/:photoId",
  requireSession,
  requireCsrf,
  async (c) => {
    const db = drizzle(c.env.DB);
    const row = await db
      .select({ photo: activityPhotos, petId: activities.petId })
      .from(activityPhotos)
      .innerJoin(activities, eq(activityPhotos.activityId, activities.id))
      .where(eq(activityPhotos.id, c.req.param("photoId")))
      .get();
    if (!row) return err(c, 404, "not_found", "Not found");
    const access = await resolvePetAccess(db, row.petId, c.get("user").id);
    if (!access) return err(c, 404, "not_found", "Not found");
    if (!roleAtLeast(access.role, "editor")) {
      return err(c, 403, "forbidden", "Insufficient role");
    }
    await c.env.PHOTOS.delete(row.photo.r2Key);
    await db.delete(activityPhotos).where(eq(activityPhotos.id, row.photo.id));
    await writeAudit(db, {
      petId: row.petId,
      userId: c.get("user").id,
      action: "update",
      entity: "activity",
      entityId: row.photo.activityId,
      diff: { photoRemoved: row.photo.id },
    });
    return c.json({ data: { ok: true } });
  },
);

photoRoutes.post(
  "/api/pets/:petId/avatar",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  uploadLimit,
  async (c) => {
    const upload = await readImageUpload(c);
    if (upload instanceof Response) return upload;
    const pet = c.get("pet");
    const r2Key = `pets/${pet.id}/avatar`;
    await c.env.PHOTOS.put(r2Key, upload.bytes, {
      httpMetadata: { contentType: upload.contentType },
    });
    const db = drizzle(c.env.DB);
    await db.update(pets).set({ avatarR2Key: r2Key }).where(eq(pets.id, pet.id));
    await writeAudit(db, {
      petId: pet.id,
      userId: c.get("user").id,
      action: "update",
      entity: "pet",
      entityId: pet.id,
      diff: { avatarUpdated: true },
    });
    return c.json({ data: { avatarR2Key: r2Key } });
  },
);

photoRoutes.get(
  "/api/pets/:petId/avatar",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const pet = c.get("pet");
    if (!pet.avatarR2Key) return err(c, 404, "not_found", "Not found");
    const obj = await c.env.PHOTOS.get(pet.avatarR2Key);
    if (!obj) return err(c, 404, "not_found", "Not found");
    return c.body(obj.body, 200, {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=86400",
    });
  },
);
```

- [ ] **Step 5: Add `DELETE /api/pets/:petId` to `worker/src/routes/pets.ts`**

Add the import:

```ts
import { deletePetWithStorage } from "../domain/pet-deletion";
```

Append:

```ts
petRoutes.delete(
  "/api/pets/:petId",
  requireSession,
  requireCsrf,
  requirePetRole("owner"),
  async (c) => {
    const pet = c.get("pet");
    const db = drizzle(c.env.DB);
    // audit BEFORE deletion; audit_log has no FKs so the row survives
    await writeAudit(db, {
      petId: pet.id,
      userId: c.get("user").id,
      action: "delete",
      entity: "pet",
      entityId: pet.id,
      diff: { name: pet.name },
    });
    await deletePetWithStorage(db, c.env.PHOTOS, pet.id);
    return c.json({ data: { ok: true } });
  },
);
```

- [ ] **Step 6: Mount in `worker/src/index.ts`**

```ts
import { photoRoutes } from "./routes/photos";
// ... after app.route("/", presetRoutes):
app.route("/", photoRoutes);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all tests, 8 new).

- [ ] **Step 8: Commit**

```bash
git add worker/src/domain/pet-deletion.ts worker/src/routes/photos.ts worker/src/routes/pets.ts worker/src/index.ts worker/test/photos.test.ts
git commit -m "feat: add photo upload, serving, avatar, and pet deletion with r2 cleanup"
```

---

### Task 14: Data export — account JSON + pet JSON/CSV

**Files:**
- Create: `worker/src/domain/export.ts`
- Create: `worker/src/routes/export.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/export-domain.test.ts`
- Test: `worker/test/export.test.ts`

Export shape decisions (encode as-is): the account export covers pets where the caller is an **owner**; activity rows include soft-deleted ones flagged with `deleted: true`. The pet JSON export does the same; the pet **CSV** export (the human-readable view) excludes soft-deleted rows and renders `occurred_at` as ISO-8601 with the stored household offset applied.

- [ ] **Step 1: Write the failing unit test `worker/test/export-domain.test.ts`**

```ts
import { expect, it } from "vitest";
import { csvLine, isoWithOffset } from "../src/domain/export";

it("csvLine quotes fields containing commas, quotes, or newlines", () => {
  expect(csvLine(["plain", "with,comma"])).toBe('plain,"with,comma"');
  expect(csvLine(['say "hi"'])).toBe('"say ""hi"""');
  expect(csvLine(["line\nbreak"])).toBe('"line\nbreak"');
  expect(csvLine(["", "b"])).toBe(",b");
});

it("isoWithOffset renders household time with the offset suffix", () => {
  expect(isoWithOffset(Date.UTC(2026, 0, 1, 12, 0), 540)).toBe(
    "2026-01-01T21:00:00.000+09:00",
  );
  expect(isoWithOffset(Date.UTC(2026, 0, 1, 12, 0), -330)).toBe(
    "2026-01-01T06:30:00.000-05:30",
  );
  expect(isoWithOffset(Date.UTC(2026, 0, 1, 12, 0), 0)).toBe(
    "2026-01-01T12:00:00.000+00:00",
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w worker`
Expected: FAIL — module `../src/domain/export` not found.

- [ ] **Step 3: Create `worker/src/domain/export.ts`**

```ts
/** RFC 4180 escaping: wrap in quotes when needed, double inner quotes. */
export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function csvLine(fields: string[]): string {
  return fields.map(csvEscape).join(",");
}

/** Epoch ms + household offset → "YYYY-MM-DDTHH:mm:ss.SSS±HH:MM". */
export function isoWithOffset(epochMs: number, tzOffsetMin: number): string {
  const shifted = new Date(epochMs + tzOffsetMin * 60000).toISOString();
  const sign = tzOffsetMin < 0 ? "-" : "+";
  const abs = Math.abs(tzOffsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${shifted.slice(0, 23)}${sign}${hh}:${mm}`;
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npm run test -w worker`
Expected: PASS (2 new).

- [ ] **Step 5: Write the failing integration test `worker/test/export.test.ts`**

```ts
import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";
import {
  seedActivity,
  seedPet,
  seedUserWithSession,
  withMember,
} from "./helpers";

it("GET /api/me/export returns owner pets with flagged soft-deleted activities", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId, "owner", { name: "Momo" });
  await seedActivity(petId, userId, { memo: "alive" });
  await seedActivity(petId, userId, { memo: "ghost", deletedAt: Date.now() });

  // a pet where the caller is only a viewer must NOT be exported
  const other = await seedUserWithSession({ email: "o@example.com" });
  const { petId: viewedPet } = await seedPet(other.userId);
  await withMember(viewedPet, userId, "viewer");

  const res = await SELF.fetch("https://app.local/api/me/export", {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Disposition")).toContain("attachment");
  const body = (await res.json()) as {
    user: { id: string };
    pets: Array<{
      pet: { id: string; name: string };
      activities: Array<{ memo: string | null; deleted: boolean }>;
    }>;
  };
  expect(body.user.id).toBe(userId);
  expect(body.pets).toHaveLength(1);
  expect(body.pets[0]?.pet.name).toBe("Momo");
  const activities = body.pets[0]!.activities;
  expect(activities.find((a) => a.memo === "alive")?.deleted).toBe(false);
  expect(activities.find((a) => a.memo === "ghost")?.deleted).toBe(true);
});

it("GET /api/pets/:petId/export?format=json works for viewers", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  await seedActivity(petId, owner.userId, { memo: "hello" });

  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/export?format=json`,
    { headers: { Cookie: viewer.cookie } },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    pet: { id: string };
    activities: unknown[];
    photos: unknown[];
  };
  expect(body.pet.id).toBe(petId);
  expect(body.activities).toHaveLength(1);
  expect(body.photos).toEqual([]);
});

it("CSV export escapes fields and excludes soft-deleted rows", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  await seedActivity(petId, userId, {
    category: "note",
    occurredAt: Date.UTC(2026, 0, 1, 12, 0),
    tzOffsetMin: 540,
    memo: 'ate "everything", then napped',
  });
  await seedActivity(petId, userId, {
    memo: "ghost",
    deletedAt: Date.now(),
  });

  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/export?format=csv`,
    { headers: { Cookie: cookie } },
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toContain("text/csv");
  const text = await res.text();
  const lines = text.trim().split("\r\n");
  expect(lines[0]).toBe("id,category,occurred_at,memo,details");
  expect(lines).toHaveLength(2); // header + 1 live row
  expect(lines[1]).toContain('"ate ""everything"", then napped"');
  expect(lines[1]).toContain("2026-01-01T21:00:00.000+09:00");
  expect(text).not.toContain("ghost");
});

it("rejects unknown formats and non-members", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const bad = await SELF.fetch(
    `https://app.local/api/pets/${petId}/export?format=xml`,
    { headers: { Cookie: cookie } },
  );
  expect(bad.status).toBe(400);

  const outsider = await seedUserWithSession({ email: "eve@example.com" });
  const denied = await SELF.fetch(
    `https://app.local/api/pets/${petId}/export?format=json`,
    { headers: { Cookie: outsider.cookie } },
  );
  expect(denied.status).toBe(404);
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm run test -w worker`
Expected: new tests FAIL (404 — routes don't exist).

- [ ] **Step 7: Create `worker/src/routes/export.ts`**

```ts
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import {
  activities,
  activityPhotos,
  careSchedules,
  petMembers,
  pets,
  petTargets,
  quickPresets,
} from "../db/schema";
import { csvLine, isoWithOffset } from "../domain/export";
import type { AppEnv } from "../env";
import { err } from "../lib/respond";
import { requirePetRole } from "../middleware/pet-access";
import { requireSession } from "../middleware/session";

export const exportRoutes = new Hono<AppEnv>();

exportRoutes.get("/api/me/export", requireSession, async (c) => {
  const user = c.get("user");
  const db = drizzle(c.env.DB);
  const ownerships = await db
    .select()
    .from(petMembers)
    .where(and(eq(petMembers.userId, user.id), eq(petMembers.role, "owner")))
    .all();

  const exportedPets = [];
  for (const membership of ownerships) {
    const pet = await db
      .select()
      .from(pets)
      .where(eq(pets.id, membership.petId))
      .get();
    if (!pet) continue;
    const petActivities = await db
      .select()
      .from(activities)
      .where(eq(activities.petId, pet.id))
      .all();
    const schedules = await db
      .select()
      .from(careSchedules)
      .where(eq(careSchedules.petId, pet.id))
      .all();
    const presets = await db
      .select()
      .from(quickPresets)
      .where(eq(quickPresets.petId, pet.id))
      .all();
    const targets = await db
      .select()
      .from(petTargets)
      .where(eq(petTargets.petId, pet.id))
      .get();
    exportedPets.push({
      pet,
      targets: targets ?? null,
      schedules,
      presets,
      activities: petActivities.map((a) => ({
        ...a,
        deleted: a.deletedAt !== null,
      })),
    });
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      locale: user.locale,
      createdAt: user.createdAt,
    },
    pets: exportedPets,
  };
  return c.body(JSON.stringify(payload, null, 2), 200, {
    "Content-Type": "application/json",
    "Content-Disposition": 'attachment; filename="pawlog-export.json"',
  });
});

exportRoutes.get(
  "/api/pets/:petId/export",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const format = c.req.query("format") ?? "json";
    if (format !== "json" && format !== "csv") {
      return err(c, 400, "validation", "format must be json or csv");
    }
    const pet = c.get("pet");
    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(activities)
      .where(eq(activities.petId, pet.id))
      .all();

    if (format === "json") {
      const ids = rows.map((a) => a.id);
      const photos =
        ids.length > 0
          ? await db
              .select({
                id: activityPhotos.id,
                activityId: activityPhotos.activityId,
                width: activityPhotos.width,
                height: activityPhotos.height,
                contentType: activityPhotos.contentType,
                createdAt: activityPhotos.createdAt,
              })
              .from(activityPhotos)
              .where(inArray(activityPhotos.activityId, ids))
              .all()
          : [];
      const payload = {
        exportedAt: new Date().toISOString(),
        pet,
        activities: rows.map((a) => ({ ...a, deleted: a.deletedAt !== null })),
        photos,
      };
      return c.body(JSON.stringify(payload, null, 2), 200, {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="pawlog-${pet.id}.json"`,
      });
    }

    const lines = [csvLine(["id", "category", "occurred_at", "memo", "details"])];
    for (const a of rows) {
      if (a.deletedAt !== null) continue; // human-readable view: live rows only
      lines.push(
        csvLine([
          a.id,
          a.category,
          isoWithOffset(a.occurredAt, a.tzOffsetMin),
          a.memo ?? "",
          JSON.stringify(a.details),
        ]),
      );
    }
    return c.body(lines.join("\r\n") + "\r\n", 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pawlog-${pet.id}.csv"`,
    });
  },
);
```

- [ ] **Step 8: Mount in `worker/src/index.ts`**

```ts
import { exportRoutes } from "./routes/export";
// ... after app.route("/", photoRoutes):
app.route("/", exportRoutes);
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all tests, 6 new).

- [ ] **Step 10: Commit**

```bash
git add worker/src/domain/export.ts worker/src/routes/export.ts worker/src/index.ts worker/test/export-domain.test.ts worker/test/export.test.ts
git commit -m "feat: add data export endpoints for account and pet"
```

---

### Task 15: Account deletion + final wire-check

**Files:**
- Modify: `worker/src/routes/me.ts`
- Modify: `README.md`
- Test: `worker/test/account-deletion.test.ts`

- [ ] **Step 1: Write the failing test `worker/test/account-deletion.test.ts`**

```ts
import { env, SELF } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, expect, it } from "vitest";
import { auditLog, petMembers, pets, sessions, users } from "../src/db/schema";
import { resetRateLimits } from "../src/lib/rate-limit";
import {
  authHeaders,
  seedActivity,
  seedPet,
  seedUserWithSession,
  withMember,
} from "./helpers";

beforeEach(() => resetRateLimits());
afterEach(() => resetRateLimits());

function deleteMe(cookie: string, csrfToken: string, confirmEmail: string) {
  return SELF.fetch("https://app.local/api/me", {
    method: "DELETE",
    headers: authHeaders(cookie, csrfToken),
    body: JSON.stringify({ confirmEmail }),
  });
}

it("rejects a wrong or differently-cased confirmation email", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  for (const email of ["other@example.com", "PAT@example.com", ""]) {
    const res = await deleteMe(cookie, csrfToken, email);
    expect(res.status).toBe(400);
  }
  const db = drizzle(env.DB);
  expect(
    await db.select().from(users).where(eq(users.id, userId)).get(),
  ).toBeTruthy();
});

it("deletes the user, sessions, sole-owned pets, and their R2 objects", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  await seedActivity(petId, userId);
  await env.PHOTOS.put(`pets/${petId}/photos/x`, new Uint8Array([1, 2, 3]));
  await env.PHOTOS.put(`pets/${petId}/avatar`, new Uint8Array([4, 5, 6]));

  const res = await deleteMe(cookie, csrfToken, "pat@example.com");
  expect(res.status).toBe(200);
  // session cookie cleared
  expect(
    res.headers.getSetCookie().some((v) => v.startsWith("session=")),
  ).toBe(true);

  const db = drizzle(env.DB);
  expect(await db.select().from(users).all()).toHaveLength(0);
  expect(await db.select().from(sessions).all()).toHaveLength(0);
  expect(await db.select().from(pets).all()).toHaveLength(0);
  const listing = await env.PHOTOS.list({ prefix: `pets/${petId}/` });
  expect(listing.objects).toHaveLength(0);

  // old cookie is dead
  const me = await SELF.fetch("https://app.local/api/me", {
    headers: { Cookie: cookie },
  });
  expect(me.status).toBe(401);
});

it("shared pets with another owner survive, with a member-delete audit row", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const coOwner = await seedUserWithSession({ email: "co@example.com" });
  const { petId: sharedPet } = await seedPet(userId, "owner");
  await withMember(sharedPet, coOwner.userId, "owner");

  const other = await seedUserWithSession({ email: "boss@example.com" });
  const { petId: editedPet } = await seedPet(other.userId, "owner");
  await withMember(editedPet, userId, "editor");

  const res = await deleteMe(cookie, csrfToken, "pat@example.com");
  expect(res.status).toBe(200);

  const db = drizzle(env.DB);
  // both pets survive; the deleted user's memberships cascaded away
  expect(await db.select().from(pets).all()).toHaveLength(2);
  expect(
    await db.select().from(petMembers).where(eq(petMembers.userId, userId)).all(),
  ).toHaveLength(0);

  for (const petId of [sharedPet, editedPet]) {
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.petId, petId))
      .all();
    expect(
      audits.some(
        (a) =>
          a.entity === "member" && a.action === "delete" && a.entityId === userId,
      ),
    ).toBe(true);
  }
});

it("is rate limited to 3 attempts per hour per user", async () => {
  const { cookie, csrfToken } = await seedUserWithSession();
  for (let i = 0; i < 3; i++) {
    const res = await deleteMe(cookie, csrfToken, "wrong@example.com");
    expect(res.status).toBe(400); // wrong email, but counted
  }
  const blocked = await deleteMe(cookie, csrfToken, "wrong@example.com");
  expect(blocked.status).toBe(429);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w worker`
Expected: new tests FAIL (404 — DELETE /api/me doesn't exist).

- [ ] **Step 3: Add the handler to `worker/src/routes/me.ts`**

Extend the imports: add `deleteMeSchema` to the `@pawlog/shared` import; add `and` to the `drizzle-orm` import; and add:

```ts
import { deletePetWithStorage } from "../domain/pet-deletion";
import { clearSessionCookie } from "../lib/cookies";
import { rateLimit } from "../lib/rate-limit";
import { writeAudit } from "../domain/audit";
```

Append:

```ts
meRoutes.delete(
  "/",
  requireSession,
  requireCsrf,
  rateLimit("me-delete", 3, 60 * 60 * 1000, "user"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = deleteMeSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const user = c.get("user");
    if (parsed.data.confirmEmail !== user.email) {
      // exact, case-sensitive match required
      return err(c, 400, "confirm_mismatch", "Email confirmation does not match");
    }
    const db = drizzle(c.env.DB);
    const memberships = await db
      .select()
      .from(petMembers)
      .where(eq(petMembers.userId, user.id))
      .all();
    for (const membership of memberships) {
      let soleOwner = false;
      if (membership.role === "owner") {
        const owners = await db
          .select({ userId: petMembers.userId })
          .from(petMembers)
          .where(
            and(
              eq(petMembers.petId, membership.petId),
              eq(petMembers.role, "owner"),
            ),
          )
          .all();
        soleOwner = owners.length === 1;
      }
      if (soleOwner) {
        await deletePetWithStorage(db, c.env.PHOTOS, membership.petId);
      } else {
        // surviving shared pet: record the membership removal BEFORE the
        // user row (and its memberships) cascade away
        await writeAudit(db, {
          petId: membership.petId,
          userId: user.id,
          action: "delete",
          entity: "member",
          entityId: user.id,
          diff: { role: membership.role, reason: "account_deleted" },
        });
      }
    }
    await db.delete(users).where(eq(users.id, user.id)); // cascades sessions + memberships
    clearSessionCookie(c);
    return c.json({ data: { ok: true } });
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all tests, 4 new).

- [ ] **Step 5: Final wire-check — full suite and dev smoke**

Run: `npm run test && npm run typecheck`
Expected: app builds, ALL worker tests pass (~125 tests: ~20 from Plan 1 + ~105 from this plan, of which 24 are the per-category validation matrix), typecheck clean across all three workspaces.

Run (background): `npm run dev -w worker`, then:

```bash
curl -s -X POST http://localhost:8787/api/auth/dev-login -H "Content-Type: application/json" -d '{}' -c /tmp/pawlog.jar
CSRF=$(curl -s http://localhost:8787/api/me -b /tmp/pawlog.jar | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
curl -s -X POST http://localhost:8787/api/pets -b /tmp/pawlog.jar -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" -d '{"name":"Momo","species":"cat"}'
```

Expected: the last command returns `{"data":{"id":"...","name":"Momo",...,"role":"owner",...}}`. Stop the background worker afterward.

- [ ] **Step 6: Add an API section to `README.md`**

Append after the "Testing" section:

```markdown
## API

REST JSON under `/api`; responses are `{ data }` or `{ error: { code, message } }`.
Sessions via cookie; mutations require the `X-CSRF-Token` from `GET /api/me`.
Pet routes resolve roles through `pet_members` (viewer < editor < owner);
non-members get 404.

- Auth/account: `GET /api/auth/google`, `POST /api/auth/logout`,
  `GET|PATCH|DELETE /api/me`, `GET /api/me/export`
- Pets: `POST /api/pets`, `GET|PATCH|DELETE /api/pets/:petId`,
  `PUT /api/pets/:petId/targets`, `GET /api/pets/:petId/export?format=json|csv`,
  `POST|GET /api/pets/:petId/avatar`
- Activities: `GET|POST /api/pets/:petId/activities`,
  `GET|PATCH|DELETE /api/pets/:petId/activities/:id`,
  `GET /api/pets/:petId/summary?month=YYYY-MM`
- Photos: `POST /api/pets/:petId/activities/:id/photos`,
  `GET|DELETE /api/photos/:photoId`
- Presets: `GET|POST /api/pets/:petId/presets`,
  `PATCH|DELETE /api/pets/:petId/presets/:id`
```

- [ ] **Step 7: Commit**

```bash
git add worker/src/routes/me.ts worker/test/account-deletion.test.ts README.md
git commit -m "feat: add self-service account deletion with sole-owner pet cascade"
```

---

## Done criteria for Plan 2

- `npm run test` green (~125 tests) and `npm run typecheck` clean.
- Every spec §5 route in this plan's scope exists: pets CRUD + targets + export, activities CRUD + list + summary, photos upload/serve(+delete +avatar), presets CRUD, `/api/me/export`, `DELETE /api/me`. (Care schedules, care-status, and insights are Plan 4.)
- Every route group has authz-matrix coverage (401 / 403-insufficient-role / 404-non-member), validation rejects, a happy path, and audit-row assertions.
- The dev smoke flow works: dev-login → create pet → log activity → upload photo → export.

## Spec deviations encoded in this plan (intentional)

1. **Audit helper, not middleware** — `writeAudit()` is called explicitly by every mutating handler; a middleware cannot know entity IDs/diffs. Enforced by convention + tests.
2. **No orphan-photo cron** — the upload-after-create flow (photos require an existing activity) makes orphans impossible; R2 objects are deleted synchronously with their photo row / pet.
3. **Photo upload nested under the activity** (`POST /api/pets/:petId/activities/:id/photos` instead of spec §5's `POST /api/pets/:petId/photos`) — required by the NOT NULL `activity_photos.activity_id` in the frozen schema.
4. **`size=thumb|full` accepted but ignored** — resizing deferred to deployment with Cloudflare Images.
5. **EXIF/GPS stripped via segment/chunk removal, not re-encode** — Workers has no image codec; pixel data is untouched.
6. **Activity (and preset) `category` is immutable** — update payloads exclude it; details are re-validated against the stored category.
7. **`DELETE /api/photos/:photoId` and `GET|POST /api/pets/:petId/avatar` added** — not listed in spec §5 but required by §3 (activity detail photo management, pet avatars).
8. **Rate limiter is per-isolate in-memory** — spec's "rate-limit bindings" are a deploy-time swap; the middleware signature is designed so only `checkRateLimit` changes.

## Next plans

3. **Frontend Core** — tab shell, pet switcher + onboarding, add flow, Home dashboard, calendar modes, log view, activity detail, settings (uses frontend-design skill).
4. **Care & Analyzer** — schedules CRUD + complete + care-status, insights endpoint + anomaly rules, Health tab charts.
5. **PWA & Polish** — manifest + service worker caching, iOS install hint, data export/deletion UI, desktop sidebar layout.

