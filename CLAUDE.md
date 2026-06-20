This repository is for an iOS/Web application to manage pet activity log and its health.
This application provides basically mobile-first view, but also easily useful for desktop too.

# Features for a pet management

## Pet Activity Log

In this feature, a user can add and manage any activity log related to a pet easily.

### Data

The term "activity" is like "Food", "Toilet", "Water", "Weight", "Activity", "Symptom", "Medicines", "Veterinarian", and you AI can add any possible categories.
(You can change the category name for best design UI)

Each action should have its time and memo, photos.
Also each action can have its own field like food name, medicine type, hospital location.

### Input

- Add: A user can add above activities easily.
- Edit: A user can edit any activity items.
- Delete: A user can delete any activity items.
- Quick Add: A user can quickly add pre-defined or recently used activity only by few clicks/taps.

### View

- Monthly View: Like monthly calendar. A user can see all activity log by clicking a day. Also change the month by swiping.
- Weekly View: Like timeline. A user can change the range of days by swiping.
- 3-Days View: Like timeline. A user can change the range of days by swiping.
- Day view: Like timeline. A user can change the range of days by swiping.
- Log view: Just stack all activities sorted by time. Also a user can set a filter based on activity categories.

## Pet Health Analyzer

Based on recent activities and its detailed values, the application analyze recent the pet's trend visually.

## AI Advisor

If a user can set an AI service API settings (like OpenAI API, Gemini API, Claude API), user can ask anything related to the pet based on recent activities.

# Additional Features/Requirements

- A user can manage multiple pets simultaniously.
- A user can create its own account by Google OAuth.
- A user can manage the pets with other account users. (multiple permnission level, just share or co-editing)
- This application has proper security layer as a modern mobile application.

# Development Workflow

All changes ship via GitHub pull request — never push directly to `main`.
(Enforcement via branch protection needs GitHub Pro on a private repo, so this
is currently by convention.) Full process in `docs/development-workflow.md`.

- Branch off `main`, open a PR; CI runs `typecheck` + `test` on every PR.
- Wait for the `test` check to be green before merging; self-merge is allowed (no approval required).
- Merging to `main` auto-deploys to production.
- For QA, add the **`preview`** label to a PR to deploy it to a per-PR preview
  URL (`https://<branch>-pawary-preview.okdtsk.workers.dev`), posted as a PR
  comment (manual fallback: Actions → Preview → Run workflow). All previews
  share one `pawary-preview` D1/R2.

## Architecture Decision Records (ADR)

Record every significant technical decision in `docs/adr.html` — a single,
self-contained HTML file humans can open in a browser to review past decisions
and the reasoning behind them.

- **When:** any PR that makes a notable architectural choice (stack, auth,
  data model, security posture, infra/workflow, a new subsystem, or replacing
  an existing approach). Skip purely cosmetic or trivial changes.
- **How:** append one object to the `ADRS` array near the bottom of
  `docs/adr.html`. Use `id = current max + 1`; fill `title`, `date`
  (`YYYY-MM-DD`), `status` (`accepted`/`proposed`), `tags`, and the
  `context` / `decision` / `consequences` fields. Add `pr` when there is a PR.
- **Superseding:** when a new decision replaces an old one, set the old entry's
  `status` to `superseded` and its `supersededBy` to the new `id` — never delete
  history.
- Update the ADR in the **same PR** as the change it documents.

