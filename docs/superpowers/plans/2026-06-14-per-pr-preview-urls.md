# Per-PR Preview URLs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `preview` label deploy each PR to its own stable preview URL (`https://<branch>-pawary-preview.okdtsk.workers.dev`) instead of overwriting the single shared `pawary-preview.okdtsk.workers.dev`.

**Architecture:** Switch the preview workflow from `wrangler deploy` to `wrangler versions upload --preview-alias <branch>`, which exposes a new version of the *same* `pawary-preview` worker at a per-branch URL (bindings/D1/R2 stay shared). Keep the `preview` label as the opt-in trigger so D1/R2 are only touched intentionally, and post the URL back as a sticky PR comment.

**Tech Stack:** Cloudflare Workers preview URLs, Wrangler v4 (`versions upload --preview-alias`), GitHub Actions (`actions/github-script` for the PR comment).

---

## Background the engineer needs

- The repo is a Cloudflare Worker (`worker/`) that also serves a built SPA (`app/dist`). One worker named `pawary` (production) and `pawary-preview` (preview env) defined in `worker/wrangler.jsonc` under `env.production` / `env.preview`.
- **Preview aliases** (Cloudflare): `wrangler versions upload --env preview --preview-alias foo` uploads a version of `pawary-preview` and serves it at `https://foo-pawary-preview.okdtsk.workers.dev`. The version does NOT take over the worker's main traffic. Requires `preview_urls: true` + a workers.dev subdomain (both satisfied after Task 1) and Wrangler ≥ 4.21.0 (the lockfile already resolves to 4.98.0).
- A preview alias is just another *version* of the same worker, so every alias shares the same `DB` (D1 `pawary-preview`), `PHOTOS` (R2 `pawary-photos-preview`), secrets, rate limits, and crons. Isolation is URL/code only, not data — this is accepted.
- The workers.dev subdomain for this account is `okdtsk` (current preview URL is `pawary-preview.okdtsk.workers.dev`), so the per-branch URL can be constructed deterministically without parsing wrangler output.
- Spec: `docs/superpowers/specs/2026-06-14-per-pr-preview-urls-design.md`.

## File Structure

- **Modify** `worker/wrangler.jsonc` — flip `preview_urls` to `true` on `env.preview`.
- **Modify** `worker/package.json` — raise the `wrangler` floor to `^4.21.0` (documents the hard requirement; no lockfile change expected).
- **Rewrite** `.github/workflows/preview.yml` — trigger logic, alias derivation, `versions upload`, PR comment.
- **Modify** `docs/development-workflow.md` — describe per-PR URLs.
- **Modify** `CLAUDE.md` — one-line preview note.

Work happens on branch `feat/per-pr-preview-urls` (already created; the spec commit is its first commit).

---

## Task 1: Enable preview URLs on the preview env

**Files:**
- Modify: `worker/wrangler.jsonc` (the `env.preview` block, `preview_urls` key)

- [ ] **Step 1: Make the change**

In `worker/wrangler.jsonc`, inside `"env": { "preview": { ... } }`, change:

```jsonc
"preview_urls": false,
```

to:

```jsonc
"preview_urls": true,
```

Leave `"workers_dev": true` as-is. Do **not** touch `env.production` (it keeps `"preview_urls": false`, `"workers_dev": false`). There is exactly one `preview_urls: false` line inside `env.preview` and one inside `env.production` — only change the one in `env.preview`.

- [ ] **Step 2: Verify the config still parses and types pass**

Run from repo root:
```bash
node -e "JSON.parse(require('fs').readFileSync('worker/wrangler.jsonc','utf8').replace(/\/\/.*$/gm,'').replace(/,(\s*[}\]])/g,'\$1'))" && echo JSONC_OK
npm run typecheck
```
Expected: `JSONC_OK` printed, and typecheck exits 0.

- [ ] **Step 3: Confirm exactly the intended line changed**

Run:
```bash
git diff worker/wrangler.jsonc
```
Expected: a single hunk flipping `preview_urls` from `false` to `true` within the `preview` env. No change inside the `production` env.

- [ ] **Step 4: Commit**

```bash
git add worker/wrangler.jsonc
git commit -m "feat: enable preview URLs on the preview worker env"
```

