# Pawary Rename & Cloudflare Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the application from "Pawlog" to "Pawary" everywhere, then deploy v1 to Cloudflare at https://pawary.okdtsk.dev using the existing (empty) `pawary` Worker, D1 database, and R2 bucket.

**Architecture:** Mechanical case-aware rename gated by the full test/typecheck/build suite, then an additive `env.production` wrangler environment (Approach A — top-level config and the 204 tests that inherit `ENVIRONMENT: "development"` stay untouched), remote D1 migrations, and `wrangler deploy --env production`. Google OAuth credentials are created and entered by the user only.

**Tech Stack:** wrangler 4 (named environments, D1 migrations, R2), npm workspaces, existing vitest suites as the regression gate.

**Spec:** `docs/superpowers/specs/2026-06-12-pawary-rename-and-deployment-design.md`

**Execution note (user-approved in spec §2):** executed inline by the orchestrator, because Tasks 4–5 interleave with user-only actions (Google Cloud Console, secret entry). This plan file and the spec are EXCLUDED from the rename replace — they intentionally document both names.

---

### Task 1: Rename pawlog → pawary across the repo

**Files:**
- Modify: every tracked file containing `pawlog`/`Pawlog` EXCEPT `package-lock.json`, `docs/superpowers/specs/2026-06-12-pawary-rename-and-deployment-design.md`, and `docs/superpowers/plans/2026-06-12-06-pawary-rename-and-deploy.md`
- Rename: `docs/superpowers/specs/2026-06-11-pawlog-design.md` → `docs/superpowers/specs/2026-06-11-pawary-design.md`
- Regenerate: `package-lock.json` (via `npm install`, never hand-edited)

- [ ] **Step 1: Case-aware replace in tracked file contents (with exclusions)**

```fish
git grep -lI pawlog -i -- ':!package-lock.json' ':!docs/superpowers/specs/2026-06-12-pawary-rename-and-deployment-design.md' ':!docs/superpowers/plans/2026-06-12-06-pawary-rename-and-deploy.md' | xargs perl -pi -e 's/pawlog/pawary/g; s/Pawlog/Pawary/g; s/PAWLOG/PAWARY/g'
```

- [ ] **Step 2: Rename the v1 design spec file**

```fish
git mv docs/superpowers/specs/2026-06-11-pawlog-design.md docs/superpowers/specs/2026-06-11-pawary-design.md
```

- [ ] **Step 3: Verify zero remaining occurrences outside the exclusions**

```fish
git grep -lI pawlog -i -- ':!package-lock.json' ':!docs/superpowers/specs/2026-06-12-pawary-rename-and-deployment-design.md' ':!docs/superpowers/plans/2026-06-12-06-pawary-rename-and-deploy.md'
```

Expected: no output (exit code 1).

- [ ] **Step 4: Regenerate the lockfile for the renamed workspaces**

Run from repo root: `npm install`
Expected: lockfile updated; `grep -c pawlog package-lock.json` returns 0.

- [ ] **Step 5: Re-apply local D1 migrations (database_name changed, local state resets)**

Run: `npm run db:migrate:local -w worker`
Expected: migrations `0000_init` and `0001_add-fk-indexes` applied to the fresh local `pawary` database.

- [ ] **Step 6: Full regression gate**

Run: `npm run typecheck && npm test`
Expected: typecheck clean in shared/worker/app; app build succeeds; 204 worker tests + 17 app tests pass.

- [ ] **Step 7: Spot-check user-visible branding**

```fish
grep -rn "Pawary" app/src/i18n/en.ts app/src/i18n/ja.ts app/index.html app/vite.config.ts | head
```

Expected: app title, manifest `name`/`short_name`, and i18n strings all read "Pawary"; no stray "Pawlog".

- [ ] **Step 8: Commit**

```fish
git add -A
git commit -m "refactor: rename pawlog to pawary"
```

---

### Task 2: Add the production wrangler environment

**Files:**
- Modify: `worker/wrangler.jsonc`

- [ ] **Step 1: Add `env.production` after the existing `assets` key**

The file already has top-level `name: "pawary"`, dev D1 placeholder, and dev vars from Task 1. Append this top-level key (bindings re-specified deliberately — wrangler does not inherit binding keys into named environments; `main`, `compatibility_date`, `compatibility_flags` ARE inherited and stay top-level only):

```jsonc
"env": {
  "production": {
    "name": "pawary",
    "vars": { "ENVIRONMENT": "production" },
    "d1_databases": [
      {
        "binding": "DB",
        "database_name": "pawary",
        "database_id": "d37c2af2-a640-4d54-9533-3721a05143cd",
        "migrations_dir": "drizzle"
      }
    ],
    "r2_buckets": [{ "binding": "PHOTOS", "bucket_name": "pawary-photos" }],
    "observability": { "enabled": true },
    "assets": {
      "directory": "../app/dist",
      "not_found_handling": "single-page-application",
      "run_worker_first": ["/api/*"]
    }
  }
}
```

