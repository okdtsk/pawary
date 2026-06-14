# Per-PR Preview URLs — Design

Date: 2026-06-14

## Goal

Give each pull request its own **stable preview URL** instead of every PR sharing the
single `pawary-preview.okdtsk.workers.dev`. This decouples one PR's QA from another's, so
labeling PR A for preview no longer overwrites whatever PR B last deployed. Reference:
<https://zenn.dev/numa_san/articles/dc33ed3d49b425>.

## Decisions (settled during brainstorming)

- **Mechanism:** Cloudflare Workers **preview aliases** — `wrangler versions upload
  --env preview --preview-alias <branch>` uploads a new *version* of the existing
  `pawary-preview` worker and exposes it at a stable per-branch URL. It does **not** take
  over the worker's main traffic (no `wrangler deploy`).
- **URL shape:** `https://<sanitized-branch>-pawary-preview.okdtsk.workers.dev`. Stable
  across pushes to the same branch; different branches → different URLs.
- **Trigger:** keep the **`preview` label** as the opt-in. Auto-deploy is intentionally
  rejected so D1/R2 are never touched unless a PR is explicitly labeled. An
  already-labeled PR also refreshes on new commits (synchronize). See §2.
- **Data:** all PR previews **share** the one `pawary-preview` D1 + R2 (no per-PR
  isolation). Accepted trade-off; label gating ensures the shared store is only touched
  intentionally.
- **Cleanup:** none. Stale aliases for merged/closed PRs persist harmlessly, pointing at
  their last version. Out of scope.

## Background — relevant current behavior

`.github/workflows/preview.yml` today triggers on `pull_request: [labeled]` +
`workflow_dispatch`, and runs `npx wrangler deploy --env preview` — which overwrites the
single shared `pawary-preview.okdtsk.workers.dev`. So two QA efforts collide: the latest
labeled deploy wins and there is exactly one preview URL.

`worker/wrangler.jsonc` `env.preview` currently has `workers_dev: true` and
`preview_urls: false`. Preview aliases require `preview_urls: true` and a workers.dev
subdomain (which `pawary-preview` already has). The worker uses **no Durable Objects**, so
it is eligible (DO Workers are excluded from the preview-URL beta).

`worker/package.json` pins `wrangler ^4.20.0`. `--preview-alias` requires **≥ 4.21.0**.

## Eligibility / constraints (from Cloudflare docs)

- Preview URLs (and aliases) are served only on the **workers.dev** subdomain in the
  current beta — custom domains are not supported. `pawary-preview` is on workers.dev, so
  this is fine.
- Workers using **Durable Objects** do not get preview URLs. pawary uses none.
- **Bindings are shared across versions.** A preview alias is just another version of the
  same worker, so every alias resolves the *same* `DB` (D1 `pawary-preview`), `PHOTOS`
  (R2 `pawary-photos-preview`), rate-limit namespaces, secrets, and crons. Isolation is at
  the URL/code layer only, not data.

## Components

### 1. `worker/wrangler.jsonc`: enable preview URLs on `env.preview`

- Flip `preview_urls: false → true` on `env.preview`.
- Keep `workers_dev: true` (required for the alias hostname).
- No other `env.preview` changes. `env.production` is untouched (it keeps
  `preview_urls: false`, `workers_dev: false`).

### 2. `worker/package.json`: bump wrangler

- `wrangler ^4.20.0` → a current `^4` that is **≥ 4.21.0** (use latest stable v4, e.g.
  `^4.42.0`). Run `npm install` so the lockfile updates. Verify `npx wrangler --version`
  and that `typecheck`/`test` still pass.

### 3. `.github/workflows/preview.yml`: deploy a per-branch alias + comment the URL

**Triggers**

```yaml
on:
  workflow_dispatch:
  pull_request:
    types: [labeled, synchronize, reopened]
```

**Run condition** — deploy when it is a manual dispatch, OR the label just added is
`preview`, OR the event is `synchronize`/`reopened` AND the PR already carries the
`preview` label:

```yaml
if: >-
  github.event_name == 'workflow_dispatch' ||
  github.event.label.name == 'preview' ||
  ((github.event.action == 'synchronize' || github.event.action == 'reopened') &&
   contains(github.event.pull_request.labels.*.name, 'preview'))
```

