# Pawary — Design Spec (v1)

Date: 2026-06-11
Status: Approved (brainstorming complete; all six sections approved section-by-section)

Pawary is a mobile-first PWA (installable on iOS, equally usable on desktop) for logging
pet activities and proactively managing pet health, backed by a single Cloudflare Worker.

## 1. Product Scope

### Center of gravity: proactive care

Not just a journal. Pawary records daily activities, surfaces care schedules and due
dates, tracks daily intake targets, and flags simple anomalies — while staying advisory,
never diagnostic.

### v1 (this milestone)

- Google OAuth sign-in (+ localhost-only dev-login bypass)
- Multi-pet management (create/edit/archive, avatar, per-pet daily targets)
- Activity logging: 11 categories, full CRUD, photos, Quick Add presets
- Views: Home (today dashboard), Calendar tab (Month / Week / 3-Day / Day modes),
  Log tab (filterable infinite list)
- Care schedules with simple recurrence + due-date badges (in-app, no push)
- Health Analyzer: 4 charts + fixed anomaly heuristics
- i18n: English + Japanese from day 1
- Data export (JSON/CSV), self-service account deletion, audit log (written, no UI)
- PWA installability; offline read cache (writes require connectivity)
- Local development only (`wrangler dev`); deployment is a later step

### Deferred (designed for, schema-ready, not built in v1)

- Sharing UI (invites, member management) — `pet_members` schema active from day 1
- AI Advisor (user-configured OpenAI/Gemini/Claude API keys)
- Web Push notifications (badges are in-app only in v1)
- Offline mutation queue
- Audit log UI; tunable anomaly thresholds

## 2. Architecture & Stack

One Cloudflare Worker serves both the API (`/api/*`) and the static frontend (SPA
fallback via Workers static assets).

| Layer | Choice |
|---|---|
| Frontend | React 19 + TypeScript + Vite, Tailwind CSS, TanStack Query, React Router, Recharts |
| PWA | vite-plugin-pwa (Workbox) |
| Backend | Hono (TypeScript) on Cloudflare Workers |
| Database | D1 (SQLite) + Drizzle ORM (typed schema, migrations) |
| Photos | R2, accessed only via authz-checked Worker proxy |
| Validation | Zod schemas in `shared/` — single source of truth for client and server |
| Auth | Google OAuth (OIDC, code + PKCE) implemented in the Worker; cookie sessions |

### Repo layout (npm workspaces)

```
pawary/
├── app/                    # React PWA (Vite)
│   └── src/
│       ├── routes/         # screen components (one dir per tab/screen)
│       ├── components/     # shared UI (ActivityCard, CategoryIcon, …)
│       ├── features/       # add-flow, quick-add, charts, care
│       ├── api/            # typed client + TanStack Query hooks
│       ├── i18n/           # typed message catalogs (en.ts, ja.ts)
│       └── pwa/
├── worker/                 # Hono API
│   └── src/
│       ├── routes/         # auth, pets, activities, photos, schedules, insights
│       ├── middleware/     # session, csrf, pet-access, audit, headers
│       ├── domain/         # anomaly rules, recurrence, insights SQL, export
│       ├── db/             # drizzle schema + migrations
│       └── lib/            # oauth, r2, crypto helpers
├── shared/                 # Zod schemas + TS types
├── wrangler.jsonc          # D1, R2, assets, rate-limit bindings
└── package.json
```

`npm run dev` runs Vite + `wrangler dev` together. Vite outputs `app/dist`, served by
the Worker's assets binding.

## 3. Screens & Navigation

Mobile shell: bottom bar with 4 tabs + center FAB; header carries the app name,
pet-avatar switcher chips (all views are scoped to the selected pet), and Settings.
Desktop: bottom bar becomes a left sidebar; wider multi-column layouts; Add becomes
a modal.

### Tabs

- **Home — Today dashboard**: anomaly banners (when flagged) → care items
  (overdue / due today) → "today so far" (activities logged by anyone, the light
  family-coordination view) → Quick Add preset buttons (one tap = logged now, undo
  toast).
