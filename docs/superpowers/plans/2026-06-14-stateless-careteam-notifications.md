# Stateless Careteam Notifications (remove the Durable Object) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `CareteamNotifier` Durable Object with a stateless per-log push so the `pawary` Worker stops implementing any Durable Object (a prerequisite for per-PR preview URLs).

**Architecture:** On activity create, send one push per recipient immediately in `waitUntil` (no coalescing, no alarm, no watermark). Remove the DO class, its binding, and its export; add a `v2` `deleted_classes` Wrangler migration so production/preview drop the namespace on deploy.

**Tech Stack:** Cloudflare Workers, Hono, Drizzle (D1), web-push, `cloudflare:test` (vitest-pool-workers).

---

## CRITICAL environment notes for the implementer

- **Branch:** work is on `feat/stateless-careteam-notifications` (already checked out, based on `origin/main` @ 57f02aa). Do NOT create or switch branches.
- **Worktree:** `/Users/okdtsk/ghq/github.com/okdtsk/pawary/.claude/worktrees/preview` — all edits land here.
- **Running worker tests:** the vitest-pool-workers runtime needs loopback sockets, which the default command sandbox blocks. Run worker tests with the Bash tool's **`dangerouslyDisableSandbox: true`**, targeting specific files, e.g. `cd worker && npx vitest run test/careteam-notify.test.ts`. A run that prints `Test Files  N passed` is green; a `workerd ... Connection refused` / `EADDRNOTAVAIL` failure means you forgot to disable the sandbox — retry with it disabled, do not treat it as a code failure.
- **typecheck:** `npm run typecheck` from the repo root works normally (no sandbox flag needed).
- The harmless warning `Unexpected fields found in top-level field: "ratelimits"` always prints from wrangler; ignore it.

## Background the implementer needs

The careteam-notification feature pushes the *other* members of a pet when someone adds an activity. Today a per-pet Durable Object (`CareteamNotifier`) coalesces a 60s window into one push. We are removing coalescing: each create sends its own push. Everything else (who receives, the opt-out preference `users.notifyCareteamLogs`, the payload text, the web-push send + dead-subscription cleanup) is unchanged and reused.

Reused helpers (do NOT modify):
- `worker/src/domain/push/new-log.ts` — `buildNewLogPayload({ petName, petId, authorNames, itemCount, category, locale })` returns a JSON string `{title, body, url}`.
- `worker/src/domain/push/send.ts` — `sendOneAndCleanup(db, env, sub, payload)` sends one push and deletes the subscription on 403/404/410.

Schema columns used (from `worker/src/db/schema`): `pets.id/name`, `users.id/displayName/locale/notifyCareteamLogs`, `petMembers.petId/userId`, `pushSubscriptions.id/userId/endpoint/p256dh/auth`.

## File Structure

- **Create** `worker/src/domain/push/careteam-notify.ts` — stateless `notifyCareteamNewLog`.
- **Create** `worker/test/careteam-notify.test.ts` — unit tests for it.
- **Modify** `worker/src/routes/activities.ts` — call the new function instead of the DO ping.
- **Rewrite** `worker/test/activities-notify.test.ts` — assert the immediate push.
- **Delete** `worker/src/domain/push/careteam-notifier.ts` and `worker/test/careteam-notifier.test.ts`.
- **Modify** `worker/src/index.ts` — drop the DO export.
- **Modify** `worker/src/env.ts` — drop the DO binding + import.
- **Modify** `worker/wrangler.jsonc` — drop `durable_objects` (3 envs); add `v2` migration (3 envs).

---

## Task 1: Stateless notifier module + unit tests (TDD)

**Files:**
- Test: `worker/test/careteam-notify.test.ts` (create)
- Create: `worker/src/domain/push/careteam-notify.ts`

- [ ] **Step 1: Write the failing test**

Create `worker/test/careteam-notify.test.ts`:

