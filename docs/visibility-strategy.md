# Public Visibility Strategy

Pawary is currently **private** (family test phase). This document records how
visibility is controlled today and the exact steps to make the app public later.

There are two independent dials:

- **Discoverability** — whether the app shows up in search engines (Layer 1).
- **Access** — who can actually sign in and use it (Layer 2).

A third, optional edge gate (Layer 3) is documented but not in use.

---

## Current state (private)

### Layer 1 — Discoverability: blocked

The app is hidden from search indexes via `noindex`. Implemented in four places
so that both Worker-served (`/api/*`) and statically-served responses are covered
(static assets bypass the Worker because of `run_worker_first: ["/api/*"]`):

| File | Mechanism |
|---|---|
| `worker/src/middleware/headers.ts` | `X-Robots-Tag: noindex, nofollow` on `/api/*` responses |
| `app/public/_headers` | `X-Robots-Tag: noindex, nofollow` on `/*` (SPA HTML + static assets) |
| `app/index.html` | `<meta name="robots" content="noindex, nofollow">` |
| `app/public/robots.txt` | `Disallow: /` |

The `X-Robots-Tag` header is the authoritative control — it prevents indexing
even if an external site links to the URL. `robots.txt` and the meta tag are
reinforcement.

### Layer 2 — Access: Google OAuth "Test users"

Access is gated by the **Google Cloud OAuth client consent screen**, kept in
**Testing** status. Only emails on the **Test users** list can complete sign-in;
Google enforces this before the request ever reaches our callback.

- Pawary uses only **non-sensitive scopes** (email / profile), so no Google
  verification review is required to publish.
- Pawary issues its **own session cookie** after login and does **not** store
  Google refresh tokens, so the "test-mode refresh token expires after 7 days"
  limitation does not apply — users stay logged in.
- Trade-off: test users see a one-time "Google hasn't verified this app" warning
  (Advanced → Continue). Acceptable for a family test phase.

**To manage the user list today:** add/remove emails under
Google Cloud Console → APIs & Services → OAuth consent screen → Test users.

### Layer 3 — Edge gate (Cloudflare Access): NOT in use

Not enabled. Documented as an option below for completeness.

---

## How to make the app public

Do these in order. Layer 2 is the real "open the doors" step; Layer 1 makes the
app discoverable in search.

### Step 1 — Open access (Layer 2)

Choose ONE:

**Option A — Publish the Google OAuth app (recommended, simplest).**
1. Google Cloud Console → APIs & Services → OAuth consent screen.
2. Click **Publish app** → confirm. Status changes Testing → **In production**.
3. Because only non-sensitive scopes are used, this takes effect immediately
   with no verification review. The "unverified app" warning and the 100-test-user
   cap both disappear; anyone with a Google account can now register.

> ⚠️ This removes the only access gate. Do not publish until you intend the app
> to be fully public, or until a defense-in-depth allowlist (Option B) is in place.

**Option B — Keep an explicit allowlist (defense-in-depth, optional).**
If you want to publish the OAuth app but still restrict who can register, add an
application-level email allowlist before publishing:
1. Add a Worker secret `ALLOWED_EMAILS` (comma-separated) via
   `wrangler secret put ALLOWED_EMAILS`.
2. In `worker/src/routes/auth.ts` (Google callback), reject sign-in when the
   verified email is not in the list; treat an empty/unset value as "allow all".
3. Going fully public later = clear the secret. No code change, no redeploy.

### Step 2 — Allow search indexing (Layer 1)

Reverse the `noindex` controls:
1. `worker/src/middleware/headers.ts` — remove the `X-Robots-Tag` line.
2. `app/public/_headers` — remove the `X-Robots-Tag: noindex, nofollow` line.
3. `app/index.html` — remove the `<meta name="robots" ...>` tag.
4. `app/public/robots.txt` — change `Disallow: /` to `Disallow:` (allow all), or
   delete the file.
5. Rebuild & deploy. Optionally submit the site to Google Search Console.

### Step 3 (optional) — Pre-public hardening checklist

Before a real public launch, revisit:
- [ ] Rate limits (`worker/wrangler.jsonc` `ratelimits`) sized for untrusted traffic.
- [ ] Open-registration abuse: consider Turnstile on sign-in, account caps, or
      keeping the `ALLOWED_EMAILS` allowlist (Option B).
- [ ] Review unauthenticated code paths and error responses.
- [ ] Terms of Service / Privacy Policy if collecting accounts publicly.

---

## Optional: Cloudflare Access (Layer 3)

If, instead of opening up, you ever want the app **completely unreachable** by
anyone outside an approved list (stronger than Layer 2):

- Add a Cloudflare Access (Zero Trust) application in front of the `pawary`
  hostname. Cloudflare authenticates at the **edge** before the Worker runs, so
  unapproved visitors never reach the app at all — not even the HTML.
- Cost: a second login step (Cloudflare's identity check, which can use Google
  or email OTP) layered on top of the app's own Google login.
- **To remove later:** delete the Access application in the Cloudflare dashboard.

This is overkill for the current family test phase and is not enabled.
