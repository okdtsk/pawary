# Pawary Plan 7: Pet Sharing Invites — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners create single-use, 7-day shareable invite links; invitees open `/join/<token>`, sign in, and join the pet; owners manage members (role changes, removal) and members can leave — all from a Members section in pet settings, fully audited and TDD'd.

**Architecture:** One new D1 table (`pet_invites`, hashed tokens) via a drizzle migration. One new worker route file (`members.ts`) carrying both the pet-scoped member/invite management endpoints (behind the existing `requirePetRole` middleware) and the global token endpoints (`/api/invites/:token` preview + atomic accept). Frontend: one hooks file (`api/members.ts`), a `MembersSection` in `PetEditor`, and a `/join/:token` route mounted OUTSIDE `Shell` (so zero-pet invitees skip Onboarding), with a localStorage handoff so the token survives the Google OAuth round-trip.

**Tech Stack:** No new dependencies. TypeScript, Hono 4, Drizzle ORM 0.44+, D1, Zod, Vitest + @cloudflare/vitest-pool-workers; React 19, TanStack Query 5, react-router 7, Tailwind CSS 4.

**Spec:** `docs/superpowers/specs/2026-06-12-pet-sharing-invites-design.md` (read all of it first — it is short).

**Conventions carried from Plans 1–6 (follow exactly):**
- IDs are ULIDs via `newId()`; timestamps are epoch ms (`Date.now()`).
- Responses: success `{ data }`, failure `{ error: { code, message } }` via `err()`.
- Zod schemas live in `shared/src/index.ts`, all `.strict()`; first issue message surfaced with code `validation`.
- Middleware order on mutating pet routes: `requireSession` → `requireCsrf` → `requirePetRole(...)`. Non-member/missing pet = 404 `not_found`; member with insufficient role = 403 `forbidden`.
- Every mutating pet-scoped handler calls `writeAudit()`; tests assert audit rows.
- `rateLimit(prefix, limit, windowMs, "user")` must run AFTER `requireSession`.
- Worker tasks are TDD: failing test → see it fail → implement → see it pass. Each worker task ends with `npm run test -w worker && npm run typecheck -w worker` green.
- Frontend tasks verify with `npm run typecheck -w app && npm run build -w app`. Every UI string extends the typed `Messages` interface AND both catalogs (`en.ts`, `ja.ts`) in the same task.
- Each task ends with a commit using the exact message given. Do NOT push or deploy; the user does that.

**Locked decisions (do not relitigate):**

| Decision | Choice |
|---|---|
| Invite delivery | Shareable link `https://<origin>/join/<token>`; origin taken from the request URL, never hardcoded |
| Token | `generateToken()` (32 random bytes, base64url) in the URL; only `sha256Hex(token)` stored |
| Lifecycle | Single-use, expires `createdAt + 7d`; unknown/expired/used/revoked are all the same 404 (no oracle) |
| Invitable roles | `editor` / `viewer` only; owner is granted via member promotion |
| Audit | `audit_log.entity` enum gains `"invite"` (type-level only — drizzle text enums emit no CHECK constraint, so NO migration for this); events: invite create/delete, member create/update/delete |
| Last-owner invariant | PATCH role and DELETE member return 409 `last_owner` if the action would leave 0 owners |
| Already-a-member accept | Claims (consumes) the invite, returns 200 with `alreadyMember: true`, role unchanged, no audit row |
| Pending invites in GET members | `invites` array for owners, `null` for editors/viewers |
| Inviter deletion | `created_by` FK cascade deletes their pending invites (accepted memberships are unaffected) — deliberate |
| Login round-trip | Token saved to localStorage before `Login` renders, replayed by a redirect component once the router mounts; OAuth flow itself is NOT touched |
| `/join/:token` placement | Route OUTSIDE `Shell` (sibling), so invitees with zero pets are not hijacked by Onboarding |

---

### Task 1: `pet_invites` schema + migration

**Files:**
- Modify: `worker/src/db/schema.ts`
- Create: `worker/drizzle/0002_add-pet-invites.sql` (generated, not hand-written)
- Test: `worker/test/invites.test.ts` (new)

- [ ] **Step 1: Write the failing schema smoke test**

Create `worker/test/invites.test.ts`:

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { petInvites } from "../src/db/schema";
import { newId } from "../src/lib/id";
import { seedPet, seedUserWithSession } from "./helpers";