```ts
import { env, fetchMock } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { pushSubscriptions, users } from "../src/db/schema";
import { notifyCareteamNewLog } from "../src/domain/push/careteam-notify";
import { newId } from "../src/lib/id";
import { seedPet, seedUserWithSession, withMember } from "./helpers";

const UA_P256DH =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const UA_AUTH = "BTBZMqHH6r4Tts7J_aSIgg";
const PUSH_ORIGIN = "https://push.example";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

function db() {
  return drizzle(env.DB);
}

async function seedSubscription(userId: string, path: string): Promise<string> {
  const id = newId();
  await db().insert(pushSubscriptions).values({
    id,
    userId,
    endpoint: `${PUSH_ORIGIN}${path}`,
    p256dh: UA_P256DH,
    auth: UA_AUTH,
    tzOffsetMin: 0,
    lastDigestDay: null,
    createdAt: Date.now(),
  });
  return id;
}

describe("notifyCareteamNewLog", () => {
  it("pushes the other opted-in member (consuming the interceptor)", async () => {
    const author = await seedUserWithSession({ email: "a@x.com", displayName: "Alice" });
    const other = await seedUserWithSession({ email: "b@x.com", displayName: "Bob" });
    const { petId } = await seedPet(author.userId, "owner", { name: "Rex" });
    await withMember(petId, other.userId, "editor");
    await seedSubscription(other.userId, "/bob");

    // If the push does NOT fire, this interceptor stays pending and the
    // afterEach assertNoPendingInterceptors throws — so this asserts the send.
    fetchMock.get(PUSH_ORIGIN).intercept({ path: "/bob", method: "POST" }).reply(201, "");
    await notifyCareteamNewLog(env, petId, { createdBy: author.userId, category: "food" });
  });

  it("never notifies the author", async () => {
    const author = await seedUserWithSession({ email: "a2@x.com", displayName: "Alice" });
    const { petId } = await seedPet(author.userId, "owner", { name: "Rex" });
    await seedSubscription(author.userId, "/alice");

    // No interceptor registered → no send expected (mirrors the prior DO test).
    await notifyCareteamNewLog(env, petId, { createdBy: author.userId, category: "food" });
  });

  it("skips members who opted out", async () => {
    const author = await seedUserWithSession({ email: "a3@x.com", displayName: "Alice" });
    const other = await seedUserWithSession({ email: "b3@x.com", displayName: "Bob" });
    const { petId } = await seedPet(author.userId, "owner", { name: "Rex" });
    await withMember(petId, other.userId, "editor");
    await seedSubscription(other.userId, "/bob3");
    await db().update(users).set({ notifyCareteamLogs: false }).where(eq(users.id, other.userId));

    await notifyCareteamNewLog(env, petId, { createdBy: author.userId, category: "food" });
  });

  it("deletes a dead (410) subscription", async () => {
    const author = await seedUserWithSession({ email: "a4@x.com", displayName: "Alice" });
    const other = await seedUserWithSession({ email: "b4@x.com", displayName: "Bob" });
    const { petId } = await seedPet(author.userId, "owner", { name: "Rex" });
    await withMember(petId, other.userId, "editor");
    const subId = await seedSubscription(other.userId, "/bob4");

    fetchMock.get(PUSH_ORIGIN).intercept({ path: "/bob4", method: "POST" }).reply(410, "");
    await notifyCareteamNewLog(env, petId, { createdBy: author.userId, category: "food" });

    const remaining = await db()
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, subId))
      .all();
    expect(remaining.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (sandbox disabled): `cd worker && npx vitest run test/careteam-notify.test.ts`
Expected: FAIL — cannot resolve `../src/domain/push/careteam-notify` (module not created yet).

- [ ] **Step 3: Write the implementation**

Create `worker/src/domain/push/careteam-notify.ts`:

```ts
import type { Category } from "@pawary/shared";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { petMembers, pets, pushSubscriptions, users } from "../../db/schema";
import type { Env } from "../../env";
import { buildNewLogPayload } from "./new-log";
import { sendOneAndCleanup } from "./send";

/** Per-create fan-out safety cap. */
const MAX_SENDS = 500;

/**
 * Immediately notify a pet's other careteam members about one new activity.
 * Stateless replacement for the former CareteamNotifier Durable Object: no
 * coalescing — each create sends its own push. Called fire-and-forget from the
 * activity POST handler via `waitUntil`.
 */