---

## Task 2: Raise the wrangler version floor

**Files:**
- Modify: `worker/package.json` (`devDependencies.wrangler`)

- [ ] **Step 1: Make the change**

In `worker/package.json`, change the wrangler range:

```json
"wrangler": "^4.20.0"
```

to:

```json
"wrangler": "^4.21.0"
```

(`--preview-alias` requires ≥ 4.21.0. Check whether wrangler is under `devDependencies` or `dependencies` and edit the one that exists.)

- [ ] **Step 2: Refresh package.json bookkeeping without churning the lockfile**

Run from `worker/`:
```bash
cd worker && npm install --package-lock-only && cd ..
```
Expected: completes without errors. The installed/locked version is already 4.98.0, which satisfies `^4.21.0`, so `package-lock.json` should be unchanged or only trivially touched.

- [ ] **Step 3: Verify the resolved version satisfies the floor**

Run:
```bash
cd worker && npx wrangler --version && cd ..
```
Expected: prints a `4.x` version ≥ 4.21.0 (currently `4.98.0`).

- [ ] **Step 4: Commit**

```bash
git add worker/package.json worker/package-lock.json
git commit -m "chore: require wrangler >=4.21 for preview-alias support"
```

(If `package-lock.json` was not modified, omit it from the `git add`.)

---

## Task 3: Verify the alias-derivation logic in isolation

The one piece of real logic in the workflow is sanitizing a branch name into a workers.dev-safe alias. Pin it down with a runnable test before wiring it into CI.

**Files:**
- Create (temporary, not committed): `/tmp/alias-test.sh`

- [ ] **Step 1: Write the test script**

Create `/tmp/alias-test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

derive() {
  echo "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' \
    | cut -c1-40 \
    | sed -E 's/-+$//'
}

check() {
  local input="$1" expected="$2" got
  got=$(derive "$input")
  if [ "$got" = "$expected" ]; then
    echo "ok: '$input' -> '$got'"
  else
    echo "FAIL: '$input' -> '$got' (expected '$expected')"; exit 1
  fi
}

check "feat/Calendar_UI"            "feat-calendar-ui"
check "fix/bug-123"                 "fix-bug-123"
check "FEAT/Per_PR.Preview"         "feat-per-pr-preview"
check "release/2026-06-14"          "release-2026-06-14"
check "a-very-long-branch-name-that-definitely-exceeds-the-forty-character-cap" "a-very-long-branch-name-that-definitely"
echo "ALL PASS"
```

- [ ] **Step 2: Run it to confirm the pipeline behaves**

Run:
```bash
bash /tmp/alias-test.sh
```
Expected: five `ok:` lines then `ALL PASS`. (Note the long-name case truncates to 40 chars and re-strips any trailing hyphen.)

- [ ] **Step 3: No commit**

This is a throwaway verification of the sed pipeline used verbatim in Task 4. Nothing to commit. Delete with `rm /tmp/alias-test.sh` if you like.

---

## Task 4: Rewrite the preview workflow

**Files:**
- Modify (full rewrite): `.github/workflows/preview.yml`

- [ ] **Step 1: Replace the file contents**

Overwrite `.github/workflows/preview.yml` with exactly:

```yaml
name: Preview

on:
  # Manual fallback: Actions -> Preview -> Run workflow -> pick a branch.
  workflow_dispatch:
  # QA signal: add the `preview` label to a PR to deploy its branch to a
  # per-PR preview URL. Pushes/reopens on an already-labeled PR refresh it.
  pull_request:
    types: [labeled, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    # Deploy on a manual run, when the `preview` label is added, or when an
    # already-labeled PR is updated/reopened. Unlabeled PRs never deploy, so
    # D1/R2 are only touched when a PR is explicitly opted into preview.
    if: >-
      github.event_name == 'workflow_dispatch' ||
      github.event.label.name == 'preview' ||
      ((github.event.action == 'synchronize' || github.event.action == 'reopened') &&
       contains(github.event.pull_request.labels.*.name, 'preview'))
    # the CLOUDFLARE_API_TOKEN secret lives in this environment; unlike
    # `production` it is NOT branch-restricted, so any feature branch can deploy
    environment: preview
    # one preview deploy per branch at a time; a newer push supersedes an older
    # queued one, but different PRs deploy independently to their own alias
    concurrency:
      group: deploy-preview-${{ github.head_ref || github.ref_name }}
      cancel-in-progress: true
    steps:
      - uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5
        with:
          # For a PR, deploy the PR's head commit; for a manual run, checkout
          # defaults to the selected branch.
          ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.ref }}
      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      # Derive a workers.dev-safe alias from the branch name: lowercase,
      # non-alphanumeric -> '-', trim hyphens, cap at 40 chars. The full DNS
      # label '<alias>-pawary-preview' must stay <= 63 chars.
      - name: Derive preview alias
        id: alias
        env:
          BRANCH: ${{ github.head_ref || github.ref_name }}
        run: |
          alias=$(echo "$BRANCH" \
            | tr '[:upper:]' '[:lower:]' \
            | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' \
            | cut -c1-40 \
            | sed -E 's/-+$//')
          echo "alias=$alias" >> "$GITHUB_OUTPUT"
          echo "url=https://$alias-pawary-preview.okdtsk.workers.dev" >> "$GITHUB_OUTPUT"
      # npm ci and the build above run WITHOUT the API token in env, so
      # dependency (post)install scripts never see deploy credentials
      - name: Apply pending D1 migrations
        working-directory: worker
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: 15e92cf7a2d85b77cd798213277382d2
        run: npx wrangler d1 migrations apply pawary-preview --remote --env preview
      # versions upload (NOT deploy): serves this version at the per-branch
      # preview alias without taking over pawary-preview's main traffic.
      - name: Upload preview version
        working-directory: worker
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: 15e92cf7a2d85b77cd798213277382d2
        run: npx wrangler versions upload --env preview --preview-alias "${{ steps.alias.outputs.alias }}"
      # Post the stable per-branch URL back to the PR as a sticky comment
      # (updated in place on each push). Skipped on manual workflow_dispatch
      # runs, which have no associated PR.
      - name: Comment preview URL on PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea # v7.0.1
        env:
          PREVIEW_URL: ${{ steps.alias.outputs.url }}
          HEAD_REF: ${{ github.head_ref }}
          HEAD_SHA: ${{ github.event.pull_request.head.sha }}
        with:
          script: |
            const marker = '<!-- pawary-preview-url -->';
            const url = process.env.PREVIEW_URL;
            const branch = process.env.HEAD_REF;
            const sha = process.env.HEAD_SHA.slice(0, 7);
            const body = `${marker}\n🔎 **Preview:** ${url}\n(branch \`${branch}\` · updated for ${sha})`;
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const existing = comments.find((c) => c.body.includes(marker));
            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existing.id,
                body,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body,
              });
            }
```

- [ ] **Step 2: Validate the workflow YAML**

Run from repo root (uses `actionlint` if installed, else falls back to a YAML parse):
```bash
if command -v actionlint >/dev/null 2>&1; then
  actionlint .github/workflows/preview.yml
else
  npx --yes js-yaml .github/workflows/preview.yml >/dev/null && echo YAML_OK
fi
```
Expected: `actionlint` prints nothing and exits 0, OR `YAML_OK` is printed. Fix any reported syntax errors before continuing.

- [ ] **Step 3: Sanity-check the diff against the old workflow**

Run:
```bash
git diff .github/workflows/preview.yml
```
Expected to confirm: trigger types now `[labeled, synchronize, reopened]`; a top-level `permissions` block with `pull-requests: write`; concurrency group is per-branch; the old `Deploy worker` (`wrangler deploy`) step is gone, replaced by `Upload preview version` (`wrangler versions upload --preview-alias`); a `Derive preview alias` step and a `Comment preview URL on PR` step are present.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/preview.yml
git commit -m "feat: deploy each labeled PR to a per-branch preview URL"
```

---

## Task 5: Update the docs

**Files:**
- Modify: `docs/development-workflow.md:66-90` (the "Preview / QA process" section)
- Modify: `CLAUDE.md:57-58` (the preview bullet)

- [ ] **Step 1: Update `docs/development-workflow.md`**