it("pet_invites rows round-trip through the migration", async () => {
  const { userId } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const db = drizzle(env.DB);
  const now = Date.now();
  const id = newId();
  await db.insert(petInvites).values({
    id,
    petId,
    role: "editor",
    tokenHash: "a".repeat(64),
    createdBy: userId,
    createdAt: now,
    expiresAt: now + 1000,
  });
  const row = await db.select().from(petInvites).where(eq(petInvites.id, id)).get();
  expect(row).toMatchObject({ id, petId, role: "editor", usedAt: null, usedBy: null });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w worker -- invites`
Expected: FAIL — `petInvites` is not exported from `../src/db/schema`.

- [ ] **Step 3: Add the table to the schema**

In `worker/src/db/schema.ts`, after the `petMembers` table, add:

```ts
export const petInvites = sqliteTable(
  "pet_invites",
  {
    id: text("id").primaryKey(),
    petId: text("pet_id")
      .notNull()
      .references(() => pets.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["editor", "viewer"] }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    usedBy: text("used_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("idx_pet_invites_pet").on(t.petId)],
);
```

In the same file, extend the `auditLog.entity` enum to include `"invite"`:

```ts
    entity: text("entity", {
      enum: ["activity", "pet", "schedule", "preset", "member", "invite"],
    }).notNull(),
```

And at the bottom, with the other type exports:

```ts
export type PetInvite = typeof petInvites.$inferSelect;
```

Also widen the type in `worker/src/domain/audit.ts` to match:

```ts
  entity: "activity" | "pet" | "schedule" | "preset" | "member" | "invite";
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate -w worker -- --name=add-pet-invites`
Expected: creates `worker/drizzle/0002_add-pet-invites.sql` containing ONLY `CREATE TABLE pet_invites` plus its unique index on `token_hash` and `idx_pet_invites_pet`. The `auditLog` enum change must produce NO SQL (drizzle text enums are type-only). **If the generated file touches any other table, STOP and report — do not hand-edit existing migrations.**

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -w worker -- invites`
Expected: PASS (vitest auto-applies all `worker/drizzle/*.sql` via `test/apply-migrations.ts`).

- [ ] **Step 6: Typecheck + full worker suite**

Run: `npm run typecheck -w worker && npm run test -w worker`
Expected: clean, all suites green.

- [ ] **Step 7: Commit**

```bash
git add worker/src/db/schema.ts worker/src/domain/audit.ts worker/drizzle worker/test/invites.test.ts
git commit -m "feat: add pet_invites table and invite audit entity"
```

---

### Task 2: Shared schemas & response types

**Files:**
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Add inputs + responses**

In `shared/src/index.ts`, after the `ROLES` block (line ~22), add:

```ts
export const INVITE_ROLES = ["editor", "viewer"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];
```

Near the other pet schemas (after `petTargetsSchema`), add:

```ts
export const createInviteSchema = z
  .object({ role: z.enum(INVITE_ROLES) })
  .strict();
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const updateMemberRoleSchema = z
  .object({ role: z.enum(ROLES) })
  .strict();
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
```

With the other response types (near `PetResponse`), add:

```ts
export type PetMemberResponse = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: Role;
  createdAt: number;
  isMe: boolean;
};

export type PetInviteResponse = {
  id: string;
  role: InviteRole;
  expiresAt: number;
  createdByName: string;
};

/** `invites` is null for non-owners (pending invites are owner-only data). */
export type MembersResponse = {
  members: PetMemberResponse[];
  invites: PetInviteResponse[] | null;
};

export type CreateInviteResponse = {
  id: string;
  url: string;
  expiresAt: number;
};

export type InvitePreviewResponse = {
  petName: string;
  role: InviteRole;
  inviterName: string;
};

export type AcceptInviteResponse = {
  petId: string;
  role: Role;
  alreadyMember: boolean;
};
```

- [ ] **Step 2: Typecheck all workspaces**

Run: `npm run typecheck`
Expected: clean (shared, worker, app).

- [ ] **Step 3: Commit**

```bash
git add shared/src/index.ts
git commit -m "feat: add invite and member schemas to shared"
```

---

### Task 3: Worker — `GET /api/pets/:petId/members`

**Files:**
- Create: `worker/src/routes/members.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/members.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `worker/test/members.test.ts`:

```ts
import { SELF } from "cloudflare:test";
import type { MembersResponse } from "@pawary/shared";
import { expect, it } from "vitest";
import { authHeaders, seedPet, seedUserWithSession, withMember } from "./helpers";

it("GET members returns all members with isMe; invites only for owners", async () => {
  const owner = await seedUserWithSession({ email: "o@example.com", displayName: "Olive" });
  const editor = await seedUserWithSession({ email: "e@example.com", displayName: "Eddy" });
  const { petId } = await seedPet(owner.userId);
  await withMember(petId, editor.userId, "editor");

  const ownerRes = await SELF.fetch(`https://app.local/api/pets/${petId}/members`, {
    headers: { Cookie: owner.cookie },
  });
  expect(ownerRes.status).toBe(200);
  const ownerBody = (await ownerRes.json()) as { data: MembersResponse };
  expect(ownerBody.data.members).toHaveLength(2);
  expect(ownerBody.data.members[0]).toMatchObject({
    userId: owner.userId,
    displayName: "Olive",
    role: "owner",
    isMe: true,
  });
  expect(ownerBody.data.members[1]).toMatchObject({
    userId: editor.userId,
    role: "editor",
    isMe: false,
  });
  expect(ownerBody.data.invites).toEqual([]); // owner sees the (empty) list

  const editorRes = await SELF.fetch(`https://app.local/api/pets/${petId}/members`, {
    headers: { Cookie: editor.cookie },
  });
  const editorBody = (await editorRes.json()) as { data: MembersResponse };
  expect(editorBody.data.members).toHaveLength(2);
  expect(editorBody.data.invites).toBeNull(); // non-owner never sees invites
  expect(editorBody.data.members.find((m) => m.isMe)?.userId).toBe(editor.userId);
});

it("GET members is 404 for non-members", async () => {
  const owner = await seedUserWithSession();
  const stranger = await seedUserWithSession({ email: "s@example.com" });
  const { petId } = await seedPet(owner.userId);
  const res = await SELF.fetch(`https://app.local/api/pets/${petId}/members`, {
    headers: { Cookie: stranger.cookie },
  });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w worker -- members`
Expected: FAIL with 404s — the route does not exist yet.

- [ ] **Step 3: Create the route file and mount it**

Create `worker/src/routes/members.ts`:

```ts
import type {
  MembersResponse,
  PetInviteResponse,
  PetMemberResponse,
} from "@pawary/shared";
import { and, eq, gt, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { petInvites, petMembers, users } from "../db/schema";
import type { AppEnv } from "../env";
import { requirePetRole } from "../middleware/pet-access";
import { requireSession } from "../middleware/session";

export const memberRoutes = new Hono<AppEnv>();

memberRoutes.get(
  "/api/pets/:petId/members",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const petId = c.get("petId");
    const me = c.get("user");
    const rows = await db
      .select({
        userId: petMembers.userId,
        role: petMembers.role,
        createdAt: petMembers.createdAt,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(petMembers)
      .innerJoin(users, eq(petMembers.userId, users.id))
      .where(eq(petMembers.petId, petId))
      .all();
    const members: PetMemberResponse[] = rows
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => ({ ...r, isMe: r.userId === me.id }));

    let invites: PetInviteResponse[] | null = null;
    if (c.get("petRole") === "owner") {
      invites = await db
        .select({
          id: petInvites.id,
          role: petInvites.role,
          expiresAt: petInvites.expiresAt,
          createdByName: users.displayName,
        })
        .from(petInvites)
        .innerJoin(users, eq(petInvites.createdBy, users.id))
        .where(
          and(
            eq(petInvites.petId, petId),
            isNull(petInvites.usedAt),
            gt(petInvites.expiresAt, Date.now()),
          ),
        )
        .all();
    }
    return c.json({ data: { members, invites } satisfies MembersResponse });
  },
);
```

Note the `DrizzleD1Database` type import is added in Task 5 (with `countOwners`); this task does not need it.

In `worker/src/index.ts`, import and mount alongside the other pet-scoped routers:

```ts
import { memberRoutes } from "./routes/members";
```

and after the existing `app.route("/", ...)` lines:

```ts
app.route("/", memberRoutes);
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w worker -- members`
Expected: PASS (both tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck -w worker`

```bash
git add worker/src/routes/members.ts worker/src/index.ts worker/test/members.test.ts
git commit -m "feat: list pet members with owner-only pending invites"
```

---

### Task 4: Worker — create + revoke invites

**Files:**
- Modify: `worker/src/routes/members.ts`
- Test: `worker/test/invites.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/invites.test.ts` (extend the existing imports — final import block):

```ts
import { env, SELF } from "cloudflare:test";
import type { CreateInviteResponse, MembersResponse } from "@pawary/shared";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { auditLog, petInvites } from "../src/db/schema";
import { sha256Hex } from "../src/lib/crypto";
import { newId } from "../src/lib/id";
import { authHeaders, seedPet, seedUserWithSession, withMember } from "./helpers";
```

New tests:

```ts
async function createInvite(
  petId: string,
  auth: { cookie: string; csrfToken: string },
  role: string = "editor",
) {
  return SELF.fetch(`https://app.local/api/pets/${petId}/invites`, {
    method: "POST",
    headers: authHeaders(auth.cookie, auth.csrfToken),
    body: JSON.stringify({ role }),
  });
}

it("POST invites creates a hashed single-use invite and returns the URL once", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const res = await createInvite(petId, owner, "viewer");
  expect(res.status).toBe(201);
  const { data } = (await res.json()) as { data: CreateInviteResponse };
  const token = data.url.split("/join/")[1]!;
  expect(token.length).toBeGreaterThanOrEqual(40);
  expect(new URL(data.url).pathname).toBe(`/join/${token}`);

  const db = drizzle(env.DB);
  const row = await db
    .select()
    .from(petInvites)
    .where(eq(petInvites.id, data.id))
    .get();
  expect(row).toMatchObject({ petId, role: "viewer", usedAt: null });
  expect(row!.tokenHash).toBe(await sha256Hex(token)); // raw token never stored
  expect(row!.expiresAt - row!.createdAt).toBe(7 * 24 * 60 * 60 * 1000);

  const audits = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.petId, petId), eq(auditLog.entity, "invite")))
    .all();
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ action: "create", entityId: data.id });
});

