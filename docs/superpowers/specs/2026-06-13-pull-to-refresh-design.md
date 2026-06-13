# Pull-to-Refresh Design

**Date:** 2026-06-13
**Status:** Approved (design)

## Problem

Pawary is installed as a PWA, where the browser's reload button is absent. Users
have no way to manually refresh stale data. We add a Twitter-style pull-down
gesture: drag the view down from the top to refresh.

## Requirements

- **Scope:** Global — active on every tab (Home, Calendar, Log, Health, Settings
  and sub-pages), implemented once in `Shell`.
- **Refresh action:** Refetch all active queries via
  `queryClient.refetchQueries({ type: "active" })`. Always-correct, no per-route
  key bookkeeping. The gesture awaits completion so the spinner reflects reality.
- **Platform:** Touch only. Desktop is unaffected.

## Behavior

1. The page itself is the scroll container (`Shell` uses a sticky header + normal
   document flow), so the gesture reads `window.scrollY`.
2. A pull engages only when scrolled to the very top (`window.scrollY <= 0`) and
   the finger moves downward. Otherwise normal scrolling is untouched — mirrors
   the non-interference approach in the existing `useSwipe` hook.
3. While pulling, an indicator (paw spinner) follows the finger with resistance
   damping (raw delta × 0.5, capped). `touchmove` calls `preventDefault` only
   once a downward pull is committed at the top, suppressing iOS overscroll
   bounce without breaking normal scroll.
4. Releasing past a ~64px threshold triggers `onRefresh`; status stays
   `refreshing` (spinner active) until the refetch promise settles, then the
   indicator animates back. Releasing below threshold springs back, no refresh.

### Status states

`idle | pulling | armed | refreshing`

- `idle` — no active gesture.
- `pulling` — dragging down, below threshold.
- `armed` — dragging down, past threshold (release will refresh).
- `refreshing` — refetch in flight.

## Guards (global, no per-route coupling)

- **Modal open:** Suppressed when `document.body.style.overflow === "hidden"`.
  `Sheet` sets this whenever a bottom-sheet/modal is open, so pulling inside a
  sheet never refreshes.
- **Top-only:** Engages a pull only at `window.scrollY <= 0`.
- **Reduced motion:** Honors `prefers-reduced-motion` — still functional, but no
  animated translate on the indicator.

## Files

### 1. `app/src/lib/usePullToRefresh.ts` (new)

The gesture hook. Binds a **non-passive** `touchmove` listener to `window`
(non-passive is required so `preventDefault` works), plus `touchstart`/`touchend`.
Returns `{ distance, status }`.

Pure, node-testable helpers are extracted so the gesture math has no DOM
dependency (tests run under the `node` vitest environment):

- `pullDistance(rawDy: number): number` — resistance curve (× 0.5) and cap.
- `nextPullState(state, event)` — a small reducer mapping
  start/move/release/settle events to the next `status` and whether a refresh
  should fire. This is what the unit tests drive; the hook is a thin DOM binding
  over it.

### 2. `app/src/features/pwa/PullToRefresh.tsx` (new)

Presentational wrapper. Renders:

- A fixed indicator positioned under the sticky header, with `translateY`/opacity
  driven by `distance` and a spinner (reusing `PawIcon` + existing
  `animate-paw`, or `Spinner`) when `refreshing`.
- An `aria-live="polite"` region announcing the refresh state for accessibility
  (uses the new i18n string).
- `{children}` (the routed content).

`onRefresh` is supplied by the caller.

### 3. `app/src/routes/Shell.tsx` (edit)

Wrap the routed `<main>` content (the `Outlet`) with `<PullToRefresh>`. Obtain
`queryClient` via `useQueryClient` and pass
`onRefresh={() => queryClient.refetchQueries({ type: "active" })}`.

### 4. i18n (edit)

Add a `pwa.refreshing` string (and pull/release aria hints as needed) to:

- `app/src/i18n/messages.ts` (the type interface)
- `app/src/i18n/en.ts`
- `app/src/i18n/ja.ts`

## Testing

`app/test/pullToRefresh.test.ts` (node environment):

- `pullDistance` — resistance curve applied and output capped; zero/negative
  input yields zero.
- `nextPullState` — releasing past threshold signals a refresh and transitions
  to `refreshing`; releasing below threshold returns to `idle` with no refresh;
  `settle` returns `refreshing → idle`.

DOM/touch simulation is intentionally avoided (no jsdom in this project); the
pure reducer is the unit under test, keeping the hook a thin, well-bounded
binding layer.

## Out of scope

- Desktop refresh affordance.
- Surgical per-view query invalidation (refetch-all is intentionally simple).
- Offline mutation queue (unchanged; spec §8 elsewhere).
