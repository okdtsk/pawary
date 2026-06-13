# Preview Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared, production-faithful `preview` environment that any feature branch can deploy to on demand, fully isolated from production data.

**Architecture:** A new wrangler `env.preview` (own worker name, D1, R2, secrets) plus a `workflow_dispatch` GitHub Actions workflow. A small code change widens `ENVIRONMENT` to a three-value union and makes every non-`development` env run with production-grade security (secure `__Host-session` cookies, HSTS), so preview faithfully mirrors production.

**Tech Stack:** Cloudflare Workers, wrangler 4, D1, R2, Hono, GitHub Actions, vitest (`@cloudflare/vitest-pool-workers`).

**Spec:** `docs/superpowers/specs/2026-06-13-preview-environment-design.md`

---

## File Structure

- `worker/src/lib/environment.ts` — **new.** Single source of truth for the "is this a production-like (secure) environment?" predicate. Shared by cookies, auth, and headers.
- `worker/src/env.ts` — **modify.** Widen the `ENVIRONMENT` union to include `"preview"`.
- `worker/src/lib/cookies.ts` — **modify.** Use the predicate for cookie name + `Secure` flag.
- `worker/src/routes/auth.ts` — **modify.** Use the predicate for the OAuth state cookie `Secure` flag.
- `worker/src/middleware/headers.ts` — **modify.** Use the predicate for the HSTS header.
- `worker/test/environment.test.ts` — **new.** Unit test for the predicate.
- `worker/wrangler.jsonc` — **modify.** Add the `env.preview` block.
- `.github/workflows/preview.yml` — **new.** Manual deploy workflow.
- `README.md` — **modify.** Document the preview env.

> **wrangler.jsonc constraint:** `worker/vitest.config.ts` parses `wrangler.jsonc` with `JSON.parse` after stripping only **full-line** `//` comments. The `env.preview` block MUST be strict JSON — no inline/trailing comments, no trailing commas — or the whole test suite fails to load.

---

## Task 1: Production-like environment predicate + widen `ENVIRONMENT`

Make every non-`development` environment (`preview` and `production`) run with secure cookies and HSTS, via one shared predicate. This is the only code change; everything else is config.

**Files:**
- Create: `worker/src/lib/environment.ts`
- Create: `worker/test/environment.test.ts`
- Modify: `worker/src/env.ts:12`
- Modify: `worker/src/lib/cookies.ts:8-9,19,33`
- Modify: `worker/src/middleware/headers.ts:14`
- Modify: `worker/src/routes/auth.ts:38`

- [ ] **Step 1: Write the failing test**

Create `worker/test/environment.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isProdLike } from "../src/lib/environment";

describe("isProdLike", () => {
  it("is false in development (insecure local cookies, no HSTS)", () => {
    expect(isProdLike({ ENVIRONMENT: "development" })).toBe(false);
  });

  it("is true in preview (production-grade security)", () => {
    expect(isProdLike({ ENVIRONMENT: "preview" })).toBe(true);
  });

  it("is true in production", () => {
    expect(isProdLike({ ENVIRONMENT: "production" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w worker -- environment`
Expected: FAIL — cannot resolve `../src/lib/environment` (module does not exist).

- [ ] **Step 3: Create the predicate**

Create `worker/src/lib/environment.ts`:

```ts
import type { Env } from "../env";

/**
 * True for any deployed environment (preview, production) — i.e. served over
 * HTTPS where cookies must be Secure/__Host-prefixed and HSTS applies. False
 * only for local `development`. Use this instead of comparing ENVIRONMENT to a
 * single literal, so preview never silently drops production security.
 */
export function isProdLike(env: Pick<Env, "ENVIRONMENT">): boolean {
  return env.ENVIRONMENT !== "development";
}
```

- [ ] **Step 4: Widen the `ENVIRONMENT` union**

In `worker/src/env.ts`, change line 12:

```ts
  ENVIRONMENT: "development" | "preview" | "production";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w worker -- environment`
Expected: PASS — all three cases.

- [ ] **Step 6: Route the three security checks through the predicate**

In `worker/src/lib/cookies.ts`, add the import and replace the three `ENVIRONMENT === "production"` comparisons:

```ts
import { isProdLike } from "./environment";
```

```ts
export function sessionCookieName(env: Env): string {
  return isProdLike(env) ? "__Host-session" : "session";
}
```

In `setSessionCookie`, the `secure` line:

```ts
    secure: isProdLike(c.env),
```

In `clearSessionCookie`, the `secure` line:

```ts
    secure: isProdLike(c.env),
```

In `worker/src/middleware/headers.ts`, add the import and replace the guard:

```ts
import { isProdLike } from "../lib/environment";
```

```ts
    if (isProdLike(c.env)) {
      c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
```

In `worker/src/routes/auth.ts`, add the import (next to the other lib imports) and replace the state-cookie `secure` flag (line 38):

```ts
import { isProdLike } from "../lib/environment";
```

```ts
    secure: isProdLike(c.env),
```

