# Pawary — Public Release Plan

**Status:** Draft · Owner: okdtsk · Last updated: 2026-06-13

Pawary is feature-complete and deployed at https://pawary.okdtsk.dev (Cloudflare
Workers + D1 + R2, CI auto-deploy on `main`). This document plans the path from
**family-only** → **friends** → **open public**. Everything below is
release-readiness, not feature work.

The headline: **the "friends" milestone needs almost no engineering** — it is
mostly a Google-console + legal-pages task. The heavy lifting (OAuth
verification, quotas, abuse controls) only becomes necessary for *open public
signup*.

---

## The two milestones

| | **M1 — Friends** (near-term) | **M2 — Open public** (later, optional) |
|---|---|---|
| Who can sign in | People you add as Google OAuth **test users** (≤100, by email) | Anyone with a Google account |
| Google OAuth status | Stays in **Testing** | Must be **Published / verified** |
| Registration | Implicitly gated (only test-user emails work) | Open — needs abuse controls |
| New engineering | Minimal (privacy page, maybe a friendlier landing) | Quotas, monitoring, backups, support |
| Realistic timeline | Days | Weeks, gated on Google review + ops work |

### Why M1 is nearly free

Pawary uses Google OAuth **only to establish identity at login**, then mints its
own ~90-day sliding session cookie. It does **not** rely on Google refresh
tokens for staying logged in. So the usual "Testing mode" friction (7-day
Google refresh-token expiry) does **not** affect your friends once they're in —
they get a normal long-lived Pawary session. The only cost of staying in Testing
mode is manually adding each friend's email in the Google console (cap 100).

> Verify before relying on this: confirm the current test-user cap and that your
> only requested scopes are the non-sensitive `email` / `profile` / `openid`
> (they are, per the auth code) — sensitive scopes would change the picture.

---

## Critical path

```
M1 (Friends):
  [legal: privacy policy + terms page]  ──┐
  [add friends as OAuth test users]  ─────┼──► invite friends
  [OAuth consent screen: add privacy URL] ┘

M2 (Public):
  M1 done
  + [Google OAuth verification / publish]   ← external review, longest lead time
  + [per-account storage quotas]
  + [scheduled backups + monitoring/alerts]
  + [support channel]
  + [capacity/cost review]                   ──► open registration
```

The single longest-lead-time item for M2 is **Google OAuth
verification** — start it early if public is the goal.

---

## Work items

Tagged by milestone (M1 = needed for friends, M2 = needed for public),
priority (P0 blocker / P1 important / P2 nice), and rough effort.

### A. Legal & privacy  *(you store pet health data + PII, and relay data to third-party AI providers)*

- [ ] **A1 · Privacy Policy page** — M1 · P0 · ~half day
      Must disclose: what's stored (account email/name, pet data, photos),
      that the AI Advisor sends recent pet data to the user's chosen provider
      (OpenAI/Google/Anthropic) using *their own* API key, retention, and that
      users can export/delete their data (both already implemented). A simple
      static page served by the worker or a `/privacy` route is enough.
- [ ] **A2 · Terms of Service page** — M1 · P1 · ~half day
      Light "use at your own risk, not veterinary advice, no warranty" terms.
      The not-a-vet disclaimer already exists in-app; mirror it here.
- [ ] **A3 · Link both from the app footer + the OAuth consent screen** — M1 · P0 · minutes
      Google's consent screen has fields for privacy-policy and homepage URLs;
      filling them is a prerequisite for A4.
- [ ] **A4 · Jurisdiction check** — M2 · P1
      If any friends are in the EU/UK (GDPR) or you want to be careful under
      Japan's APPI, confirm the privacy policy covers lawful basis, the
      third-party processors, and the data-subject rights you already support
      (export + deletion). Likely fine; just confirm.

### B. Authentication & access

- [ ] **B1 · Add friends as OAuth test users** — M1 · P0 · minutes each
      Google Cloud console → OAuth consent screen → Test users → add emails.
- [ ] **B2 · Google OAuth verification / publish to Production** — M2 · P0 · external lead time
      Required to lift the test-user cap and let anyone sign in. For
      non-sensitive scopes this is lighter than full sensitive-scope review,
      but still needs the verified domain, app homepage, logo, and the legal
      URLs from A1–A3. **Start this weeks before you want public signup.**
- [ ] **B3 · (Optional) invite-gate for a controlled public beta** — M2 · P2 · ~1–2 days
      If you want a middle phase between "friends I manually add" and "fully
      open," add a signup gate: an allowlist of approved emails, or a
      single-use invite-code flow (the pet-invite token machinery from Phase 1
      is a reusable pattern). Lets you publish OAuth while still controlling who
      gets an account.

### C. Abuse, quotas & cost  *(only matters once registration is open)*

- [ ] **C1 · Per-account storage quota** — M2 · P1 · ~1 day
      Today any account can create unlimited pets/activities/photos. Photos in
      R2 are the main cost risk. Add a cap (e.g. max pets per account, max
      photos per pet already exists at 6, plus a total-storage or
      activities-per-day ceiling) enforced server-side. The AI Advisor is
      BYO-key, so it carries **no cost to you** — a deliberate design win.