it("POST invites rejects owner role and non-owner callers", async () => {
  const owner = await seedUserWithSession();
  const editor = await seedUserWithSession({ email: "e@example.com" });
  const { petId } = await seedPet(owner.userId);
  await withMember(petId, editor.userId, "editor");

  const badRole = await createInvite(petId, owner, "owner");
  expect(badRole.status).toBe(400);

  const forbidden = await createInvite(petId, editor);
  expect(forbidden.status).toBe(403);
});

it("DELETE invites revokes a pending invite; revoked invites vanish from GET members", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const created = (await (await createInvite(petId, owner)).json()) as {
    data: CreateInviteResponse;
  };

  const del = await SELF.fetch(
    `https://app.local/api/pets/${petId}/invites/${created.data.id}`,
    { method: "DELETE", headers: authHeaders(owner.cookie, owner.csrfToken) },
  );
  expect(del.status).toBe(200);

  const members = await SELF.fetch(`https://app.local/api/pets/${petId}/members`, {
    headers: { Cookie: owner.cookie },
  });
  const body = (await members.json()) as { data: MembersResponse };
  expect(body.data.invites).toEqual([]);

  const again = await SELF.fetch(
    `https://app.local/api/pets/${petId}/invites/${created.data.id}`,
    { method: "DELETE", headers: authHeaders(owner.cookie, owner.csrfToken) },
  );
  expect(again.status).toBe(404); // idempotent-ish: second revoke is not found
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w worker -- invites`
Expected: the new tests FAIL with 404 (routes missing); the Task 1 smoke test still passes.

- [ ] **Step 3: Implement create + revoke**

Append to `worker/src/routes/members.ts` (add these imports to the top of the file: `createInviteSchema` from `@pawary/shared`; `writeAudit` from `../domain/audit`; `generateToken`, `sha256Hex` from `../lib/crypto`; `newId` from `../lib/id`; `rateLimit` from `../lib/rate-limit`; `err` from `../lib/respond`; `requireCsrf` from `../middleware/csrf`), plus this constant after the `memberRoutes` declaration:

```ts
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
```

```ts
memberRoutes.post(
  "/api/pets/:petId/invites",
  requireSession,
  requireCsrf,
  requirePetRole("owner"),
  rateLimit("invite-create", 20, 3_600_000, "user"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createInviteSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const db = drizzle(c.env.DB);
    const petId = c.get("petId");
    const user = c.get("user");
    const token = generateToken();
    const now = Date.now();
    const id = newId();
    await db.insert(petInvites).values({
      id,
      petId,
      role: parsed.data.role,
      tokenHash: await sha256Hex(token),
      createdBy: user.id,
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
    });
    await writeAudit(db, {
      petId,
      userId: user.id,
      action: "create",
      entity: "invite",
      entityId: id,
      diff: { role: parsed.data.role },
    });
    const url = `${new URL(c.req.url).origin}/join/${token}`;
    return c.json(
      { data: { id, url, expiresAt: now + INVITE_TTL_MS } satisfies CreateInviteResponse },
      201,
    );
  },
);

memberRoutes.delete(
  "/api/pets/:petId/invites/:inviteId",
  requireSession,
  requireCsrf,
  requirePetRole("owner"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const petId = c.get("petId");
    const inviteId = c.req.param("inviteId");
    const result = await db
      .delete(petInvites)
      .where(
        and(
          eq(petInvites.id, inviteId),
          eq(petInvites.petId, petId),
          isNull(petInvites.usedAt),
        ),
      )
      .run();
    if (result.meta.changes === 0) return err(c, 404, "not_found", "Not found");
    await writeAudit(db, {
      petId,
      userId: c.get("user").id,
      action: "delete",
      entity: "invite",
      entityId: inviteId,
    });
    return c.json({ data: { ok: true } });
  },
);
```

Add the `CreateInviteResponse` type import to the existing `@pawary/shared` type import.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w worker -- invites && npm run test -w worker -- members`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck -w worker`

```bash
git add worker/src/routes/members.ts worker/test/invites.test.ts
git commit -m "feat: create and revoke single-use pet invites"
```

---

### Task 5: Worker — role change, remove member, leave

**Files:**
- Modify: `worker/src/routes/members.ts`
- Test: `worker/test/members.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/members.test.ts` (extend imports with `env` from `cloudflare:test`, `and`/`eq` from `drizzle-orm`, `drizzle` from `drizzle-orm/d1`, and `auditLog`, `petMembers` from `../src/db/schema`):

```ts
function memberUrl(petId: string, userId: string) {
  return `https://app.local/api/pets/${petId}/members/${userId}`;
}

it("PATCH member role promotes/demotes with audit; guards the last owner", async () => {
  const owner = await seedUserWithSession();
  const editor = await seedUserWithSession({ email: "e@example.com" });
  const { petId } = await seedPet(owner.userId);
  await withMember(petId, editor.userId, "editor");

  const promote = await SELF.fetch(memberUrl(petId, editor.userId), {
    method: "PATCH",
    headers: authHeaders(owner.cookie, owner.csrfToken),
    body: JSON.stringify({ role: "owner" }),
  });
  expect(promote.status).toBe(200);

  // two owners now — demoting the original owner is allowed
  const demote = await SELF.fetch(memberUrl(petId, owner.userId), {
    method: "PATCH",
    headers: authHeaders(editor.cookie, editor.csrfToken),
    body: JSON.stringify({ role: "viewer" }),
  });
  expect(demote.status).toBe(200);

  // editor (now sole owner) cannot demote themself
  const lastOwner = await SELF.fetch(memberUrl(petId, editor.userId), {
    method: "PATCH",
    headers: authHeaders(editor.cookie, editor.csrfToken),
    body: JSON.stringify({ role: "editor" }),
  });
  expect(lastOwner.status).toBe(409);
  expect(((await lastOwner.json()) as { error: { code: string } }).error.code).toBe("last_owner");

  const db = drizzle(env.DB);
  const audits = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.petId, petId), eq(auditLog.entity, "member")))
    .all();
  expect(audits.filter((a) => a.action === "update")).toHaveLength(2);
});

