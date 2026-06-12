# AI Advisor — Design

**Date:** 2026-06-12
**Status:** Approved
**Scope:** BYO-key AI chat about a pet, grounded in its recent activity data. Multi-provider (Claude / OpenAI / Gemini), streaming replies, conversations persisted per pet and shared with all members. Post-v1 Phase 3. Implemented as two plans: Plan 08 (worker) and Plan 09 (app).

## 1. Context

The last unshipped CLAUDE.md headline feature. v1 already has: per-category activity data with details, the insights/anomalies domain (weight series, intake, symptom runs), care schedules, roles enforced by `pet-access`, an export pipeline, audit conventions, EN/JA i18n, and (Phase 1) shared pets. There is no LLM integration anywhere yet.

## 2. Decisions (user-approved)

| Decision | Choice |
| --- | --- |
| Providers | **All three at launch**: `anthropic`, `openai`, `gemini` — thin raw-HTTP adapters behind one interface (no provider SDKs in the worker) |
| Key model | **BYO key per user**, one active config per user (provider + model + key); switching provider replaces it |
| Key storage | **AES-GCM-256 encrypted in D1** via WebCrypto; KEK from worker secret `ADVISOR_KEK` (32-byte base64; prod via `wrangler secret put`, dev/tests via `.dev.vars` / test env). Key is write-only — never returned, logged, or audited |
| Replies | **Streaming**, normalized SSE (`delta` / `done` / `error`) regardless of provider |
| Persistence | **Conversations stored in D1, per pet** |
| Visibility | **Shared with all pet members** (viewer+ can read) |
| Write rights | **Editor+** creates conversations / sends messages / deletes conversations (viewers are read-only, consistent with the rest of the app) |
| Whose key pays | Always the **sender's** key/config; assistant messages record provider+model provenance and the author |
| Model selection | Free-text `model` field, pre-filled per provider (Claude default `claude-opus-4-8`; pickable `claude-sonnet-4-6`, `claude-haiku-4-5`); avoids hardcoded third-party model lists going stale |
| Tone | System prompt + persistent UI banner: AI assistant, **not** a veterinarian; concerning symptoms → see a vet. Localized EN/JA |
| Audit | New `advisor` audit entity. Conversation create/delete audited with **title only** — chat content never enters `audit_log`. User-level settings changes are not pet-scoped and are not audited (same as `/api/me` profile updates) |
| Export / deletion | Conversations included in pet export and account export; pet deletion cascades conversations; user deletion SET-NULLs authorship (family threads survive) |

## 3. Data (one D1 migration)

`user_ai_settings`: `user_id` text PK (FK users, cascade), `provider` text enum(`anthropic`|`openai`|`gemini`), `model` text, `encrypted_key` text (base64 iv‖ciphertext), `created_at`, `updated_at` (integer ms).

`advisor_conversations`: `id` text PK (ULID), `pet_id` FK pets cascade, `title` text (first user message, truncated ~80 chars), `created_by` text nullable FK users SET NULL, `created_at`, `updated_at` (bumped on each message; list sort key). Index `(pet_id, updated_at)`.

`advisor_messages`: `id` text PK, `conversation_id` FK advisor_conversations cascade, `role` text enum(`user`|`assistant`), `content` text, `author_id` text nullable FK users SET NULL (sender for both roles), `provider`/`model` text nullable (assistant rows only), `created_at`. Index `(conversation_id, created_at)`.

`audit_log.entity` enum gains `"advisor"` (type-only, no SQL).

## 4. Worker

**Settings (user-scoped, no pet middleware):**
- `GET /api/me/advisor` → `{settings: {provider, model} | null}` — null when unconfigured; the key itself is never in any response
- `PUT /api/me/advisor` `{provider, model, apiKey}` (zod, strict; apiKey 1..512 chars) → encrypt + upsert; returns the GET shape
- `DELETE /api/me/advisor` → remove

**Crypto:** `worker/src/lib/keycrypt.ts` — AES-GCM-256: `encrypt(plaintext, kekBase64)` → base64(iv‖ct), `decrypt`. KEK length validated at use; misconfigured KEK → 500 with a clear log, never a key leak.