Net: identical opt-in surface to today (the `preview` label), but a labeled PR now also
refreshes its preview on subsequent pushes, and an unlabeled PR never deploys / never runs
migrations.

**Permissions** — add `pull-requests: write` (to post the sticky comment); keep
`contents: read`.

**Concurrency** — group per branch so labeled PRs are independent:

```yaml
concurrency:
  group: deploy-preview-${{ github.head_ref || github.ref_name }}
  cancel-in-progress: true
```

(`github.head_ref` is the PR branch on `pull_request` events; `github.ref_name` covers
`workflow_dispatch`.)

**Steps** (the `environment: preview` and pinned action SHAs stay as today):

1. checkout — PR head (`github.event.pull_request.head.sha`) on PR events, default ref on
   dispatch (same expression as today).
2. setup-node 22 + `npm ci` → `npm run typecheck` → `npm test` → `npm run build` (token
   absent during these, as today).
3. **Derive alias** — sanitize the branch name into a workers.dev-safe label and expose it
   as a step output (see §4).
4. **Apply pending D1 migrations** to `pawary-preview` — unchanged command:
   `npx wrangler d1 migrations apply pawary-preview --remote --env preview` (token in env).
5. **Upload version with alias** —
   `npx wrangler versions upload --env preview --preview-alias <alias>` (token in env),
   replacing the old `wrangler deploy` step.
6. **Comment the URL** — only on `pull_request` events (skip on `workflow_dispatch`, which
   has no PR): upsert one sticky comment (see §5).

### 4. Alias derivation

The alias becomes the leftmost DNS label of `<alias>-pawary-preview.okdtsk.workers.dev`,
so it must be lowercase alphanumeric + hyphens, and the whole label (`<alias>` +
`-pawary-preview`, 15 chars) must stay ≤ 63 chars. Sanitize `github.head_ref` (or
`github.ref_name` for dispatch):

- lowercase
- replace every run of non-`[a-z0-9]` with a single `-`
- strip leading/trailing `-`
- truncate to **40** chars, then strip any trailing `-` again

e.g. `feat/Calendar_UI` → `feat-calendar-ui`. Emit as a step output consumed by §3.5/§3.6.

### 5. Sticky PR comment

Use `actions/github-script` (pin SHA) to find-or-update a single comment identified by a
hidden marker, so each push updates in place rather than stacking comments:

```
<!-- pawary-preview-url -->
🔎 **Preview:** https://<alias>-pawary-preview.okdtsk.workers.dev
(branch `<head_ref>` · updated for <short-sha>)
```

The URL is constructed deterministically from the alias (we control the alias, worker name
`pawary-preview`, and subdomain `okdtsk`), avoiding brittle parsing of wrangler output.
Logic: list PR comments, match the marker, `updateComment` if found else `createComment`.

### 6. Docs

- `docs/development-workflow.md` — update the "Deploy a feature to preview for QA" section:
  the `preview` label now yields a **per-PR URL** posted as a PR comment, not the shared
  `pawary-preview.okdtsk.workers.dev`; note the shared-DB caveat and that pushes to a
  labeled PR refresh the same URL.
- `CLAUDE.md` — update the one-line preview note under "Development Workflow" to say the
  `preview` label deploys a per-PR preview URL.

## Out of scope

- Per-PR isolated databases / buckets (shared `pawary-preview` D1 + R2 is accepted).
- Auto-deploy on every PR push (intentionally label-gated to protect D1/R2).
- Custom-domain preview URLs (beta is workers.dev only).
- Alias/version garbage collection or teardown on PR close.
- Fork PRs (private repo; same-repo branches only — the comment token isn't available to
  forks anyway).

## Testing / verification

- `npm run typecheck` and `npm test` pass after the wrangler bump.
- Label a test PR `preview`: the workflow runs, uploads a version with the branch alias,
  and the preview loads at `https://<branch>-pawary-preview.okdtsk.workers.dev` with real
  Google sign-in and `__Host-session` cookie + security headers (preview already behaves
  like production per the prior preview-env design).
- A sticky PR comment appears with the URL; pushing another commit to the labeled PR
  updates the **same** comment and the **same** URL serves the new version.
- A second PR labeled `preview` gets a **different** URL and does not disturb the first.
- An unlabeled PR triggers no deploy and no migration.
- `pawary` (production) D1/R2 are never touched.
```