it("PATCH member role is owner-only and 404s on non-members", async () => {
  const owner = await seedUserWithSession();
  const editor = await seedUserWithSession({ email: "e@example.com" });
  const stranger = await seedUserWithSession({ email: "s@example.com" });
  const { petId } = await seedPet(owner.userId);
  await withMember(petId, editor.userId, "editor");

  const forbidden = await SELF.fetch(memberUrl(petId, owner.userId), {
    method: "PATCH",
    headers: authHeaders(editor.cookie, editor.csrfToken),
    body: JSON.stringify({ role: "viewer" }),
  });
  expect(forbidden.status).toBe(403);

  const notMember = await SELF.fetch(memberUrl(petId, stranger.userId), {
    method: "PATCH",
    headers: authHeaders(owner.cookie, owner.csrfToken),
    body: JSON.stringify({ role: "viewer" }),
  });
  expect(notMember.status).toBe(404);
});

it("DELETE member: owner removes others; anyone can leave; last owner cannot", async () => {
  const owner = await seedUserWithSession();
  const editor = await seedUserWithSession({ email: "e@example.com" });
  const viewer = await seedUserWithSession({ email: "v@example.com" });
  const { petId } = await seedPet(owner.userId);
  await withMember(petId, editor.userId, "editor");
  await withMember(petId, viewer.userId, "viewer");

  // editor cannot remove someone else
  const forbidden = await SELF.fetch(memberUrl(petId, viewer.userId), {
    method: "DELETE",
    headers: authHeaders(editor.cookie, editor.csrfToken),
  });
  expect(forbidden.status).toBe(403);

  // viewer leaves themself
  const leave = await SELF.fetch(memberUrl(petId, viewer.userId), {
    method: "DELETE",
    headers: authHeaders(viewer.cookie, viewer.csrfToken),
  });
  expect(leave.status).toBe(200);

  // owner removes the editor
  const remove = await SELF.fetch(memberUrl(petId, editor.userId), {
    method: "DELETE",
    headers: authHeaders(owner.cookie, owner.csrfToken),
  });
  expect(remove.status).toBe(200);

  // sole owner cannot leave
  const lastOwner = await SELF.fetch(memberUrl(petId, owner.userId), {
    method: "DELETE",
    headers: authHeaders(owner.cookie, owner.csrfToken),
  });
  expect(lastOwner.status).toBe(409);

  const db = drizzle(env.DB);
  const remaining = await db
    .select()
    .from(petMembers)
    .where(eq(petMembers.petId, petId))
    .all();
  expect(remaining).toHaveLength(1);
  expect(remaining[0]!.userId).toBe(owner.userId);

  // removed member can no longer see the pet (anti-probing 404)
  const gone = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    headers: { Cookie: editor.cookie },
  });
  expect(gone.status).toBe(404);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w worker -- members`
Expected: new tests FAIL with 404 (no PATCH/DELETE routes).

- [ ] **Step 3: Implement role change + remove/leave**

Append to `worker/src/routes/members.ts` (add `updateMemberRoleSchema` to the `@pawary/shared` value import, and change the drizzle import to `import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";`). First the owner-count helper, placed right after `INVITE_TTL_MS`:

```ts
async function countOwners(
  db: DrizzleD1Database,
  petId: string,
): Promise<number> {
  const rows = await db
    .select({ userId: petMembers.userId })
    .from(petMembers)
    .where(and(eq(petMembers.petId, petId), eq(petMembers.role, "owner")))
    .all();
  return rows.length;
}
```

Then the routes:

```ts
memberRoutes.patch(
  "/api/pets/:petId/members/:userId",
  requireSession,
  requireCsrf,
  requirePetRole("owner"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateMemberRoleSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const db = drizzle(c.env.DB);
    const petId = c.get("petId");
    const targetId = c.req.param("userId");
    const target = await db
      .select()
      .from(petMembers)
      .where(and(eq(petMembers.petId, petId), eq(petMembers.userId, targetId)))
      .get();
    if (!target) return err(c, 404, "not_found", "Not found");
    if (target.role === parsed.data.role) return c.json({ data: { ok: true } });
    if (
      target.role === "owner" &&
      (await countOwners(db, petId)) === 1
    ) {
      return err(c, 409, "last_owner", "A pet must keep at least one owner");
    }
    await db
      .update(petMembers)
      .set({ role: parsed.data.role })
      .where(and(eq(petMembers.petId, petId), eq(petMembers.userId, targetId)));
    await writeAudit(db, {
      petId,
      userId: c.get("user").id,
      action: "update",
      entity: "member",
      entityId: targetId,
      diff: { before: target.role, after: parsed.data.role },
    });
    return c.json({ data: { ok: true } });
  },
);

memberRoutes.delete(
  "/api/pets/:petId/members/:userId",
  requireSession,
  requireCsrf,
  requirePetRole("viewer"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const petId = c.get("petId");
    const me = c.get("user");
    const targetId = c.req.param("userId");
    const isSelf = targetId === me.id;
    // owners remove anyone; everyone may remove themself (= leave)
    if (!isSelf && c.get("petRole") !== "owner") {
      return err(c, 403, "forbidden", "Insufficient role");
    }
    const target = await db
      .select()
      .from(petMembers)
      .where(and(eq(petMembers.petId, petId), eq(petMembers.userId, targetId)))
      .get();
    if (!target) return err(c, 404, "not_found", "Not found");
    if (target.role === "owner" && (await countOwners(db, petId)) === 1) {
      return err(c, 409, "last_owner", "A pet must keep at least one owner");
    }
    await db
      .delete(petMembers)
      .where(and(eq(petMembers.petId, petId), eq(petMembers.userId, targetId)));
    await writeAudit(db, {
      petId,
      userId: me.id,
      action: "delete",
      entity: "member",
      entityId: targetId,
      diff: { role: target.role, reason: isSelf ? "left" : "removed" },
    });
    return c.json({ data: { ok: true } });
  },
);
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w worker -- members`
Expected: PASS.

- [ ] **Step 5: Typecheck + full worker suite + commit**

Run: `npm run typecheck -w worker && npm run test -w worker`

```bash
git add worker/src/routes/members.ts worker/test/members.test.ts
git commit -m "feat: member role changes, removal, and leave with last-owner guard"
```

---

### Task 6: Worker — invite preview + atomic accept

**Files:**
- Modify: `worker/src/routes/members.ts`
- Test: `worker/test/invites.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/invites.test.ts`:

