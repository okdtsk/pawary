# Preview-Only Test Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let QA sign in on any preview host (incl. per-PR alias URLs) without Google OAuth, gated by a shared secret, so logged-in views can be visually verified.

**Architecture:** Widen the existing `POST /api/auth/dev-login` to also work on `ENVIRONMENT === "preview"` when a `PREVIEW_LOGIN_SECRET` matches (never production). Inject `APP_ENVIRONMENT=preview` at build time so the Login page shows a test-login form (email + passphrase) that hits the same endpoint same-origin.

**Tech Stack:** Cloudflare Workers + Hono (backend), React + Vite (frontend), `cloudflare:test` (vitest-pool-workers), Drizzle/D1.

---

## CRITICAL environment notes for the implementer

- **Branch:** `feat/preview-test-login` (already checked out; based on `feat/per-pr-preview-urls`). Do NOT create/switch branches.
- **Worktree:** `/Users/okdtsk/ghq/github.com/okdtsk/pawary/.claude/worktrees/preview` — all edits land here.
- **Worker tests:** run with the Bash param **`dangerouslyDisableSandbox: true`**, per file, e.g. `cd worker && npx vitest run test/dev-login.test.ts`. `Test Files  N passed` = green; a `Connection refused`/`EADDRNOTAVAIL`/`ERR_RUNTIME_FAILURE` means the sandbox was on — retry disabled. Ignore the `Unexpected fields ... "ratelimits"` warning.
- **typecheck:** `npm run typecheck` (repo root) runs normally; it is currently clean (a `@pawary/shared` symlink fix is in `node_modules` — do not touch it).
- Spec: `docs/superpowers/specs/2026-06-14-preview-test-login-design.md`.

## Background the implementer needs

`worker/src/routes/auth.ts:108` is `POST /api/auth/dev-login`, rate-limited, currently gated to `ENVIRONMENT === "development"` + localhost. It upserts a user from `{sub:`dev:${email}`,email,name,picture:null}`, creates a session, sets the cookie, returns `{data:{ok:true}}`. `constantTimeEqual` is already imported there (from `../lib/crypto`). `isProdLike(env)` (`worker/src/lib/environment.ts`) is `ENVIRONMENT !== "development"`, so preview already gets the Secure `__Host-session` cookie.

Frontend `app/src/routes/Login.tsx:75` renders a dev `Button` only under `import.meta.env.DEV`. `app/vite.config.ts:22` injects `__APP_VERSION__` via `define` from `process.env.APP_COMMIT_SHA`; `app/src/vite-env.d.ts:5` declares it. The preview CI build step (`.github/workflows/preview.yml`, the `npm run build` step) already sets `APP_COMMIT_SHA`.

## File Structure

- **Modify** `worker/src/routes/auth.ts` — widen the gate.
- **Modify** `worker/src/env.ts` — add `PREVIEW_LOGIN_SECRET`.
- **Modify** `worker/test/dev-login.test.ts` — add preview cases.
- **Modify** `app/vite.config.ts` + `app/src/vite-env.d.ts` — inject/declare `__APP_ENVIRONMENT__`.
- **Modify** `.github/workflows/preview.yml` — add `APP_ENVIRONMENT: preview` to the build step.
- **Modify** `app/src/i18n/messages.ts`, `en.ts`, `ja.ts` — 3 new `login.*` strings.
- **Modify** `app/src/routes/Login.tsx` — test-login form.

---

## Task 1: Backend gate + env type + tests (TDD)

**Files:**
- Modify: `worker/src/env.ts`
- Modify: `worker/src/routes/auth.ts` (the `dev-login` handler, lines ~108-132)
- Test: `worker/test/dev-login.test.ts`

- [ ] **Step 1: Add the env field**

In `worker/src/env.ts`, add to the `Env` type (next to the other secrets like `VAPID_PRIVATE_KEY`):

```ts
  PREVIEW_LOGIN_SECRET: string;
```

- [ ] **Step 2: Write the failing tests**

Append these tests to `worker/test/dev-login.test.ts` (keep the existing imports and three tests; `createExecutionContext`, `env`, `SELF`, `waitOnExecutionContext`, `app`, `expect`, `it` are already imported there):

