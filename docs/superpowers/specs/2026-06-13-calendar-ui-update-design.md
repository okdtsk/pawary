# Calendar UI Update — Design

Date: 2026-06-13

## Goal

Improve the Calendar tab's usability with six changes:

1. 3-Day view shows **today on the right** at first paint (`[today-2, today-1, today]`).
2. A distinct **"Today" button**.
3. Optional **weekend coloring**, toggleable.
4. 3-Day view scrolls **horizontally, one day at a time** (infinite), not in 3-day jumps.
5. Timeline initial vertical position is a **configurable day-start hour** (default 7am — already the hardcoded behavior).
6. **Configurable timezone** (default: device-local).

## Decisions (from brainstorming)

- **Preference storage:** `localStorage`, client-only. No backend/DB changes.
- **Timezone scope:** **household-wide.** The chosen zone drives display/day-bucketing/hour-axis, the `tzOffsetMin` stamped on newly created activities, **and** every other feature that currently derives "today"/offset from the device zone (insights, care schedules, AI advisor, audit history, push). **Going-forward only** — existing activities keep their stored offset and simply re-bucket by display.
- **Start hour:** a real preference (default 7).
- **Today button:** a distinct button, in addition to the existing tap-the-title shortcut.
- **3-Day horizontal scroll:** **infinite**, extending the day window at the edges.
- Week and Day views keep their current paged behavior. Only the 3-Day view gets the new horizontal-scroll interaction.

## Current state (reference)

- `app/src/routes/CalendarTab.tsx` — view switcher, nav arrows, title-jump-to-today, dispatches to `Timeline`/`MonthGrid`.
- `app/src/features/calendar/Timeline.tsx` — week/3day/day hourly grid. Auto-scrolls to `7 * HOUR_PX` on range change (`Timeline.tsx:92-95`). Day columns are `flex-1` (equal width filling the container).
- `app/src/features/calendar/MonthGrid.tsx` — month grid, today highlighted.
- `app/src/lib/dates.ts` — all date math. `deviceTzOffsetMin()` is the single source of the device offset; used by `todayKey()` and (separately) at activity-create time. `viewDays("3day", anchor)` returns `[anchor, +1, +2]`. `dayStartMs/dayEndMs` build query ranges in **device-local** time.
- Preferences today: only `displayName` + `locale`, stored in DB via `/api/me` (`SettingsHome.tsx`).
- No date library; native `Date` + `Intl` only.

## Design

### 1. Preferences module — `app/src/lib/calendarPrefs.ts` (new)

Two layers so both React components and plain API modules can read the prefs:

**(a) Plain accessors (no React)** — module functions that read/write `localStorage`:

```ts
type CalendarPrefs = {
  weekendColor: boolean;   // default false
  startHour: number;       // 0..23, default 7
  timeZone: string;        // IANA name, default = device zone
};
function readCalendarPrefs(): CalendarPrefs;        // defensive parse + defaults
function writeCalendarPrefs(p: Partial<CalendarPrefs>): void;  // try/catch
function householdTimeZone(): string;              // readCalendarPrefs().timeZone
```

**(b) React hook** wrapping the accessors with `useState` + a `storage`-event listener so the UI re-renders on change:

```ts
function useCalendarPrefs(): {
  prefs: CalendarPrefs;
  setPref: <K extends keyof CalendarPrefs>(key: K, value: CalendarPrefs[K]) => void;
};
```

