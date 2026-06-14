# Stateless Careteam Notifications (remove the Durable Object) — Design

Date: 2026-06-14

## Goal

Replace the `CareteamNotifier` Durable Object with a stateless, per-log push so the
`pawary` Worker stops implementing any Durable Object. This is a prerequisite for per-PR
Cloudflare Workers **preview URLs**, which are not generated for Workers that implement a
Durable Object. Reference (preview URLs): the companion design
`2026-06-14-per-pr-preview-urls-design.md`.

## Why this change

The careteam-notification feature (PR #17) introduced `CareteamNotifier`, a per-pet
Durable Object whose sole purpose is **coalescing**: it arms a 60-second trailing-edge
alarm on each activity create and then sends one combined push per recipient. The DO's
only state is a `lastNotifiedAt` watermark + a pending-alarm flag.

That Durable Object disqualifies the Worker from preview URLs (Cloudflare restriction:
preview URLs are not generated for Workers implementing a DO). Rather than work around it,
we drop coalescing and send **one push per activity, immediately**. The Worker becomes
stateless again and requalifies for preview URLs.

## Decisions (settled during brainstorming)

- **Mechanism:** per-log immediate — on activity create, send individual pushes in
  `waitUntil`. No DO, no alarm, no watermark.
- **Trade-off accepted:** rapid multi-adds now yield multiple notifications instead of one
  coalesced push.
- **Scope:** only the notification *trigger/transport* changes. The recipient rules, the
  opt-out preference, the payload format, and the web-push send/cleanup are unchanged.
- **DO teardown:** remove the `durable_objects` binding from all three Wrangler envs and
  add a `v2` `deleted_classes: ["CareteamNotifier"]` migration so production/preview
  cleanly drop the namespace (and its stored watermark — no important data).
- **Sequencing:** ship as its own PR that merges and deploys (via the existing
  deploy-based flow) BEFORE the preview-URL PR. See "Deploy sequencing".

## Background — current behavior (origin/main @ 57f02aa)

- `worker/src/routes/activities.ts:113` — after inserting an activity and writing the
  audit row, the POST handler calls
  `c.executionCtx.waitUntil(pingCareteamNotifier(c.env, petId).catch(...))`.
- `worker/src/domain/push/careteam-notifier.ts` — the `CareteamNotifier` DO:
  - `ping(petId)`: stores `petId`, arms a fixed 60s alarm if none pending, seeds
    `lastNotifiedAt = now - 60_000` on a fresh DO.
  - `alarm()`: queries D1 for live activities since the watermark, resolves recipients
    (pet members with `notifyCareteamLogs = true` and a push subscription, minus the item
    authors), builds a localized coalesced payload per recipient, fans out via
    `sendOneAndCleanup`, advances the watermark. Caps fan-out at `MAX_SENDS = 500`.
  - `pingCareteamNotifier(env, petId)` — fire-and-forget `idFromName(petId)` → `ping`.
- `worker/src/env.ts` — `CARETEAM_NOTIFIER: DurableObjectNamespace<CareteamNotifier>` plus
  a type-only import of `CareteamNotifier`.
- `worker/src/index.ts:20` — `export { CareteamNotifier } from "./domain/push/careteam-notifier";`
- `worker/wrangler.jsonc` — all three envs (top-level dev, `env.production`,
  `env.preview`) carry:
  ```jsonc
  "durable_objects": { "bindings": [ { "name": "CARETEAM_NOTIFIER", "class_name": "CareteamNotifier" } ] },
  "migrations": [ { "tag": "v1", "new_sqlite_classes": ["CareteamNotifier"] } ],
  ```
- Reused helpers that STAY: `buildNewLogPayload`/`formatAuthors`
  (`worker/src/domain/push/new-log.ts`), `sendOneAndCleanup`
  (`worker/src/domain/push/send.ts`), the `users.notifyCareteamLogs` column + its D1
  migration, and the `*/15` cron (unrelated digest cron).

## Components

### 1. New stateless notifier `worker/src/domain/push/careteam-notify.ts`

Replaces `careteam-notifier.ts`. Exports:

```ts
export async function notifyCareteamNewLog(
  env: Env,
  petId: string,
  activity: { createdBy: string; category: Category },
): Promise<void>
```

Behavior:
1. Look up pet name (`pets.name`); if the pet is gone, return.
2. Look up the author's `displayName` (`users` by `activity.createdBy`); default to `""`.
3. Resolve recipients: rows of (member × push subscription) where `petMembers.petId = petId`
   and `users.notifyCareteamLogs = true`, selecting `userId, locale, subId, endpoint,
   p256dh, auth`. (Same join the DO used.)
4. For each recipient row, skip when `userId === activity.createdBy` (never notify the
   author). Build the payload once per `locale` (cache in a `Map`) via
   `buildNewLogPayload({ petName, petId, authorNames: [authorName], itemCount: 1,
   category: activity.category, locale })`, then `await sendOneAndCleanup(db, env, sub,
   payload)`. Cap total sends at `MAX_SENDS = 500`; log once if capped.

No DO, no storage, no alarm. Errors propagate to the caller's `.catch`.

### 2. Call site `worker/src/routes/activities.ts`

- Replace the import `pingCareteamNotifier` (from `../domain/push/careteam-notifier`) with
  `notifyCareteamNewLog` (from `../domain/push/careteam-notify`).
- Replace the `waitUntil` body:
  ```ts
  c.executionCtx.waitUntil(
    notifyCareteamNewLog(c.env, petId, {
      createdBy: activity.createdBy,
      category: activity.category,
    }).catch((e) => console.error("careteam notify failed", e)),
  );
  ```

### 3. Remove the Durable Object wiring

- Delete `worker/src/domain/push/careteam-notifier.ts`.
- `worker/src/index.ts` — remove the `export { CareteamNotifier } ...` line.
- `worker/src/env.ts` — remove the `CARETEAM_NOTIFIER` field and the
  `import type { CareteamNotifier }` line.

### 4. `worker/wrangler.jsonc` — drop the binding, add the delete migration

In **each** of the three envs (top-level, `env.production`, `env.preview`):
- Remove the `"durable_objects": { ... }` block entirely.
- Replace the `migrations` array with:
  ```jsonc
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["CareteamNotifier"] },
    { "tag": "v2", "deleted_classes": ["CareteamNotifier"] }
  ],
  ```

Keep `v1` (migration history must be append-only). `v2` deletes the namespace and its
stored watermark on the next `wrangler deploy` for that env.

### 5. Tests

- Delete `worker/test/careteam-notifier.test.ts` (DO-alarm test).
- Add `worker/test/careteam-notify.test.ts` — unit test for `notifyCareteamNewLog`:
  seed a pet with an author + another member, give the other member a push subscription,
  intercept the push endpoint, call the function, assert exactly one push to the member.
  Cover: author is never notified; a member with `notifyCareteamLogs = false` gets nothing;
  a 410 response deletes the dead subscription (via `sendOneAndCleanup`).
- Rewrite `worker/test/activities-notify.test.ts` — POST an activity and assert the push
  fires immediately from the request's `waitUntil` (no `runDurableObjectAlarm`, no
  `CARETEAM_NOTIFIER`). Set up the push interceptor before the POST; use
  `cloudflare:test`'s execution-context draining so the `waitUntil` task completes before
  asserting no pending interceptors.
