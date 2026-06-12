# Pet Sharing Invites — Design

**Date:** 2026-06-12
**Status:** Approved
**Scope:** Let a pet owner invite other accounts to a pet via single-use shareable links, and manage members (roles, removal, leaving) from the pet settings screen. Post-v1 Phase 1.

## 1. Context

v1 shipped the full role model — `pet_members` (petId, userId, role `owner|editor|viewer`, composite PK) enforced by `pet-access` middleware on every pet route, with role-aware UI already in place (`pet.role` checks in `PetEditor`, `PresetsSettings`) — but no way to add a second member. This plan adds the invite/membership-management layer only; the permission semantics themselves do not change.

Constraints that shaped the design:

- Accounts are Google-OAuth-only; there is **no email-sending infrastructure** and this plan does not add any.
- Account deletion already implements the "pet must keep ≥1 owner" invariant (sole-owner pets are deleted, shared pets are left); member management must respect the same invariant.
- All mutations are audit-logged by convention; CSRF token required on mutations.

**External dependency (out of scope, user action):** the Google OAuth consent screen is in Testing status with okdtsk@gmail.com as the only test user. Invitees cannot sign in until they are added as test users or the app passes verification. Start verification in parallel.

## 2. Decisions (user-approved)

| Decision | Choice |
| --- | --- |
| Invite delivery | **Shareable link** — owner generates a tokenized URL and shares it via any messenger; no email infra |
| Link lifecycle | **Single-use, 7-day expiry**; role fixed at creation; expired/used links show a clear error |
| Storage | **`pet_invites` table with hashed token** (revocable + listable; stateless HMAC rejected — cannot list/revoke, and single-use needs a table anyway) |
| Invitable roles | `editor` / `viewer` only; `owner` is granted by promoting an existing member |
| Management rights | Owners manage members and invites; any member can read the member list and leave (unless last owner) |

## 3. Data

New table `pet_invites` (one D1 migration):

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text PK | random id, used in revoke URLs |
| `pet_id` | text FK → pets, cascade | |
| `role` | text enum `editor\|viewer` | granted on accept |
| `token_hash` | text, unique | SHA-256 of the 32-byte random URL token; raw token never stored |
| `created_by` | text FK → users, cascade | inviter, shown on the join screen |
| `created_at` / `expires_at` | integer ms | `expires_at = created_at + 7d` |
| `used_at` / `used_by` | integer / text, nullable | claim record; `used_by` references users (set null on delete) |

Invite URL: `https://pawary.okdtsk.dev/join/<token>`.

## 4. API

Under the existing `pet-access` middleware (member = read, owner = manage):

- `GET /api/pets/:petId/members` — members `{userId, name, role, createdAt}` + (owners only in response) pending invites `{id, role, expiresAt, createdBy}`. Used and expired invites are omitted.
- `POST /api/pets/:petId/invites` `{role}` → `{url, expiresAt}` (owner). Rate-limited alongside other mutations.
- `DELETE /api/pets/:petId/invites/:id` — revoke (owner).
- `PATCH /api/pets/:petId/members/:userId` `{role}` — promote/demote (owner). Rejected if it would leave 0 owners.
- `DELETE /api/pets/:petId/members/:userId` — owner removes a member, or any member targets **themself** to leave. Rejected if it would leave 0 owners (UI points sole owners at pet deletion instead).

Token endpoints (authenticated, *not* pet-scoped — the caller is not a member yet):

- `GET /api/invites/:token` — preview `{petName, role, inviterName}`; 404 for unknown/expired/used tokens (indistinguishable, no oracle).
- `POST /api/invites/:token/accept` — atomic claim: `UPDATE pet_invites SET used_at=?, used_by=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?` then insert membership; a lost race or replay returns the same 404 as an expired token. Accepting while already a member marks the invite used and returns success with an `alreadyMember` flag (no role change).

Audit log entries: `invite.created`, `invite.revoked`, `member.added` (on accept), `member.role_changed`, `member.removed` / `member.left`.

## 5. UI

- **`PetEditor` → Members section** (all members see it): list with name + role badge. Owners additionally get: role select per member, remove button (two-tap confirm, matching schedule delete), pending-invite rows with expiry + revoke, and **"Create invite link"** — role choice (editor/viewer) → create → `navigator.share` sheet, clipboard-copy fallback with toast. Non-owners get a **Leave** button (two-tap confirm).
- **`/join/:token` route:** logged-out → existing Google login with post-login redirect back to the join URL; logged-in → card with pet name, inviter, role, and Accept (→ joins, navigates to the pet, toast) / Decline (→ home, invite untouched). Invalid/expired/used → friendly error screen with a "go home" action.
- EN/JA strings for everything; member names come from the Google profile name already stored on `users`.

## 6. Testing

Worker vitest (SELF) per existing route-test patterns: every endpoint's happy path + authz failures (viewer/editor calling owner actions, non-member token access), last-owner guards (demote and remove), expiry, revocation, replay, double-claim race, already-a-member accept, and audit rows. App-side: pure helpers only, per current convention. CSP headers are untouched (`_headers` / `headers.ts` parity preserved — no new origins).

## 7. Out of scope

Email delivery, push notifications on join, per-category permissions, transfer-ownership flow (covered by promote + leave), invite analytics, OAuth verification itself.
