# Preview Environment — Design

Date: 2026-06-13

## Goal

Deploy any feature branch to a shared, production-faithful **preview** environment on
demand, to verify a new version behaves correctly before it reaches `main`/production —
with zero risk to production data. Speeds up the develop-and-test cycle.

## Decisions (settled during brainstorming)

- **Model:** one shared preview env, latest deploy wins (not per-branch ephemeral envs).
- **Trigger:** manual `workflow_dispatch` — pick any branch in the GitHub Actions UI.
- **URL:** free `workers.dev` URL (`pawary-preview.<acct>.workers.dev`); no custom DNS.
- **Auth:** real Google sign-in, reusing the production OAuth client (whitelist the
  preview callback URL). Dev sign-in stays disabled on preview.
- **Name:** `preview` (env name, `ENVIRONMENT` value, worker `pawary-preview`).
- **Crons:** enabled on preview (same `*/15 * * * *`) so scheduled behavior is testable.
- **Data:** fully isolated — own D1 and R2. Starts empty; create test data by hand.

## Background — relevant current behavior

The worker branches on `ENVIRONMENT === "production"` in three security-sensitive spots:

- `worker/src/lib/cookies.ts` — session cookie name (`__Host-session` vs `session`) and
  the `Secure` flag are production-only (3 occurrences).
- `worker/src/routes/auth.ts:38` — OAuth state cookie `Secure` flag, production-only.
- `worker/src/middleware/headers.ts:14` — security headers (HSTS etc.) production-only.

The dev sign-in path is gated to `ENVIRONMENT === "development"` + localhost
(`auth.ts:108-110`). The OAuth redirect URI is derived from the request origin
(`auth.ts:30`: `${url.origin}/api/auth/google/callback`), so no code change is needed to
support a new origin — only OAuth-console whitelisting.

If preview ran with a distinct `ENVIRONMENT` value and the checks stayed `=== "production"`,
preview would get insecure, differently-named cookies and no security headers. A
cookie/security bug could then pass on preview and break in production — defeating the
purpose. So preview must behave like production for security while remaining identifiable.

## Components

### 1. Code: `ENVIRONMENT` becomes a three-value union

- `worker/src/env.ts`: type → `"development" | "preview" | "production"`.
- Change the three security checks from `=== "production"` to `!== "development"`:
  - `worker/src/lib/cookies.ts` — cookie name selector and both `secure` flags.
  - `worker/src/routes/auth.ts:38` — state cookie `secure` flag.
  - `worker/src/middleware/headers.ts:14` — security headers gate.
- The dev-sign-in gate (`auth.ts:110`) already uses `!== "development"`, so it correctly
  stays disabled on preview — no change there.

Net effect: preview is identical to production behavior except for its name and data.

### 2. `worker/wrangler.jsonc`: add `env.preview`

Mirror `env.production`, with these differences:

- `name: "pawary-preview"`
- `workers_dev: true` (provides `pawary-preview.<acct>.workers.dev`)
- `preview_urls: false`
- `vars`: `{ "ENVIRONMENT": "preview" }`
- `d1_databases`: `database_name: "pawary-preview"`, `database_id: <new id>`,
  `migrations_dir: "drizzle"`
- `r2_buckets`: `bucket_name: "pawary-photos-preview"` (binding `PHOTOS`)
- `triggers.crons`: `["*/15 * * * *"]`
- `ratelimits`, `observability`, `assets`: same as production (rate-limit counters are
  isolated per worker name, so reusing the same `namespace_id`s is safe).

### 3. One-time Cloudflare setup (manual; documented in README)

```sh
# from worker/
npx wrangler d1 create pawary-preview          # paste the returned id into env.preview
npx wrangler r2 bucket create pawary-photos-preview

# secrets — reuse prod values for the OAuth client:
npx wrangler secret put GOOGLE_CLIENT_ID     --env preview   # same as production
npx wrangler secret put GOOGLE_CLIENT_SECRET --env preview   # same as production
# fresh values (per-database data must not be shared with production):
npx wrangler secret put ADVISOR_KEK          --env preview   # openssl rand -base64 32
npx wrangler secret put VAPID_PUBLIC_KEY     --env preview   # new VAPID keypair
npx wrangler secret put VAPID_PRIVATE_KEY    --env preview
```

`ADVISOR_KEK` (encrypts BYO API keys) and the VAPID keypair (push subscriptions) are
per-database, so preview generates its own; sharing prod's would cross-contaminate.

### 4. Google OAuth

Add one authorized redirect URI to the **existing production** OAuth client:

```
https://pawary-preview.<acct>.workers.dev/api/auth/google/callback
```

No code change (redirect URI derives from request origin).

### 5. CI: `.github/workflows/preview.yml`

```yaml
name: Preview

on:
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: preview            # new GitHub environment, NOT branch-restricted
    concurrency:
      group: deploy-preview
      cancel-in-progress: true       # latest deploy wins
    steps:
      - uses: actions/checkout@<pinned-sha>
      - uses: actions/setup-node@<pinned-sha>
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - name: Apply pending D1 migrations
        working-directory: worker
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: 15e92cf7a2d85b77cd798213277382d2
        run: npx wrangler d1 migrations apply pawary-preview --remote --env preview
      - name: Deploy worker
        working-directory: worker
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: 15e92cf7a2d85b77cd798213277382d2
        run: npx wrangler deploy --env preview
```

- Pin action SHAs to match `ci.yml`.
- As in `ci.yml`, the API token is present only on the migrate/deploy steps, never during
  `npm ci`/build (so install scripts can't read deploy credentials).
- A **new `preview` GitHub environment** holds `CLOUDFLARE_API_TOKEN`. It is **not**
  branch-restricted, so any feature branch can deploy. The existing `production`
  environment stays main-only and is untouched. The token must have D1, R2, and Workers
  Scripts edit permissions for the account.

### 6. Data lifecycle

Preview DB starts empty; the workflow applies migrations every run (idempotent). No seed
data — sign in with Google and create test records. Reset when needed, e.g.:

```sh
npx wrangler d1 execute pawary-preview --remote --env preview --command "<sql>"
```

### 7. Docs

Add a "Preview environment" section to `README.md` covering the one-time setup (§3, §4)
and the deploy button (Actions → Preview → Run workflow → pick branch).

## Out of scope

- Per-branch ephemeral environments.
- Custom domain for preview.
- Automatic seeding of preview data.
- Automatic teardown/reset of preview data.

## Testing / verification

- `npm run typecheck` and `npm test` pass with the widened `ENVIRONMENT` union.
- After first deploy: preview loads at the workers.dev URL; Google sign-in completes;
  response carries the `__Host-session` cookie and security headers (confirming preview
  runs with production-grade security, per §1).
- A cron-driven action fires against preview data only; production D1/R2 unchanged.
```