- `worker/test/new-log.test.ts` — unchanged (payload builder is untouched).

## Deploy sequencing (why this is its own PR)

Removing a DO class requires the `v2` migration to run via a real `wrangler deploy`;
`wrangler versions upload` (the mechanism the preview-URL PR switches to) does not apply
the delete. So this PR must land on the *current* deploy-based pipeline:

1. **Merge this PR** → production `wrangler deploy` runs `v2`, dropping the DO from `pawary`.
2. **Add the `preview` label to this PR** (any time before merge) → the existing
   `wrangler deploy --env preview` runs `v2`, dropping the DO from `pawary-preview`.
3. Only then is the Worker DO-free in every env, so the **preview-URL PR**
   (`feat/per-pr-preview-urls`, rebased onto this PR's merged `main`) produces working
   preview aliases.

## Out of scope

- The per-PR preview-URL workflow itself (separate PR / spec).
- Pruning the now-unused multi-item branch of `buildNewLogPayload`/`formatAuthors` (kept
  to minimize blast radius; can be removed later).
- Any change to recipients, the opt-out preference, payload wording, or the digest cron.

## Testing / verification

- `npm run typecheck` passes (the `CARETEAM_NOTIFIER` binding type is gone, so any stray
  reference would fail to compile).
- `npm test` (worker): `careteam-notify.test.ts` and the rewritten
  `activities-notify.test.ts` pass; `careteam-notifier.test.ts` is gone.
- `npx wrangler deploy --env preview --dry-run` (from `worker/`) succeeds with no
  `durable_objects` binding and the `v1`+`v2` migrations present — confirming the config is
  valid and the Worker no longer implements a DO.
- Post-merge manual check: adding an activity as one member delivers an immediate push to
  another opted-in member; adding three in quick succession delivers three pushes.
