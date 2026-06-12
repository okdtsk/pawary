# Pawary Plan 10: Web Push — Worker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server side of Web Push care reminders: subscription storage + endpoints, VAPID/RFC 8291 web-push sending, and a 15-minute cron that pushes due-now items and an 08:00-local overdue digest — fully TDD'd.

**Architecture:** Migration 0004 (`push_subscriptions` + `care_schedules.notified_due_at`). `worker/src/lib/webpush.ts` (VAPID ES256 JWT + aes128gcm payload encryption — in-house, WebCrypto-only). `worker/src/routes/push.ts` (public-key + subscription endpoints). `worker/src/domain/push/cron.ts` (`runPushCron(env, now)`) called by a `scheduled` handler in `index.ts`; wrangler cron `*/15 * * * *` in BOTH top-level and `env.production` (wrangler envs don't inherit triggers).

**Spec:** `docs/superpowers/specs/2026-06-12-web-push-design.md`. Conventions as Plans 1–9 (TDD; shard-run the full worker suite on this Mac: `npx vitest run --shard=1/2`, wait `until [ "$(netstat -an | grep -c TIME_WAIT)" -lt 200 ]; do sleep 5; done`, then `--shard=2/2`; commit per task with the exact message; never push/deploy).

**Locked decisions:**

| Decision | Choice |
|---|---|
| Web-push crypto | **In-house** `worker/src/lib/webpush.ts`. Rationale: candidate npm packages must be license-checked and audited; the surface we need (one encrypt + one JWT) is small and RFC 8291 Appendix A provides a complete official test vector for TDD. NO new dependencies. |
| VAPID secrets | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` env (base64url, uncompressed 65-byte public point / 32-byte private scalar), `VAPID_SUBJECT` constant `mailto:okdtsk@gmail.com` in code. Test values: a fixed P-256 keypair generated ONCE during Task 1 (deterministic fixture committed in the test file, fine for tests) and wired into `vitest.config.ts` bindings |
| Push send result handling | 201 = ok; 404/410 = delete subscription; 429/5xx = leave (retry next cron); anything else logged count only — never log endpoint bodies |
| Dedup | due-now: `notified_due_at` column compared to `nextDueAt`; digest: `last_digest_day` day-key per subscription, computed in the SUBSCRIPTION's tz |
| Digest window | subscription is digest-eligible when its local time-of-day ∈ [08:00, 08:15) at cron time |
| Content | localized via the owner-user's `users.locale` (`system` → en); strings live in a small dict inside `cron.ts` (worker has no i18n infra). Due-now: title `{petName}`, body `EN "{name} is due" / JA 「{name}の時間です」`. Digest: title `{petName}`, body `EN "{n} overdue care item(s): {names}" / JA 「未完了のケアが{n}件: {names}」`. Payload JSON `{title, body, url: "/health"}` |
| Batch safety | cron processes max 200 due schedules / 500 sends per run (log if capped) |

---

### Task 1: Migration + schema + secrets plumbing

**Files:** `worker/src/db/schema.ts`, `worker/src/env.ts`, `worker/vitest.config.ts`, generated `worker/drizzle/0004_add-push.sql`, test `worker/test/push-schema.test.ts`.

- Schema: `pushSubscriptions` table — `id` text PK, `userId` FK users cascade, `endpoint` text notNull unique, `p256dh` text notNull, `auth` text notNull, `tzOffsetMin` integer notNull, `lastDigestDay` text (nullable), `createdAt` integer notNull; index `idx_push_subscriptions_user` on userId. Plus `notifiedDueAt: integer("notified_due_at")` (nullable) added to `careSchedules`. Type export `PushSubscription`.
- `Env`: add `VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string;`.
- vitest bindings: generate a real P-256 keypair once (node script or WebCrypto in a scratch test), paste the base64url pair as fixed test constants into `vitest.config.ts` bindings.
- TDD: schema smoke test (insert/select subscription; update careSchedules.notifiedDueAt). Migration via `npm run db:generate -w worker -- --name=add-push`; must contain ONLY the new table + index + the ALTER TABLE for care_schedules. Full shard suite + typecheck.
- Commit: `feat: add push subscription schema and vapid env plumbing`

### Task 2: webpush lib (VAPID JWT + aes128gcm)

**Files:** `worker/src/lib/webpush.ts`, test `worker/test/webpush.test.ts`.

- Exports:
  - `vapidHeaders(endpointOrigin: string, publicKeyB64u: string, privateKeyB64u: string): Promise<{ Authorization: string }>` — ES256 JWT `{aud: endpointOrigin, exp: now+12h, sub: VAPID_SUBJECT}`, header `vapid t=<jwt>, k=<publicKey>`.
  - `encryptPayload(payload: string, p256dhB64u: string, authB64u: string): Promise<Uint8Array>` — RFC 8291 aes128gcm: ephemeral P-256 ECDH, HKDF per spec, coded header block, record padding delimiter 0x02.
  - `sendPush(sub: {endpoint, p256dh, auth}, payload: string, env: {VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY}): Promise<number>` — POSTs with headers `TTL: 300`, `Content-Encoding: aes128gcm`, `Urgency: normal`, returns status.
- TDD with the **official RFC 8291 Appendix A test vector**: WebFetch `https://www.rfc-editor.org/rfc/rfc8291` and copy the Appendix A inputs (user agent keys, auth secret, ephemeral key, salt) and expected ciphertext into the test. To make encryption deterministic for the vector, structure `encryptPayload` with an internal `encryptWithKeys(payload, p256dh, auth, ephemeralKeyPair, salt)` that the test drives with the vector's fixed ephemeral key + salt (import the private key via JWK), while the public `encryptPayload` generates random ones. Assert the exact expected ciphertext bytes from the RFC. Also test: JWT structure (split/decode header+claims, aud/exp/sub correct; signature verifies with WebCrypto against the test public key), `sendPush` via fetchMock (assert headers + binary body present, return status passthrough).
- Commit: `feat: add web push vapid and aes128gcm encryption lib`

### Task 3: Push routes

**Files:** `worker/src/routes/push.ts` (new, mounted in index.ts), shared schema additions, test `worker/test/push-routes.test.ts`.

- Shared (`shared/src/index.ts`): `pushSubscribeSchema = z.object({ endpoint: z.string().url().max(1024), p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(128), tz: z.number().int().min(-840).max(840) }).strict()`; `pushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(1024) }).strict()`; response type `PushPublicKeyResponse = { publicKey: string }`.
- Routes: `GET /api/push/public-key` (session) → `{publicKey: c.env.VAPID_PUBLIC_KEY}`. `POST /api/push/subscriptions` (session+csrf): upsert by endpoint (`onConflictDoUpdate` target endpoint — re-subscribe may arrive from a different user on a shared device: SET userId, keys, tzOffsetMin, reset lastDigestDay null). `DELETE /api/push/subscriptions` (session+csrf): delete where endpoint AND userId = caller (only own).
- Tests: subscribe→row state; re-subscribe same endpoint different user reassigns; unsubscribe own works / other's endpoint no-ops (assert row survives); validation 400s; 401 unauthenticated; public-key returns the test constant.
- Commit: `feat: add push subscription endpoints`

### Task 4: Cron domain + scheduled handler + wrangler triggers

**Files:** `worker/src/domain/push/cron.ts`, `worker/src/index.ts`, `worker/wrangler.jsonc`, test `worker/test/push-cron.test.ts`.

- `runPushCron(env: Env, now: number): Promise<{ dueSent: number; digestSent: number; deleted: number }>`:
  1. **Due-now:** select active schedules where `nextDueAt <= now` AND (`notifiedDueAt IS NULL OR notifiedDueAt != nextDueAt`), limit 200, join pets (name). For each: collect member userIds (petMembers), their subscriptions + users.locale; send localized payload to each subscription via `sendPush`; THEN set `notifiedDueAt = nextDueAt` (after attempting sends, regardless of per-endpoint failures — one attempt per due occurrence).
  2. **Digest:** select subscriptions where local time-of-day at `now` (using tzOffsetMin) is in [480, 495) minutes AND `lastDigestDay != todayKey(in that tz)`. For each subscription: collect that user's pets' active schedules with `nextDueAt < startOfTodayLocal` (genuinely overdue from before today, not just-became-due — decide: overdue = `nextDueAt < now` minus items already covered? Keep simple: `nextDueAt <= now`), group per pet, send one digest push per pet with overdue items (skip pets with none); set `lastDigestDay`.
  3. Sends capped at 500/run; 404/410 responses delete the subscription (count deleted).
- `index.ts`: `export default { fetch: app.fetch, scheduled: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => ctx.waitUntil(runPushCron(env, Date.now()).then((r) => console.log("push cron", r))) };` (keep `app.notFound`/`onError` as-is; type the export with `satisfies ExportedHandler<Env>` if clean).
- `wrangler.jsonc`: `"triggers": { "crons": ["*/15 * * * *"] }` top-level AND inside `env.production`.
- Tests (call `runPushCron(env, fixedNow)` directly; fetchMock intercepts push endpoints — use distinct fake endpoint hosts like `https://push.example/sub1`): due-now sends to all member subscriptions and sets notifiedDueAt; second run sends nothing; after simulating recurrence advance (update nextDueAt) it re-arms; non-member users get nothing; digest fires only in the 8:00 window for the subscription tz and only once per day (lastDigestDay set; second run same day silent); 410 from push service deletes the subscription; locale ja produces ja body (assert by decrypt? NO — payload is encrypted; instead assert via a spy seam: export the payload-builder `buildDuePayload(schedule, petName, locale)` separately and unit-test it; the send test just counts fetchMock calls).
- Commit: `feat: add push cron for due reminders and overdue digests`

### Task 5: Verification sweep

- Shard suite + root typecheck + build; spec sweep §3 table rows each mapped; README deployment section gains: VAPID secrets setup (`npx wrangler secret put VAPID_PUBLIC_KEY/--PRIVATE_KEY --env production`, keys generated with a one-liner node/openssl command documented there); `.dev.vars.example` gains both keys. Commit: `docs: document vapid secret setup` (fold into Task 4 commit if trivial). Report. No push/deploy.
