# Careteam new-log notifications — design

**Date:** 2026-06-14
**Status:** Approved

## Overview

When a careteam member adds an activity (log item) for a pet, the other members
of that pet receive a coalesced web-push notification within ~60 seconds — e.g.
"Alice logged Food for Rex" or "Alice added 3 logs for Rex". Coalescing is
performed by a per-pet **Durable Object** using a fixed 60-second alarm window
(trailing-edge). Each recipient can opt out via a new per-user preference.

This builds entirely on the existing web-push infrastructure (VAPID sender,
`push_subscriptions`, the `{title, body, url}` service-worker payload contract).
Only the *trigger* mechanism is new.

### Locked decisions

- **Timing:** real-time + coalesced via a Durable Object (trailing-edge).
- **Window:** fixed 60s from the first un-notified event (NOT debounce —
  resetting on every add could starve a continuously-logging member).
- **Recipients:** all other members of the pet (owner/editor/viewer), minus the
  author(s) of the items in the window, minus anyone who opted out or has no
  push subscription.
- **Preference:** a per-user toggle, independent of the push on/off subscription.
- **Content:** author + pet + category; coalesced count for multiple items;
  multiple authors joined ("Alice & Bob"). No memo/detail values (avoid leaking
  content into the OS notification tray).
- **Trigger:** only on activity **create**, not edit/delete.

## Data model changes

- **`users.notifyCareteamLogs`** — new boolean column, `NOT NULL DEFAULT true`.
  The per-user preference. Stored on `users` (matching how `locale` lives there)
  rather than a new table.
- **Durable Object internal state (SQLite-backed):** per-pet `lastNotifiedAt`
  watermark (ms epoch) and whether an alarm is currently pending. No activity
  data is duplicated into the DO; it queries D1 when the alarm fires.
- **No change to `activities`** — `createdAt` + `createdBy` (+ `deletedAt`) are
  the watermark source of truth.

A Drizzle migration adds the `users` column. The DO's own SQLite schema is
managed inside the DO (created lazily on first use).

## Components

### `CareteamNotifier` Durable Object

- **Binding:** `CARETEAM_NOTIFIER`. Registered as a `new_sqlite_classes`
  migration and added to the dev / production / preview environments in
  `worker/wrangler.jsonc` (all three — easy to miss one).
- **One instance per pet:** `idFromName(petId)`.

**`ping(petId)`** (RPC, called from the activity POST handler):
- If no alarm is currently pending, set an alarm for `now + 60_000` and mark
  pending. On this arming transition, if `lastNotifiedAt` is unset (fresh DO),
  initialize it to `now - 60_000` (one window of lookback). This bounds the
  first-ever fire to roughly the last window of activity — never the pet's whole
  history — while still including the activity that triggered this `ping` (it
  was created a few ms before `now`). Otherwise record nothing else: the
  activity already lives in D1.
- If an alarm is already pending, no-op. This is the fixed-window behaviour:
  latency is bounded to one window regardless of how many adds arrive.

**`alarm()`:**
1. Read the `lastNotifiedAt` watermark (always set by the arming `ping`).
2. Query D1 for live activities on this pet with `createdAt > watermark` and
   `deletedAt IS NULL`, joined to the author's `displayName` and `createdBy`.
3. If there are no such activities, advance the watermark and clear the pending
   flag, then return (cheap no-op for solo pets / all-deleted items).
4. Resolve recipients: pet members of this pet, minus the distinct author IDs
   of the queried activities, with `users.notifyCareteamLogs = true`, joined to
   their `push_subscriptions`.
5. For each recipient, compute the items **excluding that recipient's own
   authored items** (you are never notified about your own log), then build the
   localized payload from the recipient's `locale`.
6. Fan out via the existing `sendPush`, reusing the cron's 403/404/410
   subscription-cleanup behaviour (see "Shared send helper").
7. Advance `lastNotifiedAt` to the max `createdAt` seen and clear the pending
   flag. Done **after** the send attempt, mirroring the cron's `notifiedDueAt`
   pattern, so an alarm retry (alarms retry on thrown exceptions) does not
   re-fan-out already-notified items.

**Idempotency note:** push sends are best-effort. If individual sends fail they
are not retried by re-running the alarm (the watermark still advances); the
trade-off is the same as the existing care-schedule cron. This avoids the much
worse failure of double-notifying everyone on every transient send error.