- [ ] **C2 · Capacity & cost review** — M2 · P1 · ~half day
      Re-check current Cloudflare D1 (rows read/written/day, storage), R2
      (storage + Class A/B ops), and Workers (requests, CPU-ms) free-tier
      limits vs. an estimated friends/public load, and decide if/when the
      Workers Paid plan ($5/mo) is needed. Numbers change — read the current
      Cloudflare pricing pages rather than trusting a cached figure.
- [ ] **C3 · Registration abuse guard** — M2 · P2
      With open signup, consider a Turnstile challenge on the login entry (a
      `turnstile-spin` skill exists) or simply rely on Google-account-required
      signup as the friction (often enough at this scale).

### D. Operations & reliability

- [ ] **D1 · Scheduled D1 backups** — M2 · P0 · ~half day
      Currently there's a single manual backup. Add a recurring export (a cron
      Worker dumping to R2, or a scheduled routine) so real user data is
      recoverable. Verify a restore once.
- [ ] **D2 · Monitoring & alerting** — M2 · P1 · ~half day
      Cloudflare observability is already enabled. Add alerting for: worker
      error-rate spikes, and the **push cron health** (it runs every 15 min —
      know if it stops). A weekly glance at the dashboard is the minimum.
- [ ] **D3 · Incident/rollback runbook** — M2 · P2 · ~1 hr
      One short doc: how to roll back (`wrangler rollback --env production`),
      where backups live, how to revoke a leaked secret. Mostly already known;
      write it down.
- [ ] **D4 · Secret rotation hygiene** — M2 · P2
      The `CLOUDFLARE_API_TOKEN` rotation reminder is already scheduled
      (~2026-09-03). VAPID and `ADVISOR_KEK` rotation runbooks: note that
      rotating VAPID invalidates existing push subscriptions (the 403-cleanup
      from Phase 5 self-heals server-side) and rotating `ADVISOR_KEK` would
      orphan stored advisor keys (users re-enter). Document, don't automate.

### E. Trust & polish for non-technical users

- [ ] **E1 · A real landing page** — M1 · P1 · ~1 day
      Right now the root *is* the app (login screen). A short marketing/landing
      page — what Pawary is, screenshots, "add to Home Screen" instructions
      (especially iOS, since push requires it), and the privacy/terms links —
      doubles as the OAuth-required homepage (A3/B2) and makes sharing a link
      feel legitimate to friends.
- [ ] **E2 · Support / feedback channel** — M1 · P1 · minutes
      A way for friends to reach you: a mailto link, a form, or a Google
      Form. Set expectations ("hobby project, best-effort").
- [ ] **E3 · Accessibility & error-state pass** — M2 · P2 · ~1 day
      A quick audit (the `web-perf` skill covers some of this) — keyboard nav,
      contrast, friendly errors for the paths a stranger might hit.
- [ ] **E4 · Friendlier domain (optional)** — M2 · P2
      `pawary.okdtsk.dev` is fine for friends; a dedicated domain (e.g.
      `pawary.app`) would feel more trustworthy for a wider public and is a
      cleaner OAuth homepage. Pure optional polish.

---

## Recommended sequencing

**To share with friends this week (M1):**
1. A1 + A2 (privacy + terms pages) → A3 (link them, fill OAuth consent URLs)
2. E1 + E2 (landing page + support link) — optional but makes it feel real
3. B1 (add each friend's email as a test user)
4. Share the link. Done.

**If/when you want open public (M2), in order:**
1. B2 (OAuth verification — **start first**, it has external lead time)
2. C1 (storage quota) + D1 (backups) — before strangers can fill your storage
3. D2 (monitoring) + C2 (cost review)
4. Optionally B3 (invite-gated beta) as a soft-launch before fully open
5. Flip OAuth to Production / open registration.

---

## Explicitly out of scope (deliberately not doing)

- **Payments / monetization** — it's a free, BYO-AI-key hobby app.
- **Email-password auth, MFA** — Google OAuth is sufficient.
- **Multi-region / horizontal scaling** — Cloudflare handles this natively.
- **Compliance certifications** (SOC 2, etc.) — overkill at this scale.
- **App-store native apps** — the installable PWA covers mobile.
- The two earlier-deferred features (image thumbnailing, tunable anomaly
  thresholds) — independent of release; revisit only if wanted.

---

## Open decisions for the owner

1. **Is "public" actually a goal, or is "friends" the real destination?** If
   friends is the end state, you can skip all of M2 and most of section C/D.
2. **Custom domain?** (E4) — affects the OAuth homepage and how you brand the
   landing page.
3. **Controlled beta vs. straight to open?** (B3) — invite-gating lets you
   publish OAuth while still curating who joins.
4. **Where do legal pages live?** — static routes in the worker, or a separate
   simple host. Worker routes keep everything in one deploy.
