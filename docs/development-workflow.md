# Development Workflow

All changes to Pawary ship through GitHub pull requests. This keeps `main`
always-deployable and gives every change a reviewable history and a QA
opportunity before it reaches production.

> **Enforcement note:** technical enforcement (blocking direct pushes, requiring
> a green CI check before merge) needs GitHub branch protection or rulesets,
> which require **GitHub Pro** for a private repo (or making the repo public).
> Neither is enabled yet, so for now the PR-only rule is **by convention** — the
> tooling does not block a direct push to `main`. See "Enabling enforcement"
> below.

## Branch → PR → QA → merge

1. **Branch.** Create a feature branch off the latest `main`
   (e.g. `feat/weekly-view`, `fix/oauth-redirect`, `chore/...`).
2. **Open a PR** into `main`. CI (`.github/workflows/ci.yml`) runs `typecheck`
   and `test` on every PR automatically.
3. **QA on preview when ready** (see below). Optional for trivial changes,
   expected for anything user-facing.
4. **Merge.** Once the `test` check is green, squash-merge into `main`.
   - Wait for the `test` check to be green before merging (convention).
   - No separate approval is required — you can merge your own PR.
   - Merging to `main` auto-deploys to **production** (`pawary.okdtsk.dev`) via
     the `deploy` job, which also applies pending D1 migrations.

### Enabling enforcement (optional, requires GitHub Pro or public repo)

The intended rule once enforceable:

- Pull request required; direct pushes to `main` rejected.
- The `test` status check must pass before merging.
- Required approving reviews: 0 (self-merge allowed for solo/family dev).

This needs GitHub branch protection or a repository ruleset, which on a
**private** repo require a paid plan (GitHub Pro). To turn it on after upgrading
(or after making the repo public), create a ruleset targeting the default branch
with a `pull_request` rule (0 approvals) and a `required_status_checks` rule for
the `test` check — repo **Settings → Rules → Rulesets**, or via `gh api`:

```bash
gh api -X POST repos/okdtsk/pawary/rulesets --input - <<'JSON'
{
  "name": "main: PR + CI required",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [ { "context": "test" } ] } }
  ]
}
JSON
```

## Preview / QA process

There is one production-faithful **preview** Worker — `pawary-preview`, with its
own D1 (`pawary-preview`) and R2 (`pawary-photos-preview`), fully isolated from
production data. It runs with production-grade security (secure `__Host-session`
cookies, HSTS), so it mirrors prod behavior.

### Deploy a feature to preview for QA

**Primary — the `preview` label:** add the **`preview`** label to the PR. This
triggers `.github/workflows/preview.yml`, which tests, builds, applies pending
D1 migrations to `pawary-preview`, and uploads the PR's head commit as a new
Worker *version* served at a **per-PR preview URL**:
`https://<branch>-pawary-preview.okdtsk.workers.dev`. The URL is posted as a
sticky comment on the PR. Pushing more commits to a labeled PR refreshes the
same comment and the same URL. Unlabeled PRs never deploy.

**Fallback — manual:** GitHub → **Actions → Preview → Run workflow** → pick the
branch. (No PR comment is posted for manual runs; the URL is
`https://<branch>-pawary-preview.okdtsk.workers.dev`.)

Each PR gets its **own** URL, so labeling one PR no longer overwrites another's
preview. They are independent at the URL/code layer — but all preview versions
**share the one `pawary-preview` D1 + R2**. Because of that, only labeled PRs
ever run migrations against the shared DB; if two labeled PRs apply divergent
migrations, they still share that database. Coordinate schema-changing PRs.

QA at the per-PR URL above. Only real Google sign-in is available there (no dev
sign-in), and changes never touch production data. Reset preview data anytime
with
`wrangler d1 execute pawary-preview --remote --env preview --command "<sql>"`.

## Hotfixes

Same flow — branch, PR, green CI, merge. If enforcement is later enabled and an
emergency requires bypassing it, temporarily relax the ruleset in repo settings
rather than normalizing direct pushes to `main`.

## Related docs

- `docs/visibility-strategy.md` — how the app is kept private and how to go public.
- `README.md` — stack, local dev, and production deployment details.
- `docs/superpowers/specs/2026-06-13-preview-environment-design.md` — preview env design.