Replace the section spanning the `## Preview / QA process` heading through the `wrangler d1 execute ... "<sql>"` line (current lines 66–90) with:

```markdown
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
```

- [ ] **Step 2: Update `CLAUDE.md`**

Replace lines 57–58:

```markdown
- For QA, add the **`preview`** label to a PR to deploy its branch to the shared
  preview environment (manual fallback: Actions → Preview → Run workflow).
```

with:

```markdown
- For QA, add the **`preview`** label to a PR to deploy it to a per-PR preview
  URL (`https://<branch>-pawary-preview.okdtsk.workers.dev`), posted as a PR
  comment (manual fallback: Actions → Preview → Run workflow). All previews
  share one `pawary-preview` D1/R2.
```

- [ ] **Step 3: Verify the edits landed and nothing else changed**

Run:
```bash
git diff docs/development-workflow.md CLAUDE.md
```
Expected: only the preview sections changed; wording matches the blocks above; no stray edits elsewhere.

- [ ] **Step 4: Commit**

```bash
git add docs/development-workflow.md CLAUDE.md
git commit -m "docs: describe per-PR preview URLs"
```

---

## Task 6: Final verification and PR

- [ ] **Step 1: Full local gate**

Run from repo root:
```bash
npm run typecheck && npm test
```
Expected: both pass (these are what CI's `test` check runs).

- [ ] **Step 2: Review the full branch diff**

Run:
```bash
git log --oneline main..HEAD
git diff main..HEAD --stat
```
Expected commits: spec doc, enable preview URLs, wrangler floor bump, workflow rewrite, docs. Changed files limited to: `worker/wrangler.jsonc`, `worker/package.json` (+ maybe lockfile), `.github/workflows/preview.yml`, `docs/...`, `CLAUDE.md`.

- [ ] **Step 3: Push and open the PR (with confirmation)**

Per repo convention, all changes ship via PR. Confirm with the user before pushing, then:
```bash
git push -u origin feat/per-pr-preview-urls
gh pr create --title "feat: per-PR preview URLs" --body "$(cat <<'EOF'
## Summary
- Each labeled PR now deploys to its own stable preview URL (`https://<branch>-pawary-preview.okdtsk.workers.dev`) via `wrangler versions upload --preview-alias`, instead of overwriting the single shared `pawary-preview.okdtsk.workers.dev`.
- Trigger stays the `preview` label (now also refreshes on pushes to an already-labeled PR); unlabeled PRs never touch the shared D1/R2.
- The preview URL is posted as a sticky PR comment.

Design: `docs/superpowers/specs/2026-06-14-per-pr-preview-urls-design.md`

## End-to-end verification (after merge or on this PR)
- Add the `preview` label → workflow uploads a version with the branch alias and comments the URL.
- The URL loads with real Google sign-in + `__Host-session` cookie / security headers.
- Push another commit → same comment + same URL serves the new version.
- A second labeled PR gets a different URL and does not disturb the first.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: End-to-end check on the PR itself**

After the PR exists, add the `preview` label to **this** PR and watch the `Preview` workflow run (`gh run watch` or the Actions tab). Confirm:
- the run succeeds,
- a sticky comment with `https://feat-per-pr-preview-urls-pawary-preview.okdtsk.workers.dev` appears,
- that URL loads the app and Google sign-in works.

This is the real validation that the alias upload + comment path works; it can only run once the workflow exists on a branch GitHub can trigger.

---

## Notes / gotchas

- **Worktree path:** edits must land under the worktree at `.../pawary/.claude/worktrees/preview`, not the main checkout. Verify `git -C . rev-parse --show-toplevel` points at the worktree before committing.
- **Fork PRs** won't get the comment (the `pull-requests: write` token isn't shared with forks) and the `preview` environment secret is unavailable to them. The repo is private with same-repo branches, so this isn't a concern today.
- **Stale aliases:** merged/closed PRs leave their alias pointing at the last version. Harmless; no cleanup is in scope.
- **`github.event.label` on non-label events:** on `synchronize`/`reopened`, `github.event.label` is null, so `github.event.label.name == 'preview'` is simply false — the `contains(... labels ...)` clause handles those events instead.
```