**Conversations (pet-scoped):**
- `GET /api/pets/:petId/advisor/conversations` (viewer) → `[{id, title, createdByName|null, updatedAt}]`, newest first
- `GET /api/pets/:petId/advisor/conversations/:id` (viewer) → conversation + messages `[{id, role, content, authorName|null, provider?, model?, createdAt}]`
- `POST /api/pets/:petId/advisor/conversations` (editor, csrf, rate-limited) `{message, tz}` → creates conversation, persists user message, **streams** the reply
- `POST /api/pets/:petId/advisor/conversations/:id/messages` (editor, csrf, rate-limited) `{message, tz}` → appends + streams
- `DELETE /api/pets/:petId/advisor/conversations/:id` (editor, csrf) → delete + audit (`advisor`, delete, diff `{title}`)
- No-key case: POST endpoints return 409 `advisor_not_configured` before any provider call
- Rate limit: `advisor-chat`, 20 / 5 min, per user

**Streaming contract (both POST endpoints):** `content-type: text/event-stream`. Events: `event: delta` `data: {"text": "..."}` (N times) → `event: done` `data: {"conversationId", "messageId"}` → end. Failures: `event: error` `data: {"code", "message"}` (codes: `provider_auth` for upstream 401/403, `provider_error`, `provider_overloaded` for 429/529). The user message is persisted before the provider call; the assistant message is persisted when the stream completes (non-empty partials on mid-stream failure are persisted — the client shows what arrived plus the error).

**Providers (`worker/src/domain/advisor/`):** one module per provider exposing `streamChat({apiKey, model, system, messages}): AsyncIterable<string>` + shared types. Anthropic: `POST https://api.anthropic.com/v1/messages` `stream: true` (`x-api-key`, `anthropic-version: 2023-06-01`, max_tokens ~2048), parse SSE `content_block_delta`/`text_delta`. OpenAI: `POST https://api.openai.com/v1/chat/completions` `stream: true`, parse `choices[0].delta.content`. Gemini: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse` (`x-goog-api-key`), parse `candidates[0].content.parts[*].text`. Tested with `fetchMock` from `cloudflare:test`; no provider SDK dependencies.

**Context assembly (`worker/src/domain/advisor/context.ts`):** builds the system prompt from: localized advisor persona + not-a-vet framing; pet profile (name, species, breed, sex, age from birthday, targets); a 30-day digest computed from existing queries — per-category counts, weight latest+trend, recent symptoms/medications/vet visits (name + household date, capped ~15 each), active care schedules with next due; household "today" from the request `tz`. Hard cap on assembled size (~6k chars) with deterministic truncation. Conversation history: last 20 messages.

## 5. App

**Settings → AI Advisor** (`/settings/advisor`): provider Select, model TextInput (pre-filled on provider change, editable), API-key password input (never re-displayed; placeholder shows "configured" state), Save, Remove (two-tap). Hint text linking to each provider's key page. Status from `GET /api/me/advisor`.

**Advisor screen** (`/advisor`, inside Shell, selected pet): conversation list (title, author, relative date; editor+ sees "New conversation" + per-row delete two-tap) → chat view (bubbles with author attribution, streamed assistant text rendering incrementally, input disabled while streaming, persistent disclaimer banner). No key configured → empty state with a button to `/settings/advisor`. Viewer role → read-only (no composer). Entry point: a Home card. Streaming client: `fetch` + `ReadableStream` SSE parser in `app/src/api/advisor.ts` (the global `api()` helper is JSON-only — advisor gets its own fetch path with CSRF header).

**i18n:** full EN/JA for settings, chat, disclaimer, error codes (`provider_auth` → "Your API key was rejected by {provider}…", etc.).

## 6. Export & deletion

Pet export (`/api/pets/:petId/export`) and account export gain an `advisorConversations` section (conversations + messages). `deletePetWithStorage` needs no change (FK cascade). Account deletion relies on SET NULL for authorship; user's `user_ai_settings` row cascades away.

## 7. Testing

Worker: keycrypt round-trip + tamper rejection; settings CRUD incl. key never echoed; provider adapters against `fetchMock` (happy stream, auth error, malformed SSE); context builder unit tests (digest correctness, truncation cap); conversation CRUD + authz matrix (viewer read-only, editor writes, non-member 404); streaming endpoint end-to-end with mocked provider (delta/done order, persistence of both messages, partial-on-error persistence, 409 when unconfigured); export inclusion; audit rows (title-only diff). App: pure helpers (SSE line parser) unit-tested. CSP `_headers`/`headers.ts` untouched (server-side proxy — no new client origins).

## 8. Out of scope

Tool use / function calling, image attachments in chat, provider SDKs, conversation sharing outside the pet, token/cost display, response caching, Web Push notifications on replies, storing multiple provider configs per user.