- **Calendar**: segmented switcher Month / Week / 3-Day / Day.
  - Month: grid with per-day colored category dots (max ~4 + "+n"); tap day → bottom
    sheet with the day's list; horizontal swipe changes month.
  - Week / 3-Day / Day: one timeline component with different column counts; vertical
    time axis, activity cards positioned by time; horizontal swipe shifts the range.
- **➕ FAB**: bottom sheet with the 11-category grid → category form (time defaults to
  now; 2–3 category fields; memo; multi-photo attach). Long-press FAB → Quick Add
  presets directly.
- **Health**: period selector (4w / 3m / 1y) + the four analyzer charts + the care
  schedule list (manage, add, complete).
- **Log**: infinite reverse-chronological list, sticky day headers, category filter
  chips (multi-select), memo text search.

### Other screens

- **Activity detail**: full record, photo gallery, edit (pre-filled form), delete with
  confirm.
- **Settings** (via header): account (profile, logout), pets (add/edit/archive,
  daily targets), language (system/EN/JA), Quick Add preset management, data export,
  account deletion. Sharing management will live here later.

### Visual language

Warm & friendly: soft rounded shapes, warm palette, pet-avatar-forward, gentle
illustrated empty states. Implementation will use the frontend-design skill.

## 4. Data Model

D1 via Drizzle. IDs are ULIDs. Timestamps are epoch ms UTC; activities also store
`tz_offset_min` so views render in household time.

### Identity & access

```
users         id, google_sub (unique), email, display_name, avatar_url,
              locale ('system'|'en'|'ja'), created_at
sessions      id, token_hash (unique, SHA-256 of the cookie token), user_id,
              created_at, expires_at, last_seen_at
pets          id, name, species ('dog'|'cat'|'other'), breed?, sex?, birthday?,
              avatar_r2_key?, archived_at?, created_at
pet_members   pet_id, user_id, role ('owner'|'editor'|'viewer'), created_at
              PK(pet_id, user_id)
```

Creator gets an `owner` row automatically; every pet has ≥1 owner. All data access
resolves through `pet_members` even before the sharing UI exists. Roles:
owner = everything incl. pet deletion and member management; editor = log/edit
activities and schedules; viewer = read-only.

### Activity log

```
activities       id, pet_id, category, occurred_at, tz_offset_min, memo?,
                 details (JSON, per-category schema), created_by, updated_by?,
                 created_at, updated_at, deleted_at?   ← soft delete
activity_photos  id, activity_id, r2_key, width, height, content_type, created_at
quick_presets    id, pet_id, category, label, details (JSON), sort_order, created_at
```

### Categories and `details` payloads (Zod-validated in `shared/`)

```
food:        { name?, foodType: 'dry'|'wet'|'treat'|'supplement', amount?,
               unit: 'g'|'ml'|'pieces', leftoverPct? }
water:       { amountMl }
toilet:      { kind: 'pee'|'poop', condition: 'normal'|'soft'|'diarrhea'|'hard'|'bloody',
               colorNote? }
weight:      { kg }
exercise:    { kind: 'walk'|'play'|'other', durationMin?, distanceKm? }
symptom:     { name, severity: 'mild'|'moderate'|'severe' }
medication:  { name, dose?, doseUnit?, scheduleId? }
vet_visit:   { clinic?, reason?, diagnosis?, nextVisitDate? }
grooming:    { kind: 'bath'|'brush'|'nails'|'trim'|'other' }
vaccination: { vaccineName, nextDueDate? }
note:        {}        # memo + photos only
```

Every activity, regardless of category, has time, memo, and photos.

### Proactive care

```
care_schedules  id, pet_id, type ('medication'|'vaccination'|'vet_visit'|'deworming'|
                'grooming'|'custom'), name, category_link, details_template (JSON),
                recurrence_unit ('once'|'hour'|'day'|'week'|'month'), recurrence_n?,
                next_due_at, end_at?, active, created_at
pet_targets     pet_id (PK), food_g_per_day?, water_ml_per_day?
```

Completing a care item atomically inserts an activity from `details_template` and
advances `next_due_at` by the interval (deactivates if `once` or past `end_at`).
Example: "antibiotics 2×/day for 7 days" = unit `hour`, n=12, end_at=+7d.

