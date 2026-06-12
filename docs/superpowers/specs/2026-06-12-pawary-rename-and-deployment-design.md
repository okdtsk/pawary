# Pawary Rename & Cloudflare Deployment — Design

**Date:** 2026-06-12
**Status:** Approved
**Scope:** Rename the application from "Pawlog" to "Pawary" (full depth, including docs), then deploy v1 to Cloudflare under the existing `pawary` resources.

## 1. Context

v1 is complete and merged to `main` (221 tests, typecheck clean) but exists only as a local dev setup. The Cloudflare account (`15e92cf7a2d85b77cd798213277382d2`, okdtsk@gmail.com) already holds an earlier `pawary` experiment, all effectively empty and explicitly approved for overwrite:

- Worker `pawary` (deployed 2026-06-10) with custom domain **pawary.okdtsk.dev** already attached
- D1 database `pawary` (`d37c2af2-a640-4d54-9533-3721a05143cd`), 0 tables
- R2 bucket `pawary-photos` (APAC), 0 objects

Deploying a Worker named `pawary` replaces the existing one and inherits the custom domain — no DNS work required.

## 2. Decisions (user-approved)

| Decision | Choice |
| --- | --- |
| App name | `pawary` / "Pawary" (overwrite existing Cloudflare resources) |
| Rename depth | Full, **including** dated spec/plan docs and their filenames |
| Production URL | `https://pawary.okdtsk.dev` (custom domain, already wired) |
| Google OAuth | User creates the OAuth client now; secrets entered by the user via `wrangler secret put` (never through chat) |
| Config strategy | **Approach A** — wrangler named environment `env.production`; top-level config stays development |
| Execution | Direct execution by the orchestrator (steps interleave with user-only actions), same spec/plan/commit conventions |

## 3. Rename (pawlog → pawary)

Case-aware replacement across the repo: `pawlog` → `pawary`, `Pawlog` → `Pawary`. Touched areas:

- **npm scope:** `@pawlog/shared` → `@pawary/shared` (3 `package.json` names + ~76 importing files); root package name `pawlog` → `pawary`; `package-lock.json` regenerated with `npm install`, not hand-edited
- **Wrangler:** worker `name`, D1 `database_name`, R2 `bucket_name` in `worker/wrangler.jsonc`; `db:migrate:local` script target
- **User-visible branding:** i18n strings (`en.ts`, `ja.ts`), PWA manifest name/short_name, `app/index.html` title, install hint copy if present
- **Docs:** `README.md`, `CLAUDE.md` (where present), all files under `docs/superpowers/` — contents rewritten and files containing `pawlog` in their names renamed via `git mv`. **Exception:** this spec and the deployment plan derived from it are excluded from the mechanical replace — they intentionally document both names
- **Memory/meta:** none in-repo beyond the above

Consequences accepted:

- Local D1 state resets (keyed by database name) — rerun `npm run db:migrate:local -w worker`; local data is throwaway
- The repo directory `~/ghq/github.com/okdtsk/pawlog` is the user's to rename outside this work; nothing in the build depends on it

Verification after rename: full suite (204 worker + 17 app tests), typecheck across 3 workspaces, app build. One commit: `refactor: rename pawlog to pawary`.

## 4. Production configuration (Approach A)

Add to `worker/wrangler.jsonc` (top-level untouched so dev and the 204 tests that inherit `ENVIRONMENT: "development"` keep working):

```jsonc
"env": {
  "production": {
    "name": "pawary",
    "vars": { "ENVIRONMENT": "production" },
    "d1_databases": [{
      "binding": "DB",
      "database_name": "pawary",
      "database_id": "d37c2af2-a640-4d54-9533-3721a05143cd",
      "migrations_dir": "drizzle"
    }],
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

Bindings are re-specified deliberately: wrangler does not inherit binding keys into named environments. Inheritable keys (`main`, `compatibility_date`, `compatibility_flags`) stay top-level. `compatibility_date` remains `2025-09-06` (cap imposed by installed workerd; valid for production).

One commit: `feat: add production wrangler environment for deployment`.

## 5. Google OAuth & secrets

Production disables dev-login (`ENVIRONMENT !== "development"` guard), so real credentials are required for sign-in.

User creates an OAuth 2.0 Client ID (type: Web application) in Google Cloud Console with:

- Authorized JavaScript origin: `https://pawary.okdtsk.dev`
- Authorized redirect URI: `https://pawary.okdtsk.dev/api/auth/google/callback`

User then sets both secrets from `worker/` (values never pass through chat):

```
npx wrangler secret put GOOGLE_CLIENT_ID --env production
npx wrangler secret put GOOGLE_CLIENT_SECRET --env production
```

Note: `wrangler secret put` against a Worker creates/updates the secret on the deployed Worker; if the Worker has not been deployed yet under this config, secrets are uploaded on first deploy prompt or set immediately after the first deploy. Order in the plan: deploy first, then set secrets, then verify sign-in.

## 6. Migration & deploy

```
npx wrangler d1 migrations apply pawary --remote --env production   # applies 0000_init + 0001_add-fk-indexes
npm run build                                                       # builds app/dist (SW, manifest, icons)
npx wrangler deploy --env production                                # from worker/
```

## 7. Verification

- `https://pawary.okdtsk.dev/` serves the SPA shell with the security headers (CSP parity with `app/public/_headers`)
- `GET /api/me` returns 401 when unauthenticated
- Manifest + `sw.js` served with no-cache headers; PWA installable
- Google sign-in completes end-to-end (user clicks through; first real-account smoke test: create pet, add activity, upload photo)
- Sandbox cannot curl; remote verification uses the WebFetch tool and the user's browser

## 8. Out of scope (unchanged post-v1 backlog)

Sharing invite UI, AI Advisor, Web Push, offline mutation queue, CI/git remote, Cloudflare Images thumbnailing, swapping the in-memory rate limiter for a Cloudflare rate-limiting binding (shipped as-is: per-isolate best-effort, acceptable for personal use), audit log UI, tunable anomaly thresholds.

## 9. Risks & rollback

- **Overwrite risk:** the existing `pawary` Worker/D1/R2 are empty; replacement is intended and loses nothing
- **Rename risk:** mechanical scope creep — mitigated by case-aware replace + full test/typecheck/build gate before the deploy steps
- **Rollback:** Workers keep prior versions; `wrangler rollback --env production` (or the dashboard) restores the previous deployment. D1 migrations are additive-only here; no destructive rollback needed