```ts
it("preview test-login works with the correct secret", async () => {
  const ctx = createExecutionContext();
  const res = await app.fetch(
    new Request("https://feat-x-pawary-preview.okdtsk.workers.dev/api/auth/dev-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "qa@example.com", secret: "s3cret" }),
    }),
    { ...env, ENVIRONMENT: "preview" as const, PREVIEW_LOGIN_SECRET: "s3cret" },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(200);
  const cookie = res.headers.getSetCookie().find((v) => v.startsWith("__Host-session="));
  expect(cookie).toBeTruthy();
});

it("preview test-login is 404 with a wrong secret", async () => {
  const ctx = createExecutionContext();
  const res = await app.fetch(
    new Request("https://feat-x-pawary-preview.okdtsk.workers.dev/api/auth/dev-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "qa@example.com", secret: "wrong" }),
    }),
    { ...env, ENVIRONMENT: "preview" as const, PREVIEW_LOGIN_SECRET: "s3cret" },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(404);
});

it("preview test-login is 404 when the secret is omitted", async () => {
  const ctx = createExecutionContext();
  const res = await app.fetch(
    new Request("https://feat-x-pawary-preview.okdtsk.workers.dev/api/auth/dev-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "qa@example.com" }),
    }),
    { ...env, ENVIRONMENT: "preview" as const, PREVIEW_LOGIN_SECRET: "s3cret" },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(404);
});

it("preview test-login is 404 when PREVIEW_LOGIN_SECRET is unset (fail-closed)", async () => {
  const ctx = createExecutionContext();
  const res = await app.fetch(
    new Request("https://feat-x-pawary-preview.okdtsk.workers.dev/api/auth/dev-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "qa@example.com", secret: "" }),
    }),
    { ...env, ENVIRONMENT: "preview" as const, PREVIEW_LOGIN_SECRET: "" },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(404);
});
```

- [ ] **Step 3: Run the tests, expect FAIL**

`cd worker && npx vitest run test/dev-login.test.ts` (sandbox disabled). Expect the four new tests to FAIL (preview currently 404s for the success case → the "correct secret → 200" test fails; the others may pass for the wrong reason). The point is the success case is red.

- [ ] **Step 4: Widen the gate in `worker/src/routes/auth.ts`**

Replace the current gate block at the top of the `dev-login` handler:

```ts
authRoutes.post("/dev-login", rateLimit("auth-dev-login", 10, 60_000), async (c) => {
  const host = new URL(c.req.url).hostname;
  const isLocalhost = host === "localhost" || host === "127.0.0.1";
  if (c.env.ENVIRONMENT !== "development" || !isLocalhost) {
    return err(c, 404, "not_found", "Not found");
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    name?: string;
  };
```

with:

```ts
authRoutes.post("/dev-login", rateLimit("auth-dev-login", 10, 60_000), async (c) => {
  const host = new URL(c.req.url).hostname;
  const isLocalhost = host === "localhost" || host === "127.0.0.1";

  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    name?: string;
    secret?: string;
  };

  // Test login is allowed only on local development (localhost) or on the
  // preview environment with the shared PREVIEW_LOGIN_SECRET. Never production.
  // Fail closed (404, not 403) so the endpoint stays invisible elsewhere.
  const devOk = c.env.ENVIRONMENT === "development" && isLocalhost;
  const previewOk =
    c.env.ENVIRONMENT === "preview" &&
    !!c.env.PREVIEW_LOGIN_SECRET &&
    typeof body.secret === "string" &&
    constantTimeEqual(body.secret, c.env.PREVIEW_LOGIN_SECRET);
  if (!devOk && !previewOk) {
    return err(c, 404, "not_found", "Not found");
  }
```

Leave everything below unchanged (the `const email = body.email ?? ...`, upsert, session, cookie, response). Note the body is now parsed BEFORE the gate (needed for the secret check) — make sure there is no second `c.req.json()` call left further down.

- [ ] **Step 5: Run the tests, expect PASS**

`cd worker && npx vitest run test/dev-login.test.ts` (sandbox disabled). Expect all tests pass (the original 3 + 4 new).

- [ ] **Step 6: Typecheck**

`npm run typecheck`. Expect exit 0.

- [ ] **Step 7: Commit**

```bash
git add worker/src/env.ts worker/src/routes/auth.ts worker/test/dev-login.test.ts
git commit -m "feat: allow preview test-login with a shared secret"
```

---

## Task 2: Build-time environment flag

**Files:**
- Modify: `app/vite.config.ts` (the `define` block, lines ~20-23)
- Modify: `app/src/vite-env.d.ts`
- Modify: `.github/workflows/preview.yml` (the `npm run build` step)

- [ ] **Step 1: Inject `__APP_ENVIRONMENT__` in `app/vite.config.ts`**

In the `define` object, add a second key so it reads:

```ts
  define: {
    __APP_VERSION__: JSON.stringify(resolveCommitHash()),
    __APP_ENVIRONMENT__: JSON.stringify(process.env.APP_ENVIRONMENT ?? "development"),
  },
```

- [ ] **Step 2: Declare the global in `app/src/vite-env.d.ts`**

Add below the existing `declare const __APP_VERSION__: string;` line:

```ts
declare const __APP_ENVIRONMENT__: string;
```

- [ ] **Step 3: Set `APP_ENVIRONMENT` in the preview build step**

