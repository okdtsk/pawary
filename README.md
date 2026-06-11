# Pawlog

Pet activity log & health management. Mobile-first PWA on Cloudflare Workers.

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
npm test          # builds the app, then runs worker tests (vitest + miniflare)
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

## Docs

- Spec: `docs/superpowers/specs/2026-06-11-pawlog-design.md`
- Plans: `docs/superpowers/plans/`
