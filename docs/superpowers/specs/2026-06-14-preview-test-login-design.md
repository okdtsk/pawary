# Preview-Only Test Login — Design

Date: 2026-06-14

## Goal

Let QA sign in on any preview host (including per-PR preview-alias URLs) without Google
OAuth, so logged-in views can be visually verified. Google OAuth can't be used on per-PR
preview URLs: each PR has a unique workers.dev origin whose redirect URI isn't registered
(`redirect_uri_mismatch`), Google forbids wildcard redirect URIs, and workers.dev is a
public-suffix domain so sessions can't be shared across subdomains. A preview-only test
login sidesteps all of that with a same-origin POST that sets the session cookie for the
host the QA is already on.

## Decisions (settled during brainstorming)

- **Mechanism:** widen the existing `POST /api/auth/dev-login` to also work on the
  `preview` environment — do NOT build a parallel system.
- **Gating:** preview requires a shared secret (`PREVIEW_LOGIN_SECRET`). Never works on
  production. Dev/localhost path is unchanged (no secret).
- **Identity:** type any email (+ optional name) → signs in as that test user (reuses the
  current dev-login behavior), so multi-user careteam flows can be QA'd across browsers.
- **Frontend:** show the test-login UI when the build is dev OR preview, with a passphrase
  field on preview (remembered in `localStorage`).
