# Hardening Batch (Phase 5) — Design

**Date:** 2026-06-13
**Status:** Approved
**Scope:** Three workstreams: (A) accumulated review-debt fixes, (B) real rate limiting via the GA Workers rate-limiting binding, (C) audit log UI. Deferred by user choice: image thumbnailing, tunable anomaly thresholds.

## A. Review-debt fixes (all recorded findings; one plan task each or grouped)

| # | Fix | Source |
|---|---|---|
| A1 | Advisor composer `maxLength={4000}` + a neutral fallback toast string for unknown error codes (covers `validation`, `not_found`) — new i18n key `advisor.errors.fallback` | Phase 3 final review |
| A2 | Advisor conversation list shows relative dates (today/yesterday via existing `relativeDayKind`, else short date) | spec §5 deviation |
| A3 | Advisor settings `apiKeyHint` becomes a per-provider hint with the provider's key-console URL as a visible link (Anthropic console, OpenAI platform, Google AI Studio) | Phase 3 final review |
| A4 | Editors without a key can READ shared advisor threads: show the conversation list always; the setup CTA replaces only the composer/new-conversation affordances | Phase 3 final review (UX) |
| A5 | Push: preserve `last_digest_day` on re-subscribe when the endpoint's `user_id` is unchanged (only reset on user change) | Phase 4 final review |
| A6 | Push cron: when the 500-send cap interrupts the due-now loop, do NOT set `notified_due_at` for schedules whose sends were skipped (they retry next tick) | Phase 4 final review |
| A7 | `GET /api/push/public-key` returns 503 `push_unconfigured` when the secret is unset/empty | Phase 4 final review |
| A8 | Push cron: 403 responses from push services count as key-mismatch — delete the subscription (post-VAPID-rotation self-healing) | user-approved follow-up |
| A9 | Fix `worker/test/insights.test.ts` near-midnight flake: seed activities at fixed absolute mid-day timestamps instead of now-relative offsets (keep the same coverage) | session finding 2026-06-12 |

## B. Real rate limiting

- Replace the in-memory fixed-window counter with the **GA `ratelimits` binding** (top-level wrangler config; periods limited to 10s/60s, fixed per binding, per-colo counters — accepted: strictly better than per-isolate).
- **Keep the middleware signature** `rateLimit(prefix, limit, windowMs, keyBy)` as the call-site API. The middleware resolves `prefix` → a named binding via a static map; `limit`/`windowMs` args become documentation-only (assert in dev that they match the table).
- Re-expressed limits (per-60s bindings; long windows approximated, intent = abuse-slowing):

| prefix | old | new binding limit/60s |
|---|---|---|
| auth-google, auth-callback, auth-dev-login | 10/60s | 10 |
| invite-preview | 30/60s | 30 |
| invite-accept | 10/60s | 10 |
| advisor-test | 5/60s | 5 |
| invite-create | 20/h | 5 |
| advisor-chat | 20/5min | 5 |
| (any other existing call sites found in code) | as found | nearest per-minute equivalent, documented in the plan |

- One binding per distinct limit VALUE (bindings: `RL_10`, `RL_30`, `RL_5` per 60s — shared across prefixes with the same limit; the key remains `${prefix}:${id}` so prefixes don't collide). `namespace_id` values assigned 1001+.
- Tests: miniflare/workerd implements the binding locally — verify early in the plan; existing `rate-limit*.test.ts` rewritten against the new middleware behavior (per-binding fakes are NOT needed if workerd enforces real limits; otherwise inject a test double behind the same map). The in-memory implementation is deleted.
- `env.ts` gains the binding types; wrangler config top-level AND `env.production`.

## C. Audit log UI

- **Endpoint:** `GET /api/pets/:petId/audit?cursor=` — **owner-only** (sensitive: shows member actions). Keyset-paginated (createdAt DESC, id DESC, page 50, opaque cursor reusing the existing `lib/cursor.ts` pattern), rows joined LEFT to users for actor `displayName` (deleted users → null). Response rows: `{id, actorName|null, action, entity, entityId, summary, createdAt}` where `summary` is a SERVER-side minimal string from the diff: pet/schedule/preset/member/invite/advisor diffs are small and content-light by design; activities: category only (`diff` for activity create/update may contain details — do NOT include raw diffs in the response; derive `summary` from whitelisted fields: title/name/category/role keys only).
- **UI:** PetEditor gains an owner-only "History" link → new route `/settings/pets/:petId/audit`: reverse-chron list (actor, localized action/entity label, summary, relative date), "show more" pagination button. EN/JA via a new `audit` i18n section with per-entity/action labels.
- No schema changes; `audit_log` already has `idx_audit_pet` (verify it covers (petId, createdAt) ordering needs; add an index in a migration ONLY if the query plan requires it).

## Out of scope

Image thumbnailing, tunable anomaly thresholds, audit retention policies, CSV export of audit, admin tooling.

## Testing

A-fixes: each lands with a regression test where the behavior is server-side (A5-A9); UI fixes verified by typecheck/build (+ unit tests where pure). B: middleware tests against real workerd binding enforcement (or injected double), all existing suites stay green (rate-limited routes' tests must not trip limits — check test volumes vs new limits). C: endpoint authz (owner-only: editor 403, non-member 404), pagination, summary whitelisting (no raw diff leakage), UI typecheck/build.
