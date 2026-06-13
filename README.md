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

## Deployment

Production runs on Cloudflare Workers at https://pawary.okdtsk.dev (Worker `pawary`, D1 `pawary`, R2 `pawary-photos`), configured via the `production` wrangler environment.

```sh
npm run build                                                       # build the app bundle
npx wrangler d1 migrations apply pawary --remote --env production   # apply pending migrations (from worker/)
npx wrangler deploy --env production                                # deploy worker + assets (from worker/)
```

Secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) are managed with `wrangler secret put <NAME> --env production`. The AI Advisor additionally requires `ADVISOR_KEK` (32-byte base64, e.g. `openssl rand -base64 32`): `npx wrangler secret put ADVISOR_KEK --env production`; local dev reads it from `worker/.dev.vars`. Rollback: `npx wrangler rollback --env production`.

Web Push requires a VAPID keypair (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, base64url). Generate once and store both as secrets:

```sh
node -e 'crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]).then(async k=>{const pub=Buffer.from(await crypto.subtle.exportKey("raw",k.publicKey)).toString("base64url");const jwk=await crypto.subtle.exportKey("jwk",k.privateKey);console.log("VAPID_PUBLIC_KEY="+pub);console.log("VAPID_PRIVATE_KEY="+jwk.d)})'
npx wrangler secret put VAPID_PUBLIC_KEY --env production   # paste the public value
npx wrangler secret put VAPID_PRIVATE_KEY --env production  # paste the private value
```

### Preview environment

A shared, production-faithful preview env (Worker `pawary-preview`, D1 `pawary-preview`,
R2 `pawary-photos-preview`) at `https://pawary-preview.okdtsk.workers.dev`, configured via
the `preview` wrangler environment. Use it to verify a branch before merging to `main`;
it never touches production data.

Deploy a branch: GitHub → Actions → **Preview** → **Run workflow** → pick the branch.
The run tests, builds, applies pending D1 migrations to `pawary-preview`, and deploys.
Latest deploy wins (it is a single shared env).

One-time setup: create the D1 (`wrangler d1 create pawary-preview`) and R2
(`wrangler r2 bucket create pawary-photos-preview`); set secrets with
`wrangler secret put <NAME> --env preview` (reuse prod `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`;
generate fresh `ADVISOR_KEK` and a new VAPID keypair); add the preview callback
`https://pawary-preview.okdtsk.workers.dev/api/auth/google/callback` to the Google OAuth
client; create a non-branch-restricted `preview` GitHub environment holding
`CLOUDFLARE_API_TOKEN`. Reset preview data anytime with
`wrangler d1 execute pawary-preview --remote --env preview --command "<sql>"`.

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