- [ ] **Step 7: Verify nothing else still pins to `"production"` for security**

Run: `grep -rn 'ENVIRONMENT === "production"' worker/src`
Expected: no output (all three sites now use `isProdLike`). The dev-sign-in gate in `auth.ts:110` uses `!== "development"` and is intentionally left as-is.

- [ ] **Step 8: Run typecheck and the full worker test suite**

Run: `npm run typecheck -w worker && npm test -w worker`
Expected: PASS. (Existing tests run with top-level `ENVIRONMENT: "development"`, so cookie/header behavior is unchanged for them.)

- [ ] **Step 9: Commit**

```bash
git add worker/src/lib/environment.ts worker/test/environment.test.ts worker/src/env.ts worker/src/lib/cookies.ts worker/src/middleware/headers.ts worker/src/routes/auth.ts
git commit -m "feat: treat all non-development envs as production-grade for security"
```

---

## Task 2: Provision Cloudflare preview resources (manual, one-time)

This task runs real `wrangler` commands against the Cloudflare account and produces the D1 `database_id` that Task 3 needs. It requires wrangler auth (`CLOUDFLARE_API_TOKEN` with D1/R2/Workers edit, or `wrangler login`). If you cannot authenticate, stop here and hand these commands to someone who can; record the returned `database_id` for Task 3.

**Files:** none (external resources + secrets).

- [ ] **Step 1: Create the preview D1 database**

Run (from `worker/`):

```bash
npx wrangler d1 create pawary-preview
```

Expected: prints a `database_id` UUID. **Copy it** — Task 3 Step 1 needs it. (If it already exists, get the id with `npx wrangler d1 list`.)

- [ ] **Step 2: Create the preview R2 bucket**

Run:

```bash
npx wrangler r2 bucket create pawary-photos-preview
```

Expected: "Created bucket pawary-photos-preview".

- [ ] **Step 3: Set preview secrets**

Reuse the production Google OAuth client values:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID --env preview      # paste prod value
npx wrangler secret put GOOGLE_CLIENT_SECRET --env preview   # paste prod value
```

Generate fresh per-database secrets (do NOT reuse prod — encrypted API keys and push subscriptions are per-DB):

```bash
npx wrangler secret put ADVISOR_KEK --env preview            # paste: openssl rand -base64 32
```

Generate a new VAPID keypair and store both halves:

```bash
node -e 'crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]).then(async k=>{const pub=Buffer.from(await crypto.subtle.exportKey("raw",k.publicKey)).toString("base64url");const jwk=await crypto.subtle.exportKey("jwk",k.privateKey);console.log("VAPID_PUBLIC_KEY="+pub);console.log("VAPID_PRIVATE_KEY="+jwk.d)})'
npx wrangler secret put VAPID_PUBLIC_KEY --env preview        # paste printed public value
npx wrangler secret put VAPID_PRIVATE_KEY --env preview       # paste printed private value
```

> Note: `--env preview` secrets cannot be set until the `env.preview` block exists in wrangler config. If wrangler rejects "unknown environment preview", do Task 3 first, then return here.

- [ ] **Step 4: Whitelist the preview OAuth redirect URI**

In Google Cloud Console → APIs & Services → Credentials → the existing production OAuth client → Authorized redirect URIs, add:

```
https://pawary-preview.<acct>.workers.dev/api/auth/google/callback
```

Replace `<acct>` with your workers.dev subdomain (visible in the Cloudflare dashboard or in the URL printed by the first `wrangler deploy --env preview`). Save.

- [ ] **Step 5: Create the `preview` GitHub environment**

In GitHub → repo Settings → Environments → New environment → name `preview`. Do **not** add a branch restriction (any feature branch must be able to deploy). Add an environment secret `CLOUDFLARE_API_TOKEN` (same token used by production, with D1 + R2 + Workers Scripts edit permissions).

> The existing `production` environment is branch-restricted to `main`; leave it unchanged.

---

## Task 3: Add `env.preview` to wrangler.jsonc

**Files:**
- Modify: `worker/wrangler.jsonc` (add `preview` key inside the existing `env` object)

- [ ] **Step 1: Add the preview environment block**

In `worker/wrangler.jsonc`, inside the `"env"` object, add a `"preview"` sibling to `"production"`. Replace `PASTE_PREVIEW_D1_ID_FROM_TASK_2` with the `database_id` from Task 2 Step 1. Strict JSON only — no comments, no trailing commas:

```jsonc
    "preview": {
      "name": "pawary-preview",
      "workers_dev": true,
      "preview_urls": false,
      "vars": { "ENVIRONMENT": "preview" },
      "triggers": { "crons": ["*/15 * * * *"] },
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "pawary-preview",
          "database_id": "PASTE_PREVIEW_D1_ID_FROM_TASK_2",
          "migrations_dir": "drizzle"
        }
      ],
      "r2_buckets": [{ "binding": "PHOTOS", "bucket_name": "pawary-photos-preview" }],
      "ratelimits": [
        { "name": "RL_5", "namespace_id": "1005", "simple": { "limit": 5, "period": 60 } },
        { "name": "RL_10", "namespace_id": "1010", "simple": { "limit": 10, "period": 60 } },
        { "name": "RL_30", "namespace_id": "1030", "simple": { "limit": 30, "period": 60 } }
      ],
      "observability": { "enabled": true },
      "assets": {
        "directory": "../app/dist",
        "not_found_handling": "single-page-application",
        "run_worker_first": ["/api/*"]
      }
    },