- **Scope:** its own PR, stacked on `feat/per-pr-preview-urls` (#19) because it edits that
  PR's rewritten `preview.yml` build step.

## Background — current behavior (branch base = feat/per-pr-preview-urls)

`worker/src/routes/auth.ts:108` — `POST /api/auth/dev-login`, rate-limited
(`auth-dev-login`, 10/60s). Current gate:

```ts
const host = new URL(c.req.url).hostname;
const isLocalhost = host === "localhost" || host === "127.0.0.1";
if (c.env.ENVIRONMENT !== "development" || !isLocalhost) {
  return err(c, 404, "not_found", "Not found");
}
// parse {email,name}; upsert user {sub:`dev:${email}`,email,name,picture:null};
// createSession; setSessionCookie; return {data:{ok:true}}
```

`worker/src/lib/environment.ts` — `isProdLike(env) === (ENVIRONMENT !== "development")`;
preview is prod-like, so `setSessionCookie` already uses the Secure `__Host-session`
cookie on preview. `worker/src/lib/crypto.ts` exports `constantTimeEqual` (already imported
in auth.ts).

`app/src/routes/Login.tsx:75` — renders the dev-login `Button` only when
`import.meta.env.DEV` (local Vite). `devLogin()` POSTs `/api/auth/dev-login` with `{}` then
invalidates the `me` query.

`app/vite.config.ts:20-23` — `define: { __APP_VERSION__: JSON.stringify(resolveCommitHash()) }`,
where `resolveCommitHash()` reads `process.env.APP_COMMIT_SHA`. The preview/production CI
build steps set `APP_COMMIT_SHA`. This is the pattern to mirror for environment injection.

`worker/test/dev-login.test.ts` — covers dev/localhost success, non-localhost 404 in dev,
and production 404 (via `app.fetch(req, {...env, ENVIRONMENT:"production"}, ctx)`).

## Components

### 1. Backend gate — `worker/src/routes/auth.ts`

Widen the gate in the `dev-login` handler. Parse the body first (it now also carries
`secret`), then authorize:

```ts
const host = new URL(c.req.url).hostname;
const isLocalhost = host === "localhost" || host === "127.0.0.1";

const body = (await c.req.json().catch(() => ({}))) as {
  email?: string;
  name?: string;
  secret?: string;
};

const devOk = c.env.ENVIRONMENT === "development" && isLocalhost;
const previewOk =
  c.env.ENVIRONMENT === "preview" &&
  !!c.env.PREVIEW_LOGIN_SECRET &&
  typeof body.secret === "string" &&
  constantTimeEqual(body.secret, c.env.PREVIEW_LOGIN_SECRET);

if (!devOk && !previewOk) {
  return err(c, 404, "not_found", "Not found");
}
// unchanged below: email/name defaults, upsertUserFromGoogle, createSession,
// setSessionCookie, return c.json({ data: { ok: true } })
```

Security properties: never production (no env branch allows it); preview **fails closed**
(404) when `PREVIEW_LOGIN_SECRET` is unset or the secret mismatches;
`constantTimeEqual` avoids timing leaks; keeps **404 not 403** so the endpoint stays
invisible; keeps the existing rate limit. The dev/localhost path is unchanged and never
consults the secret.

### 2. Env type + secret — `worker/src/env.ts`

Add `PREVIEW_LOGIN_SECRET: string;` to `Env`. It is a Wrangler secret set on the preview
env only (unset on dev/production; the gate handles absence). One-time setup:

```sh
npx wrangler secret put PREVIEW_LOGIN_SECRET --env preview
```

### 3. Build-time environment flag

- `app/vite.config.ts`: add to `define`:
  `__APP_ENVIRONMENT__: JSON.stringify(process.env.APP_ENVIRONMENT ?? "development")`.
- Declare the global for TS (mirror wherever `__APP_VERSION__` is declared — add
  `declare const __APP_ENVIRONMENT__: string;` in the same `*.d.ts`).
- `.github/workflows/preview.yml`: add `APP_ENVIRONMENT: preview` to the `npm run build`
  step's `env` block (next to `APP_COMMIT_SHA`). Production CI keeps it unset → defaults to
  `"development"` in the define, so the test-login UI never renders in the production build.

### 4. Frontend — `app/src/routes/Login.tsx`

- Compute availability: `const testLoginEnabled = import.meta.env.DEV || __APP_ENVIRONMENT__ === "preview";`
  and `const needsSecret = !import.meta.env.DEV;` (preview build needs the passphrase;
  local dev does not).
- Replace the `import.meta.env.DEV && <Button>` block with a small test-login section
  rendered when `testLoginEnabled`:
  - an **email** input (default empty; falls back to `dev@example.com` server-side if blank),
  - on `needsSecret`, a **passphrase** input prefilled from
    `localStorage.getItem("previewLoginSecret")`,
  - a submit button. On submit: persist the secret to `localStorage`, then
    `POST /api/auth/dev-login` with `{ email, secret }` (omit `secret` when `!needsSecret`),
    then `qc.invalidateQueries({ queryKey: ["me"] })`.
- Keep the existing "Sign in with Google" button as-is above it.

### 5. Tests — `worker/test/dev-login.test.ts`

Keep the three existing tests. Add (overriding env per request like the existing
production test):
- **preview + correct secret → 200 + session cookie**, and `/api/me` succeeds with it.
- **preview + wrong secret → 404.**
- **preview + secret omitted → 404.**
- **preview + `PREVIEW_LOGIN_SECRET` unset (env value empty) → 404** (fail-closed).

Use `app.fetch(req, { ...env, ENVIRONMENT: "preview", PREVIEW_LOGIN_SECRET: "s3cret" }, ctx)`
with `waitOnExecutionContext`.

## Deploy / setup sequencing

1. Set the secret once: `npx wrangler secret put PREVIEW_LOGIN_SECRET --env preview`.
2. Merge after #19 (this branch is stacked on it). The preview build then injects
   `APP_ENVIRONMENT=preview`, the UI shows the test-login, and the widened gate accepts the
   secret on any preview host (shared or per-PR alias).

## Out of scope

- Any change to the Google OAuth flow or registering per-PR redirect URIs.
- A user picker / seeded fixtures (type-any-email covers multi-user QA).
- Rotating or per-PR secrets (one shared preview secret is enough).
- Enabling test login on production (explicitly never).

## Testing / verification

- `npm run typecheck` and the worker `dev-login.test.ts` suite pass.
- On a per-PR preview URL with `APP_ENVIRONMENT=preview` built in: the Login page shows the
  test-login form; submitting a valid email + the shared secret lands an authenticated
  session and the app's logged-in views render. Wrong/blank secret stays on the login page
  (404 from the endpoint). Production build shows no test-login UI and the endpoint 404s.