### Shared send helper

Factor the per-endpoint send loop currently embedded in
`worker/src/domain/push/cron.ts` (the `trySend` closure: send, then delete the
subscription on 403/404/410, count failures) into a small shared helper used by
both `cron.ts` and the DO. This avoids duplicating the subscription-cleanup
logic. Keep the cron's existing behaviour byte-for-byte; this is a refactor, not
a behaviour change.

## Trigger wiring

In `activityRoutes.post("/api/pets/:petId/activities", ...)`, after the activity
is inserted and the audit row written:

```ts
c.executionCtx.waitUntil(
  pingCareteamNotifier(c.env, petId).catch((e) =>
    console.error("careteam notify ping failed", e),
  ),
);
```

- Wrapped in `waitUntil` + `catch` so a DO hiccup can **never** fail the log
  write — the activity is already committed and audited.
- Only on **create**, not edit/delete.
- `pingCareteamNotifier(env, petId)` is a thin helper that resolves the per-pet
  stub via `env.CARETEAM_NOTIFIER.idFromName(petId)` and calls `ping()`.

## Notification payload & content

Reuses the existing `{ title, body, url }` payload contract — **no
service-worker change required**.

- **title** = pet name (e.g. `Rex`).
- **body** (localized EN/JA), by distinct-author count and item count, computed
  per recipient over the items that are not their own:
  - 1 item: `Alice logged Food` / `AliceさんがFoodを記録しました`
  - N items, 1 author: `Alice added 3 logs` / `Aliceさんが3件記録しました`
  - N items, ≥2 authors: `Alice & Bob added 3 logs` /
    `AliceさんとBobさんが3件記録しました`
- **url** = `/log?pet=<petId>`.

Category names need a **server-side EN/JA label map** — the worker currently has
no i18n. Add a small `categoryLabels` const (mirroring the app's `en.ts`/`ja.ts`
category labels) in the push domain. These builders are pure functions (like the
existing `buildDuePayload` / `buildDigestPayload`) and are unit-tested directly.

## Notification target / deep-link

The selected pet is stored client-side in `localStorage`
(`pawary:selectedPetId`) via `usePets().selectPet(id)`. The notification opens
`/log?pet=<petId>`:

- `LogTab` reads the `?pet=` search param and, if present and a valid
  membership, calls `selectPet(petId)` before rendering, so tapping always lands
  on the correct pet's log.
- The existing `notificationclick` handler in `app/src/sw.ts` already navigates
  to `payload.url` — no SW change.

## Preference UI

- **API:** `GET /api/me` includes `notifyCareteamLogs`; `PATCH /api/me` accepts
  it. Extend `updateMeSchema` and `MeResponse` in `shared/src/index.ts`.
- **UI:** a toggle in `NotificationsCard` (Settings → Notifications), shown when
  push is supported. Independent of the push enable/disable subscription state —
  a user can have push on but careteam-log notifications off.

## Testing

- **DO unit tests** (`vitest-pool-workers`, using `runDurableObjectAlarm`):
  - `ping` sets exactly one alarm; a repeat `ping` within the window is a no-op.
  - `alarm()` queries D1, excludes the author from recipients, excludes each
    recipient's own items from their payload, respects `notifyCareteamLogs`,
    advances the watermark, and is idempotent when the alarm re-runs.
  - Solo pet / all-items-deleted → no sends, watermark still advances.
- **Payload builder tests:** pure-function coverage of the 1 / N / multi-author
  EN and JA bodies.
- **Route test:** POST activity triggers a `ping` (DO stub mocked).
- **Shared send helper:** behaviour-preserving refactor verified by the existing
  cron tests staying green.

## Edge cases

- Author logs continuously past 60s → the next window opens only on the next
  `ping` after the alarm fires. Bounded latency, no starvation.
- Recipient with no push subscription or `notifyCareteamLogs = false` → skipped.
- Activity soft-deleted before the alarm fires → excluded (`deletedAt IS NULL`).
- Solo pet (no other members) → alarm finds no recipients, still advances the
  watermark cheaply.
- Multiple authors in one window → distinct-author join in the body; each
  recipient still excludes their own items.

## Out of scope (YAGNI)

- Per-category or per-pet notification preferences (single global toggle only).
- In-app notification inbox / history (push only).
- Notifications on edit or delete.
- Email / other channels.