In `.github/workflows/preview.yml`, the `- run: npm run build` step currently has:

```yaml
      - run: npm run build
        # surface the deployed commit in the app UI (Settings → Version); on a
        # PR event github.sha is a synthetic merge commit, so use the head sha
        env:
          APP_COMMIT_SHA: ${{ github.event.pull_request.head.sha || github.sha }}
```

Add `APP_ENVIRONMENT` under `env:`:

```yaml
      - run: npm run build
        # surface the deployed commit in the app UI (Settings → Version); on a
        # PR event github.sha is a synthetic merge commit, so use the head sha.
        # APP_ENVIRONMENT=preview enables the preview test-login UI.
        env:
          APP_COMMIT_SHA: ${{ github.event.pull_request.head.sha || github.sha }}
          APP_ENVIRONMENT: preview
```

(Production CI `ci.yml` does NOT set `APP_ENVIRONMENT`, so the production build defaults to `"development"` in the define and never shows the test-login UI.)

- [ ] **Step 4: Validate + typecheck**

```bash
npx --yes js-yaml .github/workflows/preview.yml >/dev/null && echo YAML_OK
npm run typecheck
```
Expect `YAML_OK` and typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/vite.config.ts app/src/vite-env.d.ts .github/workflows/preview.yml
git commit -m "feat: inject APP_ENVIRONMENT build flag for preview UI gating"
```

---

## Task 3: i18n strings + Login form

**Files:**
- Modify: `app/src/i18n/messages.ts`, `app/src/i18n/en.ts`, `app/src/i18n/ja.ts`
- Modify: `app/src/routes/Login.tsx`

- [ ] **Step 1: Add i18n keys (3 files)**

In `app/src/i18n/messages.ts`, change the `login` block of the message type:

```ts
  login: {
    authError: string;
  };
```

to:

```ts
  login: {
    authError: string;
    testEmailPlaceholder: string;
    testSecretPlaceholder: string;
    testSubmit: string;
  };
```

In `app/src/i18n/en.ts`, change its `login` block:

```ts
  login: {
    authError: "Sign-in didn't complete. Please try again.",
  },
```

to:

```ts
  login: {
    authError: "Sign-in didn't complete. Please try again.",
    testEmailPlaceholder: "Email (any test user)",
    testSecretPlaceholder: "Preview passphrase",
    testSubmit: "Test sign-in",
  },
```

In `app/src/i18n/ja.ts`, change its `login` block:

```ts
  login: {
    authError: "サインインが完了しませんでした。もう一度お試しください。",
  },
```

to:

```ts
  login: {
    authError: "サインインが完了しませんでした。もう一度お試しください。",
    testEmailPlaceholder: "メール（任意のテストユーザー）",
    testSecretPlaceholder: "プレビュー用パスフレーズ",
    testSubmit: "テストサインイン",
  },
```

- [ ] **Step 2: Update `app/src/routes/Login.tsx`**

Add the React `useState` import at the top:

```ts
import { useState } from "react";
```

Inside the `Login` component, after the existing `const authError = ...` line, add:

```tsx
  const testLoginEnabled =
    import.meta.env.DEV || __APP_ENVIRONMENT__ === "preview";
  const needsSecret = !import.meta.env.DEV;
  const [testEmail, setTestEmail] = useState("");
  const [testSecret, setTestSecret] = useState(() =>
    needsSecret ? localStorage.getItem("previewLoginSecret") ?? "" : "",
  );
```

Replace the existing `devLogin` function:

```tsx
  const devLogin = async () => {
    await api("/api/auth/dev-login", {
      method: "POST",
      body: JSON.stringify({}),
    });
    await qc.invalidateQueries({ queryKey: ["me"] });
  };
```

with:

```tsx
  const testLogin = async () => {
    if (needsSecret) localStorage.setItem("previewLoginSecret", testSecret);
    await api("/api/auth/dev-login", {
      method: "POST",
      body: JSON.stringify(
        needsSecret
          ? { email: testEmail, secret: testSecret }
          : { email: testEmail },
      ),
    });
    await qc.invalidateQueries({ queryKey: ["me"] });
  };
```

Replace the existing dev-button block:

```tsx
        {import.meta.env.DEV && (
          <Button
            variant="ghost"
            size="sm"
            onClick={devLogin}
            className="animate-pop"
            style={{ animationDelay: "260ms" }}
          >
            {t.signInDev}
          </Button>
        )}