```ts
async function createdInviteUrl(
  petId: string,
  auth: { cookie: string; csrfToken: string },
  role: string = "editor",
): Promise<string> {
  const res = await createInvite(petId, auth, role);
  const { data } = (await res.json()) as { data: CreateInviteResponse };
  return data.url;
}

function tokenOf(url: string): string {
  return url.split("/join/")[1]!;
}

it("GET invite preview returns pet/inviter/role for a valid token, 404 otherwise", async () => {
  const owner = await seedUserWithSession({ displayName: "Olive" });
  const invitee = await seedUserWithSession({ email: "i@example.com" });
  const { petId } = await seedPet(owner.userId, "owner", { name: "Momo" });
  const url = await createdInviteUrl(petId, owner, "viewer");

  const res = await SELF.fetch(
    `https://app.local/api/invites/${tokenOf(url)}`,
    { headers: { Cookie: invitee.cookie } },
  );
  expect(res.status).toBe(200);
  expect(((await res.json()) as { data: unknown }).data).toEqual({
    petName: "Momo",
    role: "viewer",
    inviterName: "Olive",
  });

  const bogus = await SELF.fetch(`https://app.local/api/invites/${"x".repeat(43)}`, {
    headers: { Cookie: invitee.cookie },
  });
  expect(bogus.status).toBe(404);

  const anon = await SELF.fetch(`https://app.local/api/invites/${tokenOf(url)}`);
  expect(anon.status).toBe(401);
});

it("POST accept joins the pet, consumes the token, and audits", async () => {
  const owner = await seedUserWithSession();
  const invitee = await seedUserWithSession({ email: "i@example.com" });
  const { petId } = await seedPet(owner.userId);
  const url = await createdInviteUrl(petId, owner, "editor");
  const token = tokenOf(url);

  const res = await SELF.fetch(`https://app.local/api/invites/${token}/accept`, {
    method: "POST",
    headers: authHeaders(invitee.cookie, invitee.csrfToken),
  });
  expect(res.status).toBe(201);
  expect(((await res.json()) as { data: unknown }).data).toEqual({
    petId,
    role: "editor",
    alreadyMember: false,
  });

  // membership live: invitee can read the pet
  const pet = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    headers: { Cookie: invitee.cookie },
  });
  expect(pet.status).toBe(200);

  // replay is consumed
  const replay = await SELF.fetch(`https://app.local/api/invites/${token}/accept`, {
    method: "POST",
    headers: authHeaders(invitee.cookie, invitee.csrfToken),
  });
  expect(replay.status).toBe(404);

  const db = drizzle(env.DB);
  const memberAudits = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.petId, petId), eq(auditLog.entity, "member")))
    .all();
  expect(memberAudits).toHaveLength(1);
  expect(memberAudits[0]).toMatchObject({
    action: "create",
    entityId: invitee.userId,
    userId: invitee.userId,
  });
});

it("POST accept on an expired invite is 404", async () => {
  const owner = await seedUserWithSession();
  const invitee = await seedUserWithSession({ email: "i@example.com" });
  const { petId } = await seedPet(owner.userId);
  const url = await createdInviteUrl(petId, owner);
  const token = tokenOf(url);

  const db = drizzle(env.DB);
  await db
    .update(petInvites)
    .set({ expiresAt: Date.now() - 1000 })
    .where(eq(petInvites.tokenHash, await sha256Hex(token)));

  const res = await SELF.fetch(`https://app.local/api/invites/${token}/accept`, {
    method: "POST",
    headers: authHeaders(invitee.cookie, invitee.csrfToken),
  });
  expect(res.status).toBe(404);
});

it("POST accept by an existing member consumes the invite without changing the role", async () => {
  const owner = await seedUserWithSession();
  const editor = await seedUserWithSession({ email: "e@example.com" });
  const { petId } = await seedPet(owner.userId);
  await withMember(petId, editor.userId, "editor");
  const url = await createdInviteUrl(petId, owner, "viewer");

  const res = await SELF.fetch(`https://app.local/api/invites/${tokenOf(url)}/accept`, {
    method: "POST",
    headers: authHeaders(editor.cookie, editor.csrfToken),
  });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { data: unknown }).data).toEqual({
    petId,
    role: "editor", // their existing role, NOT the invite's viewer
    alreadyMember: true,
  });
});

