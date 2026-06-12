# Pawary

Pet activity log & health management. Mobile-first PWA on Cloudflare Workers.

## Features (v1)

- Google OAuth sign-in (+ localhost-only dev login)
- Multi-pet households with editor/viewer roles (sharing UI is post-v1)
- Activity logging: 11 categories, photos (R2), Quick Add presets, full CRUD
- Views: Home dashboard, Month / Week / 3-Day / Day calendar, filterable log
- Care schedules with recurrence, due badges, one-tap complete + undo
- Health Analyzer: weight / intake / toilet / care-timeline charts + advisory anomaly flags
- English + Japanese, device-locale default, per-user override
- Data export (JSON/CSV), self-service account deletion, audit log
- Installable PWA with offline read cache (writes require connectivity)

## Stack

React 19 + Vite + Tailwind (PWA) · Hono on Cloudflare Workers · D1 + Drizzle · R2

## Development

```bash
npm install
npm run db:migrate:local -w worker   # once, and after schema changes
npm run dev                           # worker on :8787, app on :5173
```

Open http://localhost:5173 and use **Dev sign-in (local)**, or configure real
Google OAuth via `worker/.dev.vars` (see `worker/.dev.vars.example`).

## Testing

```bash
npm test          # builds the app, runs worker tests (vitest + miniflare), then app unit tests
npm run typecheck
```

## API

REST JSON under `/api`; responses are `{ data }` or `{ error: { code, message } }`.
Sessions via cookie; mutations require the `X-CSRF-Token` from `GET /api/me`.
Pet routes resolve roles through `pet_members` (viewer < editor < owner);
non-members get 404.

- Auth/account: `GET /api/auth/google`, `POST /api/auth/logout`,
  `GET|PATCH|DELETE /api/me`, `GET /api/me/export`
- Pets: `POST /api/pets`, `GET|PATCH|DELETE /api/pets/:petId`,
  `PUT /api/pets/:petId/targets`, `GET /api/pets/:petId/export?format=json|csv`,
  `POST|GET /api/pets/:petId/avatar`
- Activities: `GET|POST /api/pets/:petId/activities`,
  `GET|PATCH|DELETE /api/pets/:petId/activities/:id`,
  `GET /api/pets/:petId/summary?month=YYYY-MM`
- Photos: `POST /api/pets/:petId/activities/:id/photos`,
  `GET|DELETE /api/photos/:photoId`
- Presets: `GET|POST /api/pets/:petId/presets`,
  `PATCH|DELETE /api/pets/:petId/presets/:id`

## Frontend

Mobile-first React SPA (`app/`): bottom tab bar (Home / Calendar / Log / Health)
with a center paw FAB; desktop gets a sidebar. All views are scoped to the pet
selected in the header switcher. Warm design system in `app/src/index.css`
(Tailwind 4 tokens) + `app/src/components/`; typed EN/JA catalogs in
`app/src/i18n/` (missing keys fail `typecheck`). Date/grid math in
`app/src/lib/dates.ts` and timeline lanes in `app/src/lib/timeline.ts` are
unit-tested (`npm run test -w app`). Health charts and care schedules land in
Plan 4; PWA polish in Plan 5.

## Care & Analyzer

Care schedules (`care_schedules`) drive proactive reminders: each schedule
links an activity category to a details template; completing one atomically
logs the activity and advances `next_due_at` by its interval (anchored to the
previous due time; `once` and past-`end_at` schedules deactivate).
`GET /api/pets/:petId/care-status?tz=` buckets active schedules into
overdue / today / upcoming-7d for the Home card and the Health tab.

The Health Analyzer (`GET /api/pets/:petId/insights?period=4w|3m|1y&tz=`)
returns four chart datasets in one call — weight trend (7-point average,
min/max band, % change), food/water vs daily targets, a toilet-pattern
matrix, and a symptom/medication timeline with vet-visit markers — bucketed
by household day (ISO week for 1y), plus structured anomaly flags (weight
drift, toilet trouble, quiet day, symptom streak; advisory, never
diagnostic). A lightweight `GET /api/pets/:petId/anomalies?tz=` powers the
Home banners. Charts are hand-rolled SVG in `app/src/features/health/`;
anomaly copy is rendered client-side from the typed EN/JA catalogs.

## PWA & Offline

`vite-plugin-pwa` (Workbox `generateSW`) precaches the app shell and adds
runtime caching: same-origin API GETs are network-first with a 3-second
timeout falling back to cache, `/api/photos/**` is cache-first
(30 days / 200 entries), and `/api/auth/**` is never cached. Writes require
connectivity in v1 — the API client fails fast with a localized offline
error, and an "offline — showing saved data" banner appears in the shell.
Updates use `registerType: "prompt"`: a "new version — reload" toast applies
the waiting service worker.

App icons are generated from `app/public/icons/paw.svg` via `npm run icons`
(one-off `sharp` script; the PNGs are committed). `app/public/_headers`
serves `sw.js` and `manifest.webmanifest` with `Cache-Control: no-cache` so
new versions are picked up promptly.

Install: Chrome/Edge offer the install prompt automatically; on iOS use
Safari → Share → **Add to Home Screen** (an in-app hint card on Home walks
you through it). To exercise the service worker locally, serve the built
app through the worker: `npm run build -w app && npm run dev -w worker`,
then open http://localhost:8787 (the Vite dev server does not register it).

## Docs

- Spec: `docs/superpowers/specs/2026-06-11-pawary-design.md`
- Plans: `docs/superpowers/plans/`