- [ ] **Step 2: Validate config parses and tests still pass (tests read wrangler.jsonc)**

Run: `npx wrangler deploy --env production --dry-run` (from `worker/`)
Expected: dry-run succeeds, reports Worker name `pawary`, D1 + R2 + assets bindings. (`../app/dist` must exist from Task 1's `npm test` build.)

Run: `npm run test -w worker`
Expected: 204 tests pass (top-level config unchanged, so vitest-pool-workers is unaffected).

- [ ] **Step 3: Commit**

```fish
git add worker/wrangler.jsonc
git commit -m "feat: add production wrangler environment for deployment"
```

---

### Task 3: Apply D1 migrations to the remote production database

- [ ] **Step 1: List pending remote migrations**

Run from `worker/`: `npx wrangler d1 migrations list pawary --remote --env production`
Expected: `0000_init` and `0001_add-fk-indexes` listed as unapplied.

- [ ] **Step 2: Apply migrations remotely**

Run: `npx wrangler d1 migrations apply pawary --remote --env production`
Expected: both migrations applied successfully (the remote `pawary` database has 0 tables, so nothing can conflict).

- [ ] **Step 3: Verify schema**

Run: `npx wrangler d1 execute pawary --remote --env production --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"`
Expected: the 10 app tables (activities, activity_photos, audit_log, care_schedules, pet_members, pet_targets, pets, quick_presets, sessions, users) plus `d1_migrations`.

---

### Task 4: Build and deploy the Worker

- [ ] **Step 1: Fresh production build of the app**

Run from repo root: `npm run build`
Expected: `app/dist/` contains `index.html`, hashed assets, `sw.js`, `manifest.webmanifest`, icons, `_headers`.

- [ ] **Step 2: Deploy**

Run from `worker/`: `npx wrangler deploy --env production`
Expected: uploads static assets + Worker, replaces the existing `pawary` Worker, reports the custom domain `pawary.okdtsk.dev` (already attached) and/or workers.dev route.

- [ ] **Step 3: Verify the site is up (auth not yet functional — secrets pending)**

Fetch `https://pawary.okdtsk.dev/` (WebFetch, or `curl -sI` with sandbox override if permitted): expect 200 HTML (SPA shell). Fetch `https://pawary.okdtsk.dev/api/me`: expect 401 JSON.

---

### Task 5: Google OAuth client + secrets (USER ACTIONS)

- [ ] **Step 1: User creates the OAuth client in Google Cloud Console**

Console → APIs & Services → Credentials → Create Credentials → OAuth client ID → type **Web application**:
- Authorized JavaScript origin: `https://pawary.okdtsk.dev`
- Authorized redirect URI: `https://pawary.okdtsk.dev/api/auth/google/callback`

(If the consent screen is not yet configured: External, app name "Pawary", add okdtsk@gmail.com as test user — Testing status is sufficient for personal use.)

- [ ] **Step 2: User sets both secrets (values never pass through chat)**

In a separate terminal, from `worker/`:

```fish
npx wrangler secret put GOOGLE_CLIENT_ID --env production
npx wrangler secret put GOOGLE_CLIENT_SECRET --env production
```

Each prompts interactively for the value. Run AFTER Task 4 so the Worker exists; each `secret put` creates a new Worker version with the secret attached.

- [ ] **Step 3: Confirm secrets are registered**

Run: `npx wrangler secret list --env production`
Expected: both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` listed (values hidden).

---

### Task 6: End-to-end verification + docs

- [ ] **Step 1: Security headers parity check**

`curl -sI https://pawary.okdtsk.dev/` (sandbox override) — expect the CSP and security headers matching `app/public/_headers`; `sw.js` and `manifest.webmanifest` served with no-cache.

- [ ] **Step 2: User smoke test in browser**

Sign in with Google at https://pawary.okdtsk.dev → create a pet → add an activity with a photo → check Health tab renders → install PWA prompt available. User reports results.

- [ ] **Step 3: Add Deployment section to README**

Append to `README.md` (after the Development section):

````markdown
## Deployment

Production runs on Cloudflare Workers at https://pawary.okdtsk.dev (Worker `pawary`, D1 `pawary`, R2 `pawary-photos`), configured via the `production` wrangler environment.

```sh
npm run build                                                  # build the app bundle
npx wrangler d1 migrations apply pawary --remote --env production   # apply pending migrations (from worker/)
npx wrangler deploy --env production                           # deploy worker + assets (from worker/)
```

Secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) are managed with `wrangler secret put <NAME> --env production`. Rollback: `npx wrangler rollback --env production`.
````

- [ ] **Step 4: Final commit**

```fish
git add README.md
git commit -m "docs: add deployment instructions"
```
