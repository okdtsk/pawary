# Development Workflow

All changes to Pawary ship through GitHub pull requests. Direct pushes to `main`
are blocked by branch protection. This keeps `main` always-deployable and gives
every change a reviewable history and a QA opportunity before it reaches
production.

## Branch → PR → QA → merge

1. **Branch.** Create a feature branch off the latest `main`
   (e.g. `feat/weekly-view`, `fix/oauth-redirect`, `chore/...`).
2. **Open a PR** into `main`. CI (`.github/workflows/ci.yml`) runs `typecheck`
   and `test` on every PR automatically.
3. **QA on preview when ready** (see below). Optional for trivial changes,
   expected for anything user-facing.
4. **Merge.** Once the `test` check is green, squash-merge into `main`.
   - A green CI run is **required** before merging.
   - No separate approval is required — you can merge your own PR.
   - Merging to `main` auto-deploys to **production** (`pawary.okdtsk.dev`) via
     the `deploy` job, which also applies pending D1 migrations.

### Branch protection on `main` (enforced)

- Pull request required; direct pushes are rejected.
- The `test` status check must pass before merging.
- Required approving reviews: 0 (self-merge allowed for solo/family dev).

To tighten later (e.g. require 1 approval once there are more collaborators),
update the rule under repo **Settings → Branches → `main`**, or via
`gh api`.

## Preview / QA process

There is one shared, production-faithful **preview** environment — Worker
`pawary-preview`, its own D1 (`pawary-preview`) and R2 (`pawary-photos-preview`),
fully isolated from production data. It runs with production-grade security
(secure `__Host-session` cookies, HSTS), so it mirrors prod behavior.

### Deploy a feature to preview for QA

**Primary — the `preview` label:** add the **`preview`** label to the PR. This
triggers `.github/workflows/preview.yml`, which tests, builds, applies pending
D1 migrations to `pawary-preview`, and deploys the PR's head commit to preview.

**Fallback — manual:** GitHub → **Actions → Preview → Run workflow** → pick the
branch.

Because preview is a **single shared environment**, the latest deploy wins —
only one branch can be under QA at a time. Re-adding the label (remove then add)
re-deploys after new commits. Coordinate if more than one feature needs QA.

QA at: `https://pawary-preview.<acct>.workers.dev` (the `Deploy worker` step in
the run logs prints the exact URL). Only real Google sign-in is available there
(no dev sign-in), and changes never touch production data. Reset preview data
anytime with
`wrangler d1 execute pawary-preview --remote --env preview --command "<sql>"`.

## Hotfixes

Same flow — branch, PR, green CI, merge. The branch protection has no admin
bypass configured by default; if an emergency requires it, temporarily relax the
rule in repo settings rather than pushing around it.

## Related docs

- `docs/visibility-strategy.md` — how the app is kept private and how to go public.
- `README.md` — stack, local dev, and production deployment details.
- `docs/superpowers/specs/2026-06-13-preview-environment-design.md` — preview env design.
