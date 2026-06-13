# Calendar UI — Follow-ups & Improvements

Captured during the live browser verification of the calendar UI update
(PR #12, branch `feat/calendar-ui-update`). These are intentionally **out of
scope** for that PR (which shipped the 6 requested features + the 3-day
initialization fix). Listed here for a future pass.

## Functional / UX

- **Water (and likely other categories) silently fails to save without "Amount".**
  The Food form labels its amount "Amount (optional)", but the Water form labels
  it "Amount (ml)" (required) — saving Water with an empty amount produced **no
  visible validation error** and the entry did not persist. Either surface the
  validation message inline on submit, or make the field optional.
  - Repro: Add activity → Water → Save without entering an amount → modal stays / no toast, nothing in Log.
  - Likely in `app/src/features/add/ActivityForm.tsx` (build/validate) — the error path isn't shown to the user.

- **Multi-chip lane placement not visually verified.** Only a single activity
  existed during verification, so overlapping-activity lane splitting
  (`placeItems` → `laneCount`/`lane` in `lib/timeline.ts`, rendered by
  `DayColumnBody`) wasn't exercised end-to-end. Worth a manual check with 2–3
  activities within the same ~1h window (e.g. 08:00, 08:10, 08:20) across Day /
  3-day / Week views.

- **Timezone picker UX.** The timezone `<select>` lists ~600 raw IANA names
  (e.g. `America/Indiana/Indianapolis`). On mobile (the primary target) this is
  hard to navigate. Consider a searchable/filterable control or `<optgroup>` by
  region. (`app/src/routes/settings/SettingsHome.tsx`)

## Code cleanups

- **Dead loading guard in `ThreeDayTimeline.tsx`.** The spinner branch
  `activities.isLoading && windowDays.length === 0` can never render the
  spinner because `windowDays` is seeded non-empty (29 days) at init. The grid
  shows immediately with empty columns and chips pop in — acceptable, but the
  guard is misleading. Either drop it or change to a "first load with no data"
  condition if a spinner is desired.

- **Unused i18n key `calendar.settings.timezoneSystem`.** Defined in
  `messages.ts` / `en.ts` / `ja.ts` ("Match device" / "端末に合わせる") but never
  referenced in the UI (the timezone select has no explicit "match device"
  option; the default already resolves to the device zone). Either wire it up as
  a first option or remove the key from all three files.

## Testing / infra

- **Worker test suite couldn't run in the dev sandbox.**
  `@cloudflare/vitest-pool-workers` (workerd) fails to start its isolated
  runtime here (`connect(): Connection refused` / "Fallback service failed to
  fetch module"). This is an **environment limitation**, not a code issue — no
  worker code was changed by PR #12, and `wrangler dev` itself runs fine. CI
  (proper environment) should exercise the worker tests.

- **3-day scroll regression coverage.** The initialization/edge-extension logic
  is hard to unit-test in jsdom (real layout + `scroll-snap` + `scrollend`).
  A lighter regression test around the pure window math would still help:
  `makeWindow` length/ordering, and the prepend/append index arithmetic
  (the "+EXTEND_BY on prepend, −trim on append" scroll-correction invariants).
  Consider extracting that arithmetic into a pure helper so it's testable
  without a DOM.