### Audit & deletion

```
audit_log  id, pet_id, user_id, action ('create'|'update'|'delete'),
           entity ('activity'|'pet'|'schedule'|'preset'|'member'), entity_id,
           diff (JSON), created_at
```

Written by middleware on every mutation; no UI in v1. Account deletion: cascade
sessions and memberships; pets where the user is the sole owner are fully deleted
(activities, schedules, R2 photos); shared pets with other owners survive.

### Indexes

`activities(pet_id, occurred_at)`, `activities(pet_id, category, occurred_at)`,
`care_schedules(pet_id, active, next_due_at)`, `sessions(token_hash)`.

## 5. API Surface

REST JSON under `/api`; responses `{ data }` or `{ error: { code, message } }`.
Middleware chain past auth: session → CSRF (mutations) → pet-access (role check).
Membership failure returns 404 (not 403) so pet IDs can't be probed. Cursor pagination
on all growing lists. Rate limits per-IP on `/api/auth/*`, per-user on uploads and
account deletion.

```
# Auth / account
GET    /api/auth/google                  redirect (state + PKCE)
GET    /api/auth/google/callback         verify, upsert user, set session cookie
POST   /api/auth/logout
POST   /api/auth/dev-login               localhost dev-config only
GET    /api/me                           user + pets w/ roles + CSRF token
PATCH  /api/me                           locale, display name
DELETE /api/me                           account deletion (confirm token)
GET    /api/me/export                    full JSON export

# Pets
POST   /api/pets                         creator becomes owner
GET    /api/pets/:petId
PATCH  /api/pets/:petId                  owner/editor
DELETE /api/pets/:petId                  owner; cascades + R2 cleanup
PUT    /api/pets/:petId/targets          owner/editor
GET    /api/pets/:petId/export?format=json|csv

# Activities (serves calendar, timeline, and log)
GET    /api/pets/:petId/activities?from&to&category[]&q&cursor&limit
POST   /api/pets/:petId/activities       editor+; Zod-validated details
GET    /api/pets/:petId/activities/:id
PATCH  /api/pets/:petId/activities/:id   editor+
DELETE /api/pets/:petId/activities/:id   editor+; soft delete
GET    /api/pets/:petId/summary?month=   per-day category counts for month dots

# Photos (R2 via Worker only)
POST   /api/pets/:petId/photos           multipart; magic-byte sniff; EXIF/GPS
                                         stripped via re-encode; 10 MB cap
GET    /api/photos/:photoId?size=thumb|full   authz check, streams from R2
                                         (orphans cleaned by daily cron trigger)

# Care & presets
GET/POST              /api/pets/:petId/schedules
PATCH/DELETE          /api/pets/:petId/schedules/:id
POST                  /api/pets/:petId/schedules/:id/complete   atomic
GET                   /api/pets/:petId/care-status   overdue / today / upcoming-7d
GET/POST/PATCH/DELETE /api/pets/:petId/presets

# Analyzer
GET    /api/pets/:petId/insights?period=4w|3m|1y
       one call: all 4 chart datasets + active anomaly flags (SQL bucketing)
```

## 6. Auth & Security

- **OAuth**: Authorization Code + PKCE in the Worker; `state` + verifier in a 10-min
  HttpOnly cookie; ID token validated against cached Google JWKS (`iss`, `aud`, `exp`).
- **Sessions**: 256-bit random token; SHA-256 hash stored in D1; cookie
  `__Host-session=…; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=30d`;
  sliding expiry, absolute cap 90 days; revoked server-side on logout/deletion.
- **CSRF**: SameSite=Lax + per-session token (from `GET /api/me`) required as
  `X-CSRF-Token` on mutations, constant-time compare.
- **Authorization**: one middleware resolves `(user, petId) → role`; handlers declare
  minimum role (viewer = GET, editor = writes, owner = destructive/member ops).
- **Input safety**: Zod everywhere (unknown keys rejected, lengths capped); Drizzle
  parameterized queries only; React default escaping, no `dangerouslySetInnerHTML`.
- **Headers**: CSP `default-src 'self'` (no inline script), nosniff, DENY framing,
  strict referrer, HSTS in production.