- One storage key, e.g. `pawary.calendarPrefs`, JSON-encoded. Missing/invalid fields fall back to defaults.
- Default `timeZone` = `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- Writers wrap `localStorage.setItem` in try/catch (private-mode safety).

The plain accessor `householdTimeZone()` lets module-level API code (insights, schedules, advisor) follow the chosen zone without a React hook.

### 2. Timezone helpers — `app/src/lib/dates.ts`

Add a DST-correct offset helper and thread an explicit timezone through the "device clock" functions:

```ts
/** Minutes east of UTC for an IANA zone at a given instant (DST-correct). */
export function tzOffsetMinFor(timeZone: string, atMs: number): number;
```

Implementation: format `atMs` in `timeZone` via `Intl.DateTimeFormat` parts and diff against UTC (standard "formatToParts" offset trick), rounded to minutes.

Add a household-zone convenience that composes the accessor + helper:

```ts
/** Offset (min east of UTC) for the household zone at an instant; default = device. */
export function householdTzOffsetMin(atMs: number = Date.now()): number;
// = tzOffsetMinFor(householdTimeZone(), atMs)
```

Refactors:
- `todayKey(now?, tzOffsetMin?)` — accept an explicit offset; default keeps `deviceTzOffsetMin()` so any unconverted caller is unaffected. Calendar + converted callers pass `householdTzOffsetMin(now)`.
- `dayStartMs(key, tzOffsetMin?)` / `dayEndMs(key, tzOffsetMin?)` — when an offset is supplied, compute the day's UTC boundaries for that household zone: `start = Date.UTC(y,m-1,d) - tzOffsetMin*60000`, `end = start + 86_400_000 - 1`. Default (no offset) keeps current device-local behavior for non-calendar callers.
- `rangeMs(days, tzOffsetMin?)` — pass the offset through to `dayStartMs/dayEndMs`.
- `viewDays("3day", anchor)` → `[addDays(anchor,-2), addDays(anchor,-1), anchor]`.

`deviceTzOffsetMin()` stays as the default. No behavior change for callers that don't pass a zone.

### 3. Household-wide timezone rollout — replace `deviceTzOffsetMin()` call sites

Every site that uses `deviceTzOffsetMin()` to mean "the household's current offset" switches to `householdTzOffsetMin()` (which defaults to the device zone, so behavior is identical until the user changes the setting). Going-forward only — existing stored offsets are untouched. Sites:

- **New-activity stamping:** `features/add/ActivityForm.tsx:119,127`, `features/quickadd/QuickAddGrid.tsx:58`.
- **Care schedules:** `features/health/useCompleteWithUndo.ts:28`, `features/health/CareScheduleList.tsx:40`, `api/schedules.ts:25`.
- **Insights / anomalies:** `api/insights.ts:12,23`.
- **AI advisor:** `api/advisor.ts:109`, `routes/Advisor.tsx:332`.
- **Audit history:** `routes/settings/AuditHistory.tsx:21`.
- **Push registration:** `features/pwa/NotificationsCard.tsx:64`.

Where a site needs the offset "now", `householdTzOffsetMin()` (default `Date.now()`); where it's per-instant (e.g. `dayKeyOf(ms, …)`), pass that instant. `deviceTzOffsetMin()` remains exported as the raw device fallback used internally by the default arg.

### 4. Timeline — 2D scroll + infinite 3-day window

For the **3-day view only**, replace the equal-width `flex-1` columns with a horizontally-scrollable, snap-aligned window:

- Container: single element with `overflow-x-auto overflow-y-auto`, `scroll-snap-type: x mandatory`.
- Hour-axis gutter: `sticky left-0` (and top-left corner sticky both axes).
- Day headers: `sticky top-0`, scroll horizontally with their columns.
- Each day column: fixed width = `containerWidth / 3` (measured via `ResizeObserver` / ref), `scroll-snap-align: start`.
- Initial scroll: horizontal so **today is the rightmost** of the 3 visible (`scrollLeft = (todayIndex - 2) * colWidth`); vertical `scrollTop = startHour * HOUR_PX`.

**Infinite window:**
- State `windowDays: DayKey[]`, initialized to a generous span centered so the anchor is near the right (e.g. anchor-20 .. anchor+4).
- On horizontal scroll, when within ~3 columns of the **left** edge: prepend N days and bump `scrollLeft += N*colWidth` (same frame, to avoid a visible jump). When within ~3 of the **right** edge: append N days. Trim the opposite edge to bound total size (~60 days), adjusting `scrollLeft` symmetrically so position is preserved.
- Activities fetched for the current `windowDays` range via `useActivitiesRange(petId, rangeMs(windowDays, hhOffset))`. React Query keys by from/to; extending refetches the wider range.
- The URL `date` anchor updates (debounced, on scroll-end) to the **leftmost visible** day, so deep-links and the Today button stay coherent.
- Drop `useSwipe` for the 3-day view (native horizontal scroll replaces it). Week/Day keep `useSwipe` + paged `flex-1` rendering.

The week/day rendering path stays as-is; the component branches on `view === "3day"`.

`startHour` (from prefs) replaces the hardcoded `7` in the initial-scroll effect for all timeline views.

### 5. Weekend coloring

- Helper `isWeekend(key: DayKey): boolean` in `dates.ts` via `getUTCDay()` (0=Sun, 6=Sat).
- When `prefs.weekendColor` is on, apply a subtle tint (a `bg-*`/header text class) to:
  - Timeline weekend day columns + their headers.
  - MonthGrid weekend cells.
- Off by default → zero visual change.

### 6. "Today" button

- A distinct pill button in `CalendarTab.tsx` near the nav arrows (e.g. a small "Today" button on the arrow row), calling the existing `setParams(view, todayKey(...))` with the household offset. Existing title-jump retained.

### 7. Settings UI — `app/src/routes/settings/SettingsHome.tsx`

New **"Calendar"** section:
- Weekend-color toggle.
- Day-start-hour select (0–23, default 7).
- Timezone select — `Intl.supportedValuesOf("timeZone")` when available, else a curated short list incl. the device zone; default = device zone.

Reads/writes via `useCalendarPrefs()`. No `/api/me` change.

### 8. i18n

Add en/ja strings for: "Today" button (reuse `common.today` if present), "Calendar" settings section, "Highlight weekends", "Day start hour", "Timezone".

## Files touched

- `app/src/lib/calendarPrefs.ts` (new)
- `app/src/lib/dates.ts` (tz helpers, `viewDays` 3-day order, `isWeekend`)
- `app/src/features/calendar/Timeline.tsx` (2D/infinite 3-day scroll, startHour, weekend tint)
- `app/src/routes/CalendarTab.tsx` (Today button, household offset, 3-day window wiring)
- `app/src/features/calendar/MonthGrid.tsx` (weekend tint)
- `householdTzOffsetMin()` rollout across: `features/add/ActivityForm.tsx`, `features/quickadd/QuickAddGrid.tsx`, `features/health/useCompleteWithUndo.ts`, `features/health/CareScheduleList.tsx`, `api/schedules.ts`, `api/insights.ts`, `api/advisor.ts`, `routes/Advisor.tsx`, `routes/settings/AuditHistory.tsx`, `features/pwa/NotificationsCard.tsx`
- `app/src/routes/settings/SettingsHome.tsx` (Calendar settings section)
- i18n files (en/ja)

## Testing

- `dates.ts` unit tests: `tzOffsetMinFor` (incl. a DST-observing zone like `America/New_York` across a transition), `viewDays("3day")` new order, `dayStartMs/dayEndMs` with explicit offset, `isWeekend`.
- Manual: 3-day infinite scroll both directions (no jump at edges), today-on-right initial paint, Today button, weekend toggle on/off, start-hour change, timezone change re-buckets display and stamps new activities going forward.
- `npm run typecheck` and `npm run test` green.

## Out of scope / YAGNI

- No DB persistence / cross-device sync of calendar prefs.
- No migration of existing activities' `tzOffsetMin`.
- No horizontal-scroll change to Week/Day views.
- No per-pet preferences (account-wide via localStorage).