it("two concurrent accepts: exactly one wins", async () => {
  const owner = await seedUserWithSession();
  const a = await seedUserWithSession({ email: "a@example.com" });
  const b = await seedUserWithSession({ email: "b@example.com" });
  const { petId } = await seedPet(owner.userId);
  const token = tokenOf(await createdInviteUrl(petId, owner));

  const [resA, resB] = await Promise.all([
    SELF.fetch(`https://app.local/api/invites/${token}/accept`, {
      method: "POST",
      headers: authHeaders(a.cookie, a.csrfToken),
    }),
    SELF.fetch(`https://app.local/api/invites/${token}/accept`, {
      method: "POST",
      headers: authHeaders(b.cookie, b.csrfToken),
    }),
  ]);
  const statuses = [resA.status, resB.status].sort();
  expect(statuses).toEqual([201, 404]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w worker -- invites`
Expected: new tests FAIL with 404.

- [ ] **Step 3: Implement preview + accept**

Append to `worker/src/routes/members.ts` (add `pets` to the schema import; add `AcceptInviteResponse`, `InvitePreviewResponse` to the type import):

```ts
memberRoutes.get(
  "/api/invites/:token",
  requireSession,
  rateLimit("invite-preview", 30, 60_000, "user"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const tokenHash = await sha256Hex(c.req.param("token"));
    const row = await db
      .select({
        petName: pets.name,
        role: petInvites.role,
        inviterName: users.displayName,
      })
      .from(petInvites)
      .innerJoin(pets, eq(petInvites.petId, pets.id))
      .innerJoin(users, eq(petInvites.createdBy, users.id))
      .where(
        and(
          eq(petInvites.tokenHash, tokenHash),
          isNull(petInvites.usedAt),
          gt(petInvites.expiresAt, Date.now()),
        ),
      )
      .get();
    if (!row) return err(c, 404, "not_found", "Not found");
    return c.json({ data: row satisfies InvitePreviewResponse });
  },
);

memberRoutes.post(
  "/api/invites/:token/accept",
  requireSession,
  requireCsrf,
  rateLimit("invite-accept", 10, 60_000, "user"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const user = c.get("user");
    const now = Date.now();
    const tokenHash = await sha256Hex(c.req.param("token"));
    const invite = await db
      .select()
      .from(petInvites)
      .where(
        and(
          eq(petInvites.tokenHash, tokenHash),
          isNull(petInvites.usedAt),
          gt(petInvites.expiresAt, now),
        ),
      )
      .get();
    if (!invite) return err(c, 404, "not_found", "Not found");
    // atomic claim: the WHERE re-checks unused+unexpired, so of N racing
    // accepts exactly one UPDATE reports a changed row
    const claim = await db
      .update(petInvites)
      .set({ usedAt: now, usedBy: user.id })
      .where(
        and(
          eq(petInvites.id, invite.id),
          isNull(petInvites.usedAt),
          gt(petInvites.expiresAt, now),
        ),
      )
      .run();
    if (claim.meta.changes === 0) return err(c, 404, "not_found", "Not found");

    const existing = await db
      .select()
      .from(petMembers)
      .where(
        and(eq(petMembers.petId, invite.petId), eq(petMembers.userId, user.id)),
      )
      .get();
    if (existing) {
      return c.json({
        data: {
          petId: invite.petId,
          role: existing.role,
          alreadyMember: true,
        } satisfies AcceptInviteResponse,
      });
    }
    await db.insert(petMembers).values({
      petId: invite.petId,
      userId: user.id,
      role: invite.role,
      createdAt: now,
    });
    await writeAudit(db, {
      petId: invite.petId,
      userId: user.id,
      action: "create",
      entity: "member",
      entityId: user.id,
      diff: { role: invite.role, inviteId: invite.id },
    });
    return c.json(
      {
        data: {
          petId: invite.petId,
          role: invite.role,
          alreadyMember: false,
        } satisfies AcceptInviteResponse,
      },
      201,
    );
  },
);
```

Note: these two routes are NOT pet-scoped (`requirePetRole` would 404 the not-yet-member), which is exactly why the token is the capability.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w worker -- invites`
Expected: PASS, including the race test.

- [ ] **Step 5: Typecheck + full worker suite + commit**

Run: `npm run typecheck -w worker && npm run test -w worker`

```bash
git add worker/src/routes/members.ts worker/test/invites.test.ts
git commit -m "feat: invite preview and atomic single-use accept endpoints"
```

---

### Task 7: App — query keys, hooks, i18n strings

**Files:**
- Modify: `app/src/api/keys.ts`
- Create: `app/src/api/members.ts`
- Modify: `app/src/i18n/messages.ts`, `app/src/i18n/en.ts`, `app/src/i18n/ja.ts`

- [ ] **Step 1: Add query keys**

In `app/src/api/keys.ts`, add to the `keys` object:

```ts
  members: (petId: string) => ["members", petId] as const,
  invitePreview: (token: string) => ["invite-preview", token] as const,
```

And extend the invalidation-rules comment block with:

```
 *   member/invite mutations          → ["members", petId] (+ ["me"] on leave)
 *   invite accept                    → ["me"]
```

- [ ] **Step 2: Create the hooks**

Create `app/src/api/members.ts`:

```ts
import type {
  AcceptInviteResponse,
  CreateInviteInput,
  CreateInviteResponse,
  InvitePreviewResponse,
  MembersResponse,
  Role,
} from "@pawary/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { keys } from "./keys";

export function useMembers(petId: string) {
  return useQuery({
    queryKey: keys.members(petId),
    queryFn: () => api<MembersResponse>(`/api/pets/${petId}/members`),
  });
}

export function useCreateInvite(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInviteInput) =>
      api<CreateInviteResponse>(`/api/pets/${petId}/invites`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(petId) }),
  });
}

export function useRevokeInvite(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) =>
      api<{ ok: true }>(`/api/pets/${petId}/invites/${inviteId}`, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(petId) }),
  });
}

export function useUpdateMemberRole(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      api<{ ok: true }>(`/api/pets/${petId}/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    onSuccess: async () => {
      // own role may have changed (self-demotion) — refresh me too
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.members(petId) }),
        qc.invalidateQueries({ queryKey: keys.me }),
      ]);
    },
  });
}

