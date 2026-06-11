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

## Docs

- Spec: `docs/superpowers/specs/2026-06-11-pawlog-design.md`
- Plans: `docs/superpowers/plans/`
