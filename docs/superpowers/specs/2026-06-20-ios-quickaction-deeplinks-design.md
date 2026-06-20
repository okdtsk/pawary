# PWA Quick-Add Deep Links (iOS Quick Action — Step 0)

Date: 2026-06-20
Status: Approved (design)

## Background

The user asked to implement iOS Home Screen Quick Actions. Pawary is a PWA, and
iOS Safari does **not** support Home Screen Quick Actions or Web App Manifest
`shortcuts` for installed PWAs. True iOS Quick Actions would require a native or
hybrid shell (e.g. Capacitor) shipped via the App Store — a heavy lift whose
real cost is OAuth-in-WebView, not the Quick Actions themselves.

This spec covers **Step 0**: making Pawary's Quick Add reachable by URL. It is
the shared prerequisite for both the lightweight PWA path (delivers most of the
user value on iOS today via Apple Shortcuts) and any future Capacitor wrapper
(which would reuse the same URL contract for its native Quick Action handler).

## Goal & scope

Make Quick Add triggerable from outside the running app via a stable URL:

- **Android**: Web App Manifest `shortcuts` → long-press the installed icon.
- **iOS**: documented URL users wire into an Apple Shortcut (Home Screen,
  Action Button, Lock Screen, or Shortcuts widget).
- **Anywhere**: a plain home-screen bookmark to the URL.

No native shell, no App Store, no new backend.

### Out of scope

- Capacitor / native build, true iOS Home Screen Quick Actions.
- Push notifications, native widgets, biometrics.
- One-tap "instant log" without opening the grid (rejected during brainstorm in
  favor of opening the existing Quick Add grid).
- Per-pet targeting in the URL (acts on the currently-selected pet).

## URL contract

A single convention, read on app load:

```
/?action=quickadd                 → open Quick Add grid (all presets)
/?action=quickadd&category=food   → open Quick Add grid, filtered to one category
```

- `action=quickadd` is the only recognized action value (extensible later).
- `category` is optional. It must be one of the known `CATEGORIES` in
  `shared/src/index.ts` (`food`, `water`, `toilet`, `weight`, `exercise`,
  `symptom`, `medication`, `vet_visit`, `grooming`, `vaccination`, `note`).
  An unknown/invalid value is ignored — the grid shows all presets.
- The action targets the **currently-selected pet** (same as the FAB today).
  No pet identifier in the URL for v1.

## Behavior & flow

1. App boots normally (auth check via `useMe`, pet load) — unchanged.
2. In `Shell.tsx`, a new `useEffect` runs once on mount and parses
   `action` / `category` from `window.location.search`.
3. If `action=quickadd`: call the existing `setQuickOpen(true)`, passing the
   optional (validated) category down to `QuickAddGrid`.
4. **Clear the params** via `history.replaceState` so the URL settles to `/`.
   Reload and back-navigation are clean and do not re-trigger the sheet.
5. **No selected pet** (onboarding state): `Shell` early-returns `<Onboarding />`
   before the grid exists, so the action is a no-op. Nothing is queued or
   replayed after onboarding.
6. **Viewer role** (`canEdit === false`): the Quick Add `Sheet` and FAB are not
   rendered for viewers today; the deep link is therefore a no-op for them. The
   param is still cleared from the URL.

## Component changes

### `app/src/lib/quickAction.ts` (new)

- Export a pure `parseQuickAction(search: string): { open: boolean; category?: Category }`.
- Returns `{ open: true }` when `action=quickadd`, including `category` only when
  it is one of `CATEGORIES` (imported from `@pawary/shared`); otherwise the
  category is dropped. Returns `{ open: false }` for any other/absent action.
- This is the unit-tested seam for the URL contract.

### `app/src/routes/Shell.tsx`

- Add a mount-time `useEffect` that calls `parseQuickAction(window.location.search)`,
  opens the Quick Add sheet when `open` is true, stores the optional category in
  state, and clears the params via `history.replaceState`.
- Pass the optional `category` into the existing `<QuickAddGrid />`.

### `app/src/features/quickadd/QuickAddGrid.tsx`

- Add an optional `category?: Category` prop.
- When set, filter `items` (presets) to that category before rendering.
- An empty filtered result reuses the existing empty state.
- Tap / create / undo logic is unchanged.

### `app/vite.config.ts`

- Add a `shortcuts` array to the `VitePWA` `manifest`:

  ```jsonc
  "shortcuts": [
    {
      "name": "Quick Add",
      "short_name": "Quick Add",
      "url": "/?action=quickadd",
      "icons": [{ "src": "/icons/icon-192.png", "sizes": "192x192" }]
    }
  ]
  ```

- Start with one generic "Quick Add" entry, reusing `icon-192.png` (no new icon
  asset required). Additional per-category entries (e.g. Food, Weight) may be
  added later but are not required for v1.

## Manifest shortcuts (Android) + Apple Shortcuts (iOS)

- **Android**: the manifest `shortcuts` entry appears on long-press of the
  installed icon. Free; no further work.
- **iOS**: the manifest is ignored. Document in `README.md` (or `docs/`) how a
  user builds an Apple Shortcut that opens
  `https://pawary.okdtsk.dev/?action=quickadd`, and how to place it on the Home
  Screen / Action Button / Lock Screen / Shortcuts widget.

## i18n

The manifest `name`/`short_name` are static (the manifest is not localized at
runtime); keep them English ("Quick Add"), consistent with the existing
manifest. No new in-app strings are required — the Quick Add grid is already
localized.

## Testing

The app's vitest suite runs in a **node** environment and tests **pure
functions** (e.g. `pendingInviteFromPath`); there is no React render-test
infrastructure (no jsdom/testing-library). To match this convention, the risky
logic — parsing and validating the URL contract — is extracted into a pure
function and unit-tested there. The thin `Shell`/`QuickAddGrid` wiring is
manually verified, consistent with how the `pendingInviteFromPath` wiring in
`App.tsx` is left untested.

- **Unit (vitest, `app/test/`, node env)** for the extracted parser
  `parseQuickAction(search)` in `app/src/lib/quickAction.ts`:
  - `?action=quickadd` → `{ open: true }`.
  - `?action=quickadd&category=food` → `{ open: true, category: "food" }`.
  - An unknown `category` value → `{ open: true }` (category dropped).
  - No/empty/other `action` → `{ open: false }`.
- **Manual**: trigger `/?action=quickadd` and `&category=food` in the running
  app (sheet opens, filtered correctly, URL settles to `/`); install the PWA on
  Android (long-press icon → Quick Add); build an Apple Shortcut on iOS that
  opens the URL.

## Rationale for key choices

- **Open the grid (not instant-log)**: lowest risk, reuses the existing
  `QuickAddGrid`, avoids accidental logs, still fast.
- **Query param (not a dedicated `/quick-add` route)**: Quick Add is a modal
  sheet over Home, not a page. A query param read in `Shell` matches that model,
  touches only `Shell.tsx`, and avoids route/sheet coordination. It satisfies
  manifest shortcuts and Apple Shortcuts equally well.