- **Photos**: magic-byte validation, EXIF/GPS stripped, served only via the proxy
  route with private cache headers.
- **Dev bypass**: `dev-login` route registered only when dev environment config AND
  localhost host; integration test asserts 404 under production config.
- **Secrets**: `wrangler secret` / git-ignored `.dev.vars`; nothing sensitive bundled
  client-side.

## 7. Health Analyzer & Anomalies

Computed server-side in `/insights` (bucket = day for 4w/3m, week for 1y) in household
time. Recharts on the client; sparse data shows gaps, never fake zeros.

1. **Weight**: scatter + line, 7-point moving average trend, min/max band, % change
   annotation. Headline chart.
2. **Intake vs targets**: daily food g and water ml bars with dashed target reference
   lines; "not logged" (hollow) is visually distinct from "logged 0".
3. **Toilet patterns**: day-rows × (pee | poop) matrix, cells colored by count and
   worst condition that day; abnormal streaks read as colored runs.
4. **Symptom & medication timeline**: horizontal spans per medication schedule and per
   symptom name on a shared axis; vet visits as point markers. Purpose: correlation
   at a glance.

### Anomaly rules (pure functions, unit-tested; severity info|warning)

| Rule | Trigger |
|---|---|
| Weight drift | latest 7-day avg ±5% vs 30 days ago (≥2 weighings) |
| Toilet trouble | diarrhea or bloody ≥2× within rolling 3 days |
| Quiet day | no food AND no water logged today by 18:00 household time |
| Symptom streak | same symptom name ≥3 consecutive days |

Flags are advisory, never diagnostic ("consider asking your vet"); deep-link to the
relevant chart; dismissible client-side (reappear only on new triggering data).

### Care status

`care-status` buckets: overdue (`next_due_at < now`), due today, upcoming 7 days.
Home shows overdue → today → upcoming; Health tab shows the full schedule list.

## 8. PWA, i18n, Offline

- **PWA**: vite-plugin-pwa manifest (`display: standalone`, icons, theme color);
  custom in-app iOS install hint (no prompt API on iOS Safari).
- **Offline**: app shell precached; API GETs stale-while-revalidate with a
  "showing cached data" indicator; photos cache-first. Writes require connectivity
  in v1 (offline mutation queue deferred — conflict resolution not worth it before
  sharing ships).
- **i18n**: typed message catalog (`en.ts`, `ja.ts` satisfying one `Messages`
  interface — missing key = compile error); `Intl` for dates/numbers; locale setting
  `system|en|ja` persisted on the user, defaults to device language. Categories,
  units, anomaly copy all flow through the catalog.

## 9. Testing

- **API integration** (Vitest + @cloudflare/vitest-pool-workers, real D1/R2 via
  Miniflare): auth flows incl. dev-login 404 in prod config; per-role authz on every
  route group; activity CRUD + validation rejection; schedule-complete atomicity;
  account-deletion cascade; export shape.
- **Unit**: anomaly rules, recurrence advancement, insights bucketing, per-category
  Zod accept/reject tables.
- **Frontend**: component tests for calendar grid math and timeline layout only;
  the rest verified by running the app. No E2E suite in v1.
- TDD for backend domain logic.

## 10. Decisions Log

| Decision | Choice | Why |
|---|---|---|
| iOS delivery | PWA | One codebase, installable, iOS push possible later |
| Platform | Cloudflare Workers + D1 + R2 | User's tooling, free-tier friendly |
| Health depth | Proactive care | Schedules, targets, anomaly flags — not just a journal |
| Reminders | In-app badges first | Push (PWA + cron) designed in, deferred |
| Routines | Light version | Quick Add presets + "today so far" instead of a routine entity |
| Recurrence | Simple intervals | once / every-N hour/day/week/month covers real cases |
| Anomalies | Fixed heuristics | Tunable thresholds later if needed |
| Language | EN + JA day 1 | Retrofit is invasive |
| Look | Warm & friendly | Family pet journal feel |
| Deployment | Local only | User deploys when ready |
| Sharing | Schema now, UI later | `pet_members` from day 1 keeps it additive |