export function useRemoveMember(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api<{ ok: true }>(`/api/pets/${petId}/members/${userId}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.members(petId) }),
        qc.invalidateQueries({ queryKey: keys.me }),
      ]);
    },
  });
}

export function useInvitePreview(token: string) {
  return useQuery({
    queryKey: keys.invitePreview(token),
    queryFn: () => api<InvitePreviewResponse>(`/api/invites/${token}`),
    retry: false, // a 404 is a final answer, not a flake
  });
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api<AcceptInviteResponse>(`/api/invites/${token}/accept`, {
        method: "POST",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
}
```

- [ ] **Step 3: Add i18n strings**

In `app/src/i18n/messages.ts`, add a new top-level section to the `Messages` type (after `pets`):

```ts
  members: {
    title: string;
    you: string;
    pendingTitle: string;
    expires: (date: string) => string;
    revoke: string;
    remove: string;
    removeConfirm: string;
    leave: string;
    leaveConfirm: string;
    lastOwner: string;
    inviteCreate: string;
    inviteRole: string;
    linkCopied: string;
    shareText: (pet: string) => string;
    joinTitle: string;
    joinPrompt: (pet: string, inviter: string) => string;
    joinAs: (role: string) => string;
    accept: string;
    decline: string;
    joined: string;
    alreadyMember: string;
    invalidTitle: string;
    invalidBody: string;
    goHome: string;
  };
```

In `app/src/i18n/en.ts` (after the `pets` section):

```ts
  members: {
    title: "Care team",
    you: "(you)",
    pendingTitle: "Pending invites",
    expires: (date) => `Expires ${date}`,
    revoke: "Revoke",
    remove: "Remove",
    removeConfirm: "Really remove?",
    leave: "Leave this pet",
    leaveConfirm: "Really leave?",
    lastOwner: "A pet needs at least one owner — promote someone else first.",
    inviteCreate: "Create invite link",
    inviteRole: "Invite as",
    linkCopied: "Invite link copied!",
    shareText: (pet) => `Join ${pet}'s care team on Pawary`,
    joinTitle: "You're invited!",
    joinPrompt: (pet, inviter) => `${inviter} invited you to help care for ${pet}.`,
    joinAs: (role) => `You'll join as ${role}.`,
    accept: "Join",
    decline: "Not now",
    joined: "Welcome to the care team!",
    alreadyMember: "You're already a member of this pet.",
    invalidTitle: "Invite not available",
    invalidBody: "This invite link is invalid, expired, or already used. Ask for a new one.",
    goHome: "Go home",
  },
```

In `app/src/i18n/ja.ts` (same position):

```ts
  members: {
    title: "お世話メンバー",
    you: "（自分）",
    pendingTitle: "招待中",
    expires: (date) => `有効期限: ${date}`,
    revoke: "取り消す",
    remove: "削除",
    removeConfirm: "本当に削除？",
    leave: "このペットから抜ける",
    leaveConfirm: "本当に抜ける？",
    lastOwner: "オーナーが最低1人必要です。先に他のメンバーをオーナーにしてください。",
    inviteCreate: "招待リンクを作成",
    inviteRole: "権限",
    linkCopied: "招待リンクをコピーしました！",
    shareText: (pet) => `Pawaryで${pet}のお世話に参加しませんか`,
    joinTitle: "招待が届いています！",
    joinPrompt: (pet, inviter) => `${inviter}さんから「${pet}」のお世話への招待です。`,
    joinAs: (role) => `${role}として参加します。`,
    accept: "参加する",
    decline: "あとで",
    joined: "お世話メンバーになりました！",
    alreadyMember: "すでにこのペットのメンバーです。",
    invalidTitle: "招待が見つかりません",
    invalidBody: "このリンクは無効か、期限切れ・使用済みです。新しい招待をもらってください。",
    goHome: "ホームへ",
  },
```

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck -w app && npm run build -w app`
Expected: clean. (The build catches a missing catalog key via the `Messages` type.)

```bash
git add app/src/api/keys.ts app/src/api/members.ts app/src/i18n
git commit -m "feat: member/invite API hooks and i18n strings"
```

---

### Task 8: App — MembersSection in PetEditor

**Files:**
- Create: `app/src/features/pets/MembersSection.tsx`
- Modify: `app/src/routes/settings/PetEditor.tsx`

- [ ] **Step 1: Create the component**

Create `app/src/features/pets/MembersSection.tsx`:

```tsx
import type { InviteRole, PetResponse, Role } from "@pawary/shared";
import { useState } from "react";
import { useNavigate } from "react-router";
import { ROLES } from "@pawary/shared";
import { ApiError } from "../../api/client";
import {
  useCreateInvite,
  useMembers,
  useRemoveMember,
  useRevokeInvite,
  useUpdateMemberRole,
} from "../../api/members";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Select } from "../../components/form";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/Toast";
import { useLocaleTag, useT } from "../../i18n";

function mutationErrorMessage(
  error: unknown,
  t: ReturnType<typeof useT>,
): string {
  if (error instanceof ApiError && error.code === "last_owner") {
    return t.members.lastOwner;
  }
  return error instanceof ApiError ? error.message : t.errors.title;
}

export function MembersSection({ pet }: { pet: PetResponse }) {
  const t = useT();
  const locale = useLocaleTag();
  const toast = useToast();
  const navigate = useNavigate();
  const members = useMembers(pet.id);
  const createInvite = useCreateInvite(pet.id);
  const revokeInvite = useRevokeInvite(pet.id);
  const updateRole = useUpdateMemberRole(pet.id);
  const removeMember = useRemoveMember(pet.id);
  const [inviteRole, setInviteRole] = useState<InviteRole>("editor");
  // two-tap confirm state: userId armed for removal/leave
  const [armed, setArmed] = useState<string | null>(null);

  const isOwner = pet.role === "owner";
  const dateFmt = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });

  if (members.isLoading) {
    return (
      <Card className="flex justify-center p-5">
        <Spinner />
      </Card>
    );
  }
  if (!members.data) return null;

  const ownerCount = members.data.members.filter(
    (m) => m.role === "owner",
  ).length;
  const me = members.data.members.find((m) => m.isMe);
  const canLeave = !(me?.role === "owner" && ownerCount === 1);

  const onError = (error: unknown) =>
    toast.show(mutationErrorMessage(error, t), { tone: "danger" });

  const share = async (url: string) => {
    if (navigator.share) {
      try {
        await navigator.share({ text: t.members.shareText(pet.name), url });
        return;
      } catch {
        // user dismissed the sheet — fall through to clipboard
      }
    }
    await navigator.clipboard.writeText(url);
    toast.show(t.members.linkCopied);
  };

  return (
    <Card className="p-5">
      <h2 className="mb-3 font-display text-lg text-ink">{t.members.title}</h2>

      <ul className="flex flex-col gap-2.5">
        {members.data.members.map((member) => (
          <li key={member.userId} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-ink">
              {member.displayName}
              {member.isMe && (
                <span className="ml-1 text-xs text-ink-faint">
                  {t.members.you}
                </span>
              )}
            </span>
            {isOwner ? (
              // wrapper fixes the width — cn() does not de-duplicate
              // Tailwind classes, so overriding Select's w-full is unreliable
              <div className="w-28 shrink-0">
                <Select
                  value={member.role}
                  disabled={updateRole.isPending}
                  className="py-1.5 text-sm"
                  onChange={(e) =>
                    updateRole.mutate(
                      { userId: member.userId, role: e.target.value as Role },
                      { onError },
                    )
                  }
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {t.pets.role[role]}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <span className="rounded-full bg-cream-200 px-2.5 py-0.5 text-xs font-semibold text-ink-soft">
                {t.pets.role[member.role]}
              </span>
            )}
            {isOwner && !member.isMe && (
              <Button
                variant="danger"
                size="sm"
                disabled={removeMember.isPending}
                onClick={() => {
                  if (armed !== member.userId) {
                    setArmed(member.userId);
                    return;
                  }
                  setArmed(null);
                  removeMember.mutate(member.userId, { onError });
                }}
              >
                {armed === member.userId
                  ? t.members.removeConfirm
                  : t.members.remove}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <div className="mt-4 border-t border-cream-200 pt-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <span className="mb-1.5 block text-sm font-semibold text-ink-soft">
                {t.members.inviteRole}
              </span>
              <Select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as InviteRole)}
              >
                <option value="editor">{t.pets.role.editor}</option>
                <option value="viewer">{t.pets.role.viewer}</option>
              </Select>
            </div>
            <Button
              variant="soft"
              disabled={createInvite.isPending}
              onClick={() =>
                createInvite.mutate(
                  { role: inviteRole },
                  { onSuccess: (data) => void share(data.url), onError },
                )
              }
            >
              {createInvite.isPending ? <Spinner className="h-4 w-4" /> : null}
              {t.members.inviteCreate}
            </Button>
          </div>

          {members.data.invites && members.data.invites.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-ink-soft">
                {t.members.pendingTitle}
              </h3>
              <ul className="flex flex-col gap-2">
                {members.data.invites.map((invite) => (
                  <li key={invite.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 text-ink-soft">
                      {t.pets.role[invite.role]} ·{" "}
                      {t.members.expires(dateFmt.format(new Date(invite.expiresAt)))}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={revokeInvite.isPending}
                      onClick={() => revokeInvite.mutate(invite.id, { onError })}
                    >
                      {t.members.revoke}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {me && canLeave && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-4 self-start text-berry-600"
          disabled={removeMember.isPending}
          onClick={() => {
            if (armed !== me.userId) {
              setArmed(me.userId);
              return;
            }
            setArmed(null);
            removeMember.mutate(me.userId, {
              onSuccess: () => navigate("/settings/pets"),
              onError,
            });
          }}
        >
          {armed === me.userId ? t.members.leaveConfirm : t.members.leave}
        </Button>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Mount it in PetEditor**

In `app/src/routes/settings/PetEditor.tsx`, import it:

```tsx
import { MembersSection } from "../../features/pets/MembersSection";
```

In `EditExisting`, render `<MembersSection pet={pet} />` between the form `Card` block and the archive `Button` (it must render for viewers too, i.e. OUTSIDE the `canEdit` conditional):

```tsx
      <MembersSection pet={pet} />

      {canEdit && (
        <Button
```

- [ ] **Step 3: Verify + commit**

Run: `npm run typecheck -w app && npm run build -w app`
Expected: clean.

Manual check (optional but encouraged if a dev server is feasible): `npm run dev`, dev-login, open a pet in Settings → pet — Members card lists you as Owner with the invite controls.

```bash
git add app/src/features/pets/MembersSection.tsx app/src/routes/settings/PetEditor.tsx
git commit -m "feat: members section with invites in pet settings"
```

---

### Task 9: App — /join route + login round-trip

**Files:**
- Create: `app/src/lib/pendingInvite.ts`
- Create: `app/src/routes/JoinInvite.tsx`
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Create the pending-invite handoff**

Create `app/src/lib/pendingInvite.ts`:

```ts
/**
 * Carries a /join/<token> across the Google OAuth round-trip: the logged-out
 * app saves it before showing Login (the OAuth callback always lands on "/"),
 * and the router replays it once a session exists. localStorage failures
 * (private mode) degrade to "invitee re-opens the link after logging in".
 */
const KEY = "pawary:pendingInviteToken";

export function savePendingInvite(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // ignore — see above
  }
}

export function takePendingInvite(): string | null {
  try {
    const token = localStorage.getItem(KEY);
    if (token !== null) localStorage.removeItem(KEY);
    return token;
  } catch {
    return null;
  }
}

export function pendingInviteFromPath(pathname: string): string | null {
  const match = /^\/join\/([^/]+)$/.exec(pathname);
  return match ? match[1]! : null;
}
```

- [ ] **Step 2: Create the join screen**

Create `app/src/routes/JoinInvite.tsx`:

```tsx
import { useNavigate, useParams } from "react-router";
import { ApiError } from "../api/client";
import { useAcceptInvite, useInvitePreview } from "../api/members";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { PawIcon } from "../components/icons";
import { Spinner } from "../components/Spinner";
import { useToast } from "../components/Toast";
import { useT } from "../i18n";

export function JoinInvite() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const { token } = useParams<{ token: string }>();
  const preview = useInvitePreview(token ?? "");
  const accept = useAcceptInvite();

  const invalid =
    token === undefined ||
    (preview.error instanceof ApiError && preview.error.status === 404);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-cream-100 p-6">
      <Card className="flex w-full max-w-sm flex-col items-center gap-4 p-6 text-center">
        <PawIcon className="h-12 w-12 text-clay-400" />
        {preview.isLoading ? (
          <Spinner />
        ) : invalid || !preview.data ? (
          <>
            <h1 className="font-display text-xl text-ink">
              {t.members.invalidTitle}
            </h1>
            <p className="text-sm text-ink-soft">{t.members.invalidBody}</p>
            <Button variant="soft" onClick={() => navigate("/")}>
              {t.members.goHome}
            </Button>
          </>
        ) : (
          <>
            <h1 className="font-display text-xl text-ink">
              {t.members.joinTitle}
            </h1>
            <p className="text-ink-soft">
              {t.members.joinPrompt(preview.data.petName, preview.data.inviterName)}
            </p>
            <p className="text-sm text-ink-faint">
              {t.members.joinAs(t.pets.role[preview.data.role])}
            </p>
            <div className="flex w-full flex-col gap-2">
              <Button
                disabled={accept.isPending}
                onClick={() =>
                  // token is defined here: the invalid branch handled undefined
                  accept.mutate(token!, {
                    onSuccess: (data) => {
                      toast.show(
                        data.alreadyMember
                          ? t.members.alreadyMember
                          : t.members.joined,
                      );
                      navigate("/", { replace: true });
                    },
                    onError: (error) =>
                      toast.show(
                        error instanceof ApiError ? error.message : t.errors.title,
                        { tone: "danger" },
                      ),
                  })
                }
              >
                {accept.isPending ? <Spinner className="h-4 w-4 text-white" /> : null}
                {t.members.accept}
              </Button>
              <Button variant="ghost" onClick={() => navigate("/", { replace: true })}>
                {t.members.decline}
              </Button>
            </div>
          </>
        )}
      </Card>
    </main>
  );
}
```

(`ToastProvider` wraps the entire app in `main.tsx`, so `useToast` works here even though this route renders outside `Shell` — verified.)

- [ ] **Step 3: Wire up App.tsx**

In `app/src/App.tsx`:

Add imports:

```tsx
import { useEffect } from "react";
import { useNavigate } from "react-router";
import {
  pendingInviteFromPath,
  savePendingInvite,
  takePendingInvite,
} from "./lib/pendingInvite";
import { JoinInvite } from "./routes/JoinInvite";
```

Add above `App`:

```tsx
/** Logged-out visit to /join/<token>: stash the token before showing Login. */
function LoginCapturingInvite() {
  const token = pendingInviteFromPath(window.location.pathname);
  if (token) savePendingInvite(token);
  return <Login />;
}