```

(Add a trailing comma after the existing `"production": { ... }` block's closing brace so both keys are valid JSON members.)

- [ ] **Step 2: Verify the config still parses (the test loader depends on it)**

Run: `npm test -w worker -- environment`
Expected: PASS. (If the suite fails to load with a JSON parse error, you left a comment or trailing comma inside `env.preview` — fix it.)

- [ ] **Step 3: Validate the preview config builds (no deploy)**

Run (from `worker/`, after `npm run build` so `../app/dist` exists):

```bash
npm run build && cd worker && npx wrangler deploy --env preview --dry-run --outdir /tmp/pawary-preview-dryrun; cd ..
```

Expected: wrangler resolves the `preview` environment and reports bindings (DB → pawary-preview, PHOTOS → pawary-photos-preview) without error. No upload happens with `--dry-run`.

- [ ] **Step 4: Commit**

```bash
git add worker/wrangler.jsonc
git commit -m "feat: add preview wrangler environment"
```

---

## Task 4: Add the preview deploy workflow

**Files:**
- Create: `.github/workflows/preview.yml`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/preview.yml` (action SHAs match `.github/workflows/ci.yml`):

```yaml
name: Preview

on:
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    # the CLOUDFLARE_API_TOKEN secret lives in this environment; unlike
    # `production` it is NOT branch-restricted, so any feature branch can deploy
    environment: preview
    # one preview deploy at a time; a newer run supersedes an older queued one
    concurrency:
      group: deploy-preview
      cancel-in-progress: true
    steps:
      - uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5
      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      # npm ci and the build above run WITHOUT the API token in env, so
      # dependency (post)install scripts never see deploy credentials
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

- [ ] **Step 2: Lint the YAML locally**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/preview.yml'))" && echo OK`
Expected: `OK` (valid YAML).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/preview.yml
git commit -m "ci: add manual preview deploy workflow"
```

- [ ] **Step 4: First real deploy (after Tasks 2 and 3 are fully done and merged to a branch GitHub can see)**

Push the branch, then in GitHub → Actions → **Preview** → **Run workflow** → select the branch → Run. Watch the run go green. Note the workers.dev URL printed by the `Deploy worker` step (confirm `<acct>` matches the OAuth redirect URI from Task 2 Step 4).

---

## Task 5: Document the preview environment

**Files:**
- Modify: `README.md` (add a "Preview environment" subsection under Deployment)

- [ ] **Step 1: Add the documentation**

In `README.md`, after the production Deployment section, add:

```markdown
### Preview environment

A shared, production-faithful preview env (Worker `pawary-preview`, D1 `pawary-preview`,
R2 `pawary-photos-preview`) at `https://pawary-preview.<acct>.workers.dev`, configured via
the `preview` wrangler environment. Use it to verify a branch before merging to `main`;
it never touches production data.

Deploy a branch: GitHub → Actions → **Preview** → **Run workflow** → pick the branch.
The run tests, builds, applies pending D1 migrations to `pawary-preview`, and deploys.
Latest deploy wins (it is a single shared env).

One-time setup: create the D1 (`wrangler d1 create pawary-preview`) and R2
(`wrangler r2 bucket create pawary-photos-preview`); set secrets with
`wrangler secret put <NAME> --env preview` (reuse prod `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`;
generate fresh `ADVISOR_KEK` and a new VAPID keypair); add the preview callback
`https://pawary-preview.<acct>.workers.dev/api/auth/google/callback` to the Google OAuth
client; create a non-branch-restricted `preview` GitHub environment holding
`CLOUDFLARE_API_TOKEN`. Reset preview data anytime with
`wrangler d1 execute pawary-preview --remote --env preview --command "<sql>"`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document the preview environment"
```

---

## Verification (end-to-end)

- [ ] `npm run typecheck && npm test` pass at the repo root.
- [ ] `grep -rn 'ENVIRONMENT === "production"' worker/src` returns nothing.
- [ ] The **Preview** workflow run is green and prints the workers.dev URL.
- [ ] Opening the preview URL loads the app; **Dev sign-in is absent** (only real Google sign-in), confirming `ENVIRONMENT !== "development"`.
- [ ] After Google sign-in, the response sets a `__Host-session` cookie and includes the `Strict-Transport-Security` header (preview runs with production-grade security).
- [ ] Creating a pet/activity on preview leaves production D1/R2 unchanged (check via the production app or `wrangler d1 execute pawary --remote --env production`).
```