```

with:

```tsx
        {testLoginEnabled && (
          <div
            className="animate-pop flex w-full flex-col gap-2"
            style={{ animationDelay: "260ms" }}
          >
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder={t.login.testEmailPlaceholder}
              className="w-full rounded-full border border-cream-200 bg-white px-5 py-2.5 text-sm text-ink-soft outline-none focus:border-clay-400"
            />
            {needsSecret && (
              <input
                type="password"
                value={testSecret}
                onChange={(e) => setTestSecret(e.target.value)}
                placeholder={t.login.testSecretPlaceholder}
                className="w-full rounded-full border border-cream-200 bg-white px-5 py-2.5 text-sm text-ink-soft outline-none focus:border-clay-400"
              />
            )}
            <Button variant="ghost" size="sm" onClick={testLogin}>
              {t.login.testSubmit}
            </Button>
          </div>
        )}
```

- [ ] **Step 3: Typecheck**

`npm run typecheck`. Expect exit 0 (the `login` message type now matches all three locales, and `__APP_ENVIRONMENT__` is declared).

- [ ] **Step 4: Run the app test suite (no sandbox flag needed — app tests are plain vitest)**

`npm test -w app 2>&1 | tail -15`. Expect pass (no app tests touch Login; this just confirms nothing broke). If the app workspace has no relevant tests, a "no failures" / all-pass result is fine.

- [ ] **Step 5: Commit**

```bash
git add app/src/i18n/messages.ts app/src/i18n/en.ts app/src/i18n/ja.ts app/src/routes/Login.tsx
git commit -m "feat: preview test-login form on the Login page"
```

---

## Task 4: Final verification + secret setup + PR

- [ ] **Step 1: Full local gate**

```bash
npm run typecheck
cd worker && npx vitest run test/dev-login.test.ts && cd ..
```
(worker test sandbox-disabled). Expect typecheck exit 0 and dev-login tests all green.

- [ ] **Step 2: Review the branch**

```bash
git log --oneline feat/per-pr-preview-urls..HEAD
git diff feat/per-pr-preview-urls..HEAD --stat
```
Expect commits: design doc, backend gate, build flag, frontend form. Changed files limited to: `worker/src/env.ts`, `worker/src/routes/auth.ts`, `worker/test/dev-login.test.ts`, `app/vite.config.ts`, `app/src/vite-env.d.ts`, `.github/workflows/preview.yml`, `app/src/i18n/{messages,en,ja}.ts`, `app/src/routes/Login.tsx`, and the spec/plan docs.

- [ ] **Step 3: Set the preview secret (CONFIRM with the user; they run it — needs their wrangler auth)**

This is a one-time setup the user performs (it needs interactive wrangler auth / their Cloudflare login):

```bash
cd worker && npx wrangler secret put PREVIEW_LOGIN_SECRET --env preview
```

The value is the shared passphrase QA will type. Until it is set, the preview test-login stays 404 (fail-closed) — that is expected.

- [ ] **Step 4: Push + open the PR (CONFIRM with the user first)**

This branch is stacked on `feat/per-pr-preview-urls` (#19). Either merge #19 first then retarget, or open this PR with base `feat/per-pr-preview-urls`. Confirm with the user, then:

```bash
git push -u origin feat/preview-test-login
gh pr create --title "feat: preview-only test login (secret-gated)" --body "$(cat <<'EOF'
## Summary
- Widens `POST /api/auth/dev-login` to work on the `preview` env when a `PREVIEW_LOGIN_SECRET` matches (constant-time, fail-closed, 404-not-403, never production).
- Injects `APP_ENVIRONMENT=preview` at build time; the Login page then shows an email + passphrase test-login form that hits the endpoint same-origin (works on per-PR alias URLs, unlike Google OAuth).

Enables logged-in QA on per-PR preview URLs. Stacked on #19.

Design: `docs/superpowers/specs/2026-06-14-preview-test-login-design.md`

## One-time setup
`cd worker && npx wrangler secret put PREVIEW_LOGIN_SECRET --env preview`

## Test plan
- `worker/test/dev-login.test.ts`: preview + correct/wrong/omitted/unset secret cases; dev + production cases unchanged.
- On a preview URL: Login shows the form; correct email+secret → logged in; wrong/blank secret stays on login. Production build shows no test-login UI.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" --base feat/per-pr-preview-urls
```

- [ ] **Step 5: Verify on a preview URL (after the secret is set and the branch is deployed)**

Label the PR `preview`, wait for the run, open the per-PR URL, and confirm the test-login form appears and a valid email + secret logs in and renders a signed-in view.

---

## Notes / gotchas

- Body is parsed BEFORE the gate now (the secret lives in the body). Ensure no duplicate `c.req.json()` remains later in the handler.
- The dev/localhost path never reads the secret — local `vite dev` + `wrangler dev` keeps working with no passphrase.
- `signInDev` i18n key is now unused but left in place (harmless); do not spend effort removing it.
- Do not enable `APP_ENVIRONMENT` in `ci.yml` (production) — that would expose the test-login UI in prod.