/** After login the OAuth callback lands on "/" — replay a stashed join. */
function PendingInviteRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    const token = takePendingInvite();
    if (token) navigate(`/join/${token}`, { replace: true });
  }, [navigate]);
  return null;
}
```

Replace BOTH `<Login />` usages in `App` with `<LoginCapturingInvite />` (the 401 branch and the final fallback branch).

Inside `<BrowserRouter>`, render the redirect helper before `<Routes>`, and add the join route as a SIBLING of the `Shell` route (outside it — invitees with zero pets must not hit Onboarding):

```tsx
          <BrowserRouter>
            <PendingInviteRedirect />
            <Routes>
              <Route path="/join/:token" element={<JoinInvite />} />
              <Route element={<Shell />}>
```

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck -w app && npm run build -w app`
Expected: clean.

Manual check (encouraged): with `npm run dev` and two dev-login users — user A creates an invite link, copy it, log in as user B (second browser/incognito), open the link: join card shows pet + inviter + role; Accept lands on Home with the pet visible.

```bash
git add app/src/lib/pendingInvite.ts app/src/routes/JoinInvite.tsx app/src/App.tsx
git commit -m "feat: join-invite route with OAuth round-trip token handoff"
```

---

### Task 10: Final verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Full suite from the repo root**

Run: `npm run typecheck && npm test`
Expected: all three workspaces typecheck; worker suite (204 + ~12 new) and app suite (20) green.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: vite build + PWA generation succeed.

- [ ] **Step 3: Spec sweep**

Re-read `docs/superpowers/specs/2026-06-12-pet-sharing-invites-design.md` § by §, confirming each requirement maps to shipped code/tests:
- §3 table/migration → Task 1
- §4 five member endpoints + two token endpoints, 404-no-oracle, atomic claim, already-member, audit events → Tasks 3–6
- §5 Members section, share/copy, /join route, login round-trip, EN/JA → Tasks 7–9
- §6 test coverage list → Tasks 1, 3–6 test files

Report any gap instead of silently patching.

- [ ] **Step 4: Commit any stragglers and report**

```bash
git status
```

Expected: clean tree, all commits made. Report completion to the user. DO NOT push or deploy — deployment (including `wrangler d1 migrations apply pawary --remote --env production`, which this plan REQUIRES before the next deploy because of the new table) is the user's call.