export async function notifyCareteamNewLog(
  env: Env,
  petId: string,
  activity: { createdBy: string; category: Category },
): Promise<void> {
  const db = drizzle(env.DB);

  const pet = await db
    .select({ name: pets.name })
    .from(pets)
    .where(eq(pets.id, petId))
    .get();
  if (!pet) return;

  const author = await db
    .select({ name: users.displayName })
    .from(users)
    .where(eq(users.id, activity.createdBy))
    .get();
  const authorName = author?.name ?? "";

  // Recipients: members of this pet who opted in and have a push subscription.
  // One row per (member × subscription); the author is filtered out below.
  const recipients = await db
    .select({
      userId: petMembers.userId,
      locale: users.locale,
      subId: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(petMembers)
    .innerJoin(users, eq(users.id, petMembers.userId))
    .innerJoin(pushSubscriptions, eq(pushSubscriptions.userId, petMembers.userId))
    .where(and(eq(petMembers.petId, petId), eq(users.notifyCareteamLogs, true)))
    .all();

  const payloadByLocale = new Map<string, string>();
  let sends = 0;
  for (const r of recipients) {
    if (r.userId === activity.createdBy) continue; // never notify the author
    if (sends >= MAX_SENDS) {
      console.log(`careteam notify cap reached (${MAX_SENDS}) for pet ${petId}`);
      break;
    }
    let payload = payloadByLocale.get(r.locale);
    if (payload === undefined) {
      payload = buildNewLogPayload({
        petName: pet.name,
        petId,
        authorNames: [authorName],
        itemCount: 1,
        category: activity.category,
        locale: r.locale,
      });
      payloadByLocale.set(r.locale, payload);
    }
    sends++;
    await sendOneAndCleanup(
      db,
      env,
      { id: r.subId, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth },
      payload,
    );
  }
}
```

Note: `r.locale` mirrors the type the former DO passed to `buildNewLogPayload` (it compiled there). If typecheck complains that `r.locale` is `string | null` where a `string` key/arg is expected, use `r.locale ?? ""` for the Map key and `locale: r.locale ?? "en"` for the payload arg — but try the direct form first to match the original.

- [ ] **Step 4: Run the test to verify it passes**

Run (sandbox disabled): `cd worker && npx vitest run test/careteam-notify.test.ts`
Expected: PASS — `Test Files  1 passed`, 4 tests passed.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. (Both `careteam-notifier.ts` and `careteam-notify.ts` exist now; that's fine.)

- [ ] **Step 6: Commit**

```bash
git add worker/src/domain/push/careteam-notify.ts worker/test/careteam-notify.test.ts
git commit -m "feat: stateless per-log careteam notifier"
```

---

## Task 2: Swap the call site + rewrite the integration test

**Files:**
- Modify: `worker/src/routes/activities.ts` (import line 8; the `waitUntil` block at lines 113-117)
- Rewrite: `worker/test/activities-notify.test.ts`

- [ ] **Step 1: Rewrite the integration test first**

Replace the entire contents of `worker/test/activities-notify.test.ts` with:

```ts
import { env, fetchMock, SELF } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { pushSubscriptions } from "../src/db/schema";
import { newId } from "../src/lib/id";
import { seedPet, seedUserWithSession, withMember } from "./helpers";

const UA_P256DH =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const UA_AUTH = "BTBZMqHH6r4Tts7J_aSIgg";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

it("creating an activity immediately pushes other careteam members", async () => {
  const author = await seedUserWithSession({ email: "auth@x.com", displayName: "Alice" });
  const other = await seedUserWithSession({ email: "other@x.com", displayName: "Bob" });
  const { petId } = await seedPet(author.userId, "owner", { name: "Rex" });
  await withMember(petId, other.userId, "editor");
  await drizzle(env.DB).insert(pushSubscriptions).values({
    id: newId(),
    userId: other.userId,
    endpoint: "https://push.example/bob-create",
    p256dh: UA_P256DH,
    auth: UA_AUTH,
    tzOffsetMin: 0,
    lastDigestDay: null,
    createdAt: Date.now(),
  });

  // The push fires from the request's waitUntil; register the interceptor
  // BEFORE the POST and poll until it is consumed.
  fetchMock
    .get("https://push.example")
    .intercept({ path: "/bob-create", method: "POST" })
    .reply(201, "");

  const res = await SELF.fetch(`https://app.local/api/pets/${petId}/activities`, {
    method: "POST",
    headers: {
      Cookie: author.cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": author.csrfToken,
    },
    body: JSON.stringify({ category: "note", occurredAt: Date.now(), tzOffsetMin: 0 }),
  });
  expect(res.status).toBe(201);

  await vi.waitFor(() => fetchMock.assertNoPendingInterceptors());
});
```

- [ ] **Step 2: Run it to verify it FAILS (call site still pings the DO)**

Run (sandbox disabled): `cd worker && npx vitest run test/activities-notify.test.ts`
Expected: FAIL — the POST still arms the DO (no immediate push), so the interceptor stays pending and `vi.waitFor` times out.

- [ ] **Step 3: Swap the call site in `worker/src/routes/activities.ts`**

Change the import on line 8 from:

```ts
import { pingCareteamNotifier } from "../domain/push/careteam-notifier";
```

to:

```ts
import { notifyCareteamNewLog } from "../domain/push/careteam-notify";
```

Replace the `waitUntil` block (currently lines 113-117):

```ts
    c.executionCtx.waitUntil(
      pingCareteamNotifier(c.env, petId).catch((e) =>
        console.error("careteam notify ping failed", e),
      ),
    );
```

with:

```ts
    c.executionCtx.waitUntil(
      notifyCareteamNewLog(c.env, petId, {
        createdBy: activity.createdBy,
        category: activity.category,
      }).catch((e) => console.error("careteam notify failed", e)),
    );
```

- [ ] **Step 4: Run the integration test to verify it PASSES**

Run (sandbox disabled): `cd worker && npx vitest run test/activities-notify.test.ts`
Expected: PASS — 1 test passed.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/activities.ts worker/test/activities-notify.test.ts
git commit -m "feat: send careteam push per-log on create instead of via DO"
```

---

## Task 3: Remove all Durable Object wiring (atomic)

Do these together so no committed state has a dangling DO reference (a binding pointing at a deleted class would break the test runtime).

**Files:**
- Delete: `worker/src/domain/push/careteam-notifier.ts`
- Delete: `worker/test/careteam-notifier.test.ts`
- Modify: `worker/src/index.ts` (line 20)
- Modify: `worker/src/env.ts`
- Modify: `worker/wrangler.jsonc` (3 envs)

- [ ] **Step 1: Delete the DO class and its test**

```bash
git rm worker/src/domain/push/careteam-notifier.ts worker/test/careteam-notifier.test.ts
```

- [ ] **Step 2: Remove the DO export from `worker/src/index.ts`**

Delete line 20 entirely:

```ts
export { CareteamNotifier } from "./domain/push/careteam-notifier";
```

- [ ] **Step 3: Remove the DO binding from `worker/src/env.ts`**

Delete the import line near the top:

```ts
import type { CareteamNotifier } from "./domain/push/careteam-notifier";
```

and delete this field from the `Env` type:

```ts
  CARETEAM_NOTIFIER: DurableObjectNamespace<CareteamNotifier>;
```

- [ ] **Step 4: Remove `durable_objects` and add the `v2` migration in `worker/wrangler.jsonc`**

There are **three** near-identical occurrences — the top-level env, `env.production`, and `env.preview`. In **each** one:

(a) Delete the entire `durable_objects` block:

```jsonc
  "durable_objects": {
    "bindings": [
      { "name": "CARETEAM_NOTIFIER", "class_name": "CareteamNotifier" }
    ]
  },
```

(b) Replace the adjacent `migrations` array:

```jsonc
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["CareteamNotifier"] }
  ],
```

with:

```jsonc
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["CareteamNotifier"] },
    { "tag": "v2", "deleted_classes": ["CareteamNotifier"] }
  ],
```

Keep `v1` (migration history is append-only). The nested env blocks are indented more deeply; match the surrounding indentation. After editing, confirm there are **zero** remaining `durable_objects` occurrences and **three** `"tag": "v2"` occurrences:

```bash
grep -c 'durable_objects' worker/wrangler.jsonc   # expect 0
grep -c '"tag": "v2"' worker/wrangler.jsonc        # expect 3
```

- [ ] **Step 5: Validate JSONC + confirm no stray DO references**

```bash
node -e "JSON.parse(require('fs').readFileSync('worker/wrangler.jsonc','utf8').replace(/\/\/.*$/gm,'').replace(/,(\s*[}\]])/g,'\$1'))" && echo JSONC_OK
grep -rn 'CareteamNotifier\|CARETEAM_NOTIFIER\|careteam-notifier' worker/src worker/test || echo "NO_DO_REFS"
```
Expected: `JSONC_OK` and `NO_DO_REFS`.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0 (any leftover reference to the removed binding/class would fail here).

- [ ] **Step 7: Run the push + activity tests**

Run (sandbox disabled):
```bash
cd worker && npx vitest run test/careteam-notify.test.ts test/activities-notify.test.ts test/new-log.test.ts
```
Expected: all pass; `careteam-notifier.test.ts` no longer exists.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove CareteamNotifier Durable Object wiring"
```

---

## Task 4: Final verification + PR

- [ ] **Step 1: Full worker test suite**

Run (sandbox disabled): `cd worker && npx vitest run`
Expected: all test files pass. If the runtime fails to start with a `Connection refused` / `EADDRNOTAVAIL` error rather than a test assertion, the sandbox is still on — re-run with it disabled. If only certain integration files flake on startup locally, note it; CI is the authoritative gate.

- [ ] **Step 2: Wrangler config sanity (no DO, migrations present)**

Run: `cd worker && npx wrangler deploy --env preview --dry-run 2>&1 | tail -20`
Expected: a dry-run build succeeds and the output does not list a Durable Object binding. If `--dry-run` errors for lack of credentials in this environment, skip it — the JSONC validation in Task 3 Step 5 plus typecheck already cover config validity.

- [ ] **Step 3: Root typecheck once more + review the branch**

```bash
npm run typecheck
git log --oneline origin/main..HEAD
git diff origin/main..HEAD --stat
```
Expected commits: design doc, stateless notifier, call-site swap, DO removal. Changed files limited to: `worker/src/domain/push/careteam-notify.ts` (+test), `worker/src/routes/activities.ts`, `worker/test/activities-notify.test.ts`, deletions of `careteam-notifier.ts`/`careteam-notifier.test.ts`, `worker/src/index.ts`, `worker/src/env.ts`, `worker/wrangler.jsonc`, and the spec/plan docs.

- [ ] **Step 4: Push and open the PR (CONFIRM with the user first)**

Per repo convention all changes ship via PR. Confirm with the user before pushing, then:

```bash
git push -u origin feat/stateless-careteam-notifications
gh pr create --title "feat: stateless per-log careteam notifications (remove Durable Object)" --body "$(cat <<'EOF'
## Summary
- Replaces the `CareteamNotifier` Durable Object with a stateless `notifyCareteamNewLog` that sends one push per recipient immediately on activity create (in `waitUntil`).
- Drops the `durable_objects` binding from all three Wrangler envs and adds a `v2` `deleted_classes` migration so production/preview cleanly delete the namespace on deploy.
- Behavior change: rapid multi-adds now produce multiple notifications instead of one coalesced push.

This unblocks per-PR preview URLs (Cloudflare does not generate preview URLs for Workers that implement a Durable Object).

Design: `docs/superpowers/specs/2026-06-14-stateless-careteam-notifications-design.md`

## Deploy note (important)
Merging deploys to production via `wrangler deploy`, which runs the `v2` migration and drops the DO from `pawary`. To also drop it from `pawary-preview`, add the `preview` label to this PR once (the current deploy-based preview workflow runs `wrangler deploy --env preview`). The per-PR preview-URL PR must come AFTER this is deployed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Drop the DO from the preview worker**

Add the `preview` label to this PR (or run Actions → Preview → Run workflow on this branch). Confirm the run's `Deploy worker` step applies the `v2` migration on `pawary-preview`.

---

## Notes / gotchas

- **Negative tests** ("never notifies the author", "skips opted out") register no interceptor — they mirror the convention of the removed `careteam-notifier.test.ts`. They exercise the path without asserting an exact zero-count; the positive and 410-deletion tests carry the strong assertions.
- **`buildNewLogPayload` multi-item branch** is now unreachable (we always pass `itemCount: 1`). Left intact on purpose to keep this PR focused; pruning is a separate optional cleanup.
- **Do not** touch `users.notifyCareteamLogs`, its D1 migration, `new-log.ts`, `send.ts`, or the cron.
