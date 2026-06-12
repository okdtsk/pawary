# Web Push Care Reminders — Design

**Date:** 2026-06-12
**Status:** Approved
**Scope:** Push notifications for care schedules: a push when an item becomes due, plus a daily morning digest of overdue items. Per-device opt-in for any pet member. Post-v1 Phase 4. Two plans: Plan 10 (worker) and Plan 11 (app + service worker).

## 1. Context

Care schedules (`care_schedules`: `nextDueAt`, `active`, anchored recurrence) exist since Plan 4 but only surface visually in-app. The PWA uses vite-plugin-pwa with the default **generateSW** strategy — push handlers require a custom service worker, i.e. switching to **injectManifest** and reproducing Plan 5's caching/update behavior by hand. The worker has no cron trigger. Web Push from a Cloudflare Worker needs VAPID (ES256 JWT) + RFC 8291 payload encryption (aes128gcm).

## 2. Decisions (user-approved)

| Decision | Choice |
| --- | --- |
| Timing | **At due time** (cron granularity) **+ daily overdue digest** at ~8:00 in each device's timezone |
| Audience | **Any member who opts in**, per device — viewers included |

## 3. Decisions (locked, technical)

| Decision | Choice |
| --- | --- |
| Cron | One wrangler cron `*/15 * * * *`; the scheduled handler does both jobs (due-now always; digest for subscriptions whose local time is in the 08:00 quarter-hour) |
| Dedup | New column `care_schedules.notified_due_at` (nullable int): send when `active AND nextDueAt <= now AND notified_due_at IS NOT nextDueAt`, then set it to `nextDueAt`. Recurrence advance produces a new `nextDueAt`, naturally re-arming. Digest dedup per day via `push_subscriptions.last_digest_day` (household day-key string) |
| Subscriptions | New table `push_subscriptions`: id, user_id (FK cascade), endpoint (unique), p256dh, auth, tz_offset_min (captured at subscribe, refreshed on re-subscribe), last_digest_day (nullable), created_at. Endpoints that return 404/410 on send are deleted (expired) |
| Crypto | VAPID keypair as worker secrets `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (base64url raw P-256; user-generated, setup step like ADVISOR_KEK) + `mailto:okdtsk@gmail.com` subject. Payload encryption RFC 8291 implemented against WebCrypto — prefer a small **permissive-licensed** dependency (verify license at implementation; if none suitable, implement in `worker/src/lib/webpush.ts` with unit tests) |
| API | `GET /api/push/public-key` (session) → `{publicKey}`; `POST /api/push/subscriptions` (session+csrf) `{endpoint, p256dh, auth, tz}` upsert by endpoint; `DELETE /api/push/subscriptions` `{endpoint}` (session+csrf, own subscriptions only) |
| Notification content | Due-now: per item — title "{pet}: {schedule name}", body localized "Due now" variant; Digest: per pet — "{pet}: N overdue care items" with names. `data.url = "/health"`; clicking focuses/opens the app there. Locale: per subscription? No — use the subscription owner's `users.locale` (fallback en) |
| Fan-out | For each due schedule: all subscriptions of all members of that pet. A device subscription covers all pets its user belongs to (no per-pet toggles in v1) |
| Service worker | Switch vite-plugin-pwa to `injectManifest`; new `app/src/sw.ts`: workbox precache + the SAME runtime caching rules currently generated (read them from the current vite config before porting), update-prompt compatibility (`registerType: "prompt"` flow preserved), `push` event → `showNotification`, `notificationclick` → focus/open `data.url` |
| Settings UI | Settings → "Notifications" card (on SettingsHome or a small screen): enable-on-this-device button (permission request + subscribe), disable, status line; iOS hint that the app must be installed to Home Screen. EN/JA |
| Privacy/lifecycle | Subscriptions are device credentials: not exported, not audited, cascade-deleted with the user. No pet-scoped audit (no pet mutation happens) |

## 4. Out of scope

Per-pet or per-schedule notification toggles, quiet hours, notification history UI, anomaly-based pushes, badging API, Declarative Web Push.

## 5. Testing

Worker: webpush lib unit tests (JWT shape, encryption round-trip decryptable in test), subscription CRUD + authz, scheduled-handler logic via direct export with a fake `now` (due-now dedup, re-arm after recurrence advance, digest hour matching + day dedup, expired-endpoint cleanup) using fetchMock for the push service. App: SW build verification (vite build with injectManifest), pure helpers unit-tested; manual device test post-deploy (push can't be e2e-tested headlessly).
