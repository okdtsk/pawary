# PWA Quick-Add Deep Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pawary's Quick Add reachable via a stable URL (`/?action=quickadd[&category=…]`) so it can be triggered from Android manifest shortcuts, iOS Apple Shortcuts, and home-screen bookmarks.

**Architecture:** A pure parser (`lib/quickAction.ts`) validates the URL contract and is unit-tested. `Shell.tsx` reads it once on mount, opens the existing Quick Add sheet, and clears the params. `QuickAddGrid` gains an optional category filter. The web manifest gets a `shortcuts` entry, and README documents the Apple Shortcuts path.

**Tech Stack:** React 19, react-router 7, Vite + vite-plugin-pwa, vitest (node env), TypeScript, `@pawary/shared`.

## Global Constraints

- IT terms, code, comments, and docs in English.
- Quick Add acts on the **currently-selected pet**; no pet identifier in the URL.
- Recognized action value is exactly `quickadd`; only `category` values in `CATEGORIES` (`shared/src/index.ts`) are honored, others dropped.
- Manifest `shortcuts` `name`/`short_name` stay English ("Quick Add") — manifest is not localized at runtime.
- vitest runs in **node** env, tests pure functions only (no jsdom/render tests). Reuse `icon-192.png` for the shortcut icon (no new asset).
- Conventional Commits; never push to `main` (work stays on `worktree-ios-quickaction`).

---

### Task 1: Pure quick-action URL parser

**Files:**
- Create: `app/src/lib/quickAction.ts`
- Test: `app/test/quickAction.test.ts`

**Interfaces:**
- Consumes: `Category`, `CATEGORIES` from `@pawary/shared`.
- Produces: `parseQuickAction(search: string): { open: boolean; category?: Category }` — used by `Shell.tsx` in Task 2.

- [ ] **Step 1: Write the failing test**

```ts
// app/test/quickAction.test.ts
import { describe, expect, it } from "vitest";
import { parseQuickAction } from "../src/lib/quickAction";

describe("parseQuickAction", () => {
  it("opens for action=quickadd with no category", () => {
    expect(parseQuickAction("?action=quickadd")).toEqual({ open: true });
  });

  it("includes a valid category", () => {
    expect(parseQuickAction("?action=quickadd&category=food")).toEqual({
      open: true,
      category: "food",
    });
  });

  it("drops an unknown category", () => {
    expect(parseQuickAction("?action=quickadd&category=bogus")).toEqual({
      open: true,
    });
  });

  it("does not open for other/absent actions", () => {
    expect(parseQuickAction("")).toEqual({ open: false });
    expect(parseQuickAction("?action=other")).toEqual({ open: false });
    expect(parseQuickAction("?foo=bar")).toEqual({ open: false });
  });

  it("works without a leading question mark", () => {
    expect(parseQuickAction("action=quickadd&category=weight")).toEqual({
      open: true,
      category: "weight",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w app -- quickAction`
Expected: FAIL — cannot find module `../src/lib/quickAction`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/src/lib/quickAction.ts
import { CATEGORIES, type Category } from "@pawary/shared";

/**
 * Parses the quick-add deep-link contract from a URL query string:
 *   ?action=quickadd[&category=<known category>]
 * Used by Shell to open the Quick Add sheet on launch (Android manifest
 * shortcuts, iOS Apple Shortcuts, home-screen bookmarks). Unknown category
 * values are dropped so the grid shows all presets.
 */
export function parseQuickAction(search: string): {
  open: boolean;
  category?: Category;
} {
  const params = new URLSearchParams(search);
  if (params.get("action") !== "quickadd") return { open: false };
  const category = params.get("category");
  if (category && (CATEGORIES as readonly string[]).includes(category)) {
    return { open: true, category: category as Category };
  }
  return { open: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w app -- quickAction`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w app`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/quickAction.ts app/test/quickAction.test.ts
git commit -m "feat: add quick-add deep-link URL parser"
```

---

### Task 2: Category filter on QuickAddGrid

**Files:**
- Modify: `app/src/features/quickadd/QuickAddGrid.tsx`

**Interfaces:**
- Consumes: `Category` from `@pawary/shared`.
- Produces: `QuickAddGrid` now accepts optional `category?: Category`; consumed by `Shell.tsx` in Task 3.

- [ ] **Step 1: Add the optional prop and filter**

In `app/src/features/quickadd/QuickAddGrid.tsx`, change the import to include `Category`:

```ts
import type { Category, PresetResponse } from "@pawary/shared";
```

Update the component signature and props:

```tsx
export function QuickAddGrid({
  petId,
  category,
  onLogged,
}: {
  petId: string;
  /** When set, only presets in this category are shown. */
  category?: Category;
  /** e.g. close the surrounding sheet */
  onLogged?: () => void;
}) {
```

Replace the line `const items = presets.data ?? [];` with:

```tsx
  const all = presets.data ?? [];
  const items = category ? all.filter((p) => p.category === category) : all;
```

(The existing empty-state branch `if (items.length === 0)` now also covers a category with no presets — no further change needed.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w app`
Expected: no errors.

- [ ] **Step 3: Build (the app build is part of the test script and catches JSX/type issues)**

Run: `npm run build -w app`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/src/features/quickadd/QuickAddGrid.tsx
git commit -m "feat: support category filter in QuickAddGrid"
```

---

### Task 3: Wire the deep link into Shell

**Files:**
- Modify: `app/src/routes/Shell.tsx`

**Interfaces:**
- Consumes: `parseQuickAction` (Task 1), `QuickAddGrid` `category` prop (Task 2).
- Produces: launch-time opening of the Quick Add sheet from the URL.

- [ ] **Step 1: Add imports**

In `app/src/routes/Shell.tsx`, add to the React import (it currently imports `useRef, useState, type ReactNode`):

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
```

Add a new import alongside the other `../lib` / feature imports:

```tsx
import { parseQuickAction } from "../lib/quickAction";
import type { Category } from "@pawary/shared";
```

- [ ] **Step 2: Add state + mount effect**

Inside `export function Shell()`, next to the existing `const [quickOpen, setQuickOpen] = useState(false);`, add:

```tsx
  const [quickCategory, setQuickCategory] = useState<Category | undefined>(
    undefined,
  );

  // On launch, honor a quick-add deep link (?action=quickadd[&category=…]) from
  // Android manifest shortcuts / iOS Apple Shortcuts / home-screen bookmarks,
  // then strip the params so reload/back is clean and does not re-trigger.
  useEffect(() => {
    const { open, category } = parseQuickAction(window.location.search);
    if (!open) return;
    setQuickCategory(category);
    setQuickOpen(true);
    const url = window.location.pathname + window.location.hash;
    window.history.replaceState(null, "", url || "/");
  }, []);
```

- [ ] **Step 3: Pass the category into the grid and reset on close**

Find the Quick Add `Sheet` block near the end of the component:

```tsx
      {canEdit && (
        <Sheet
          open={quickOpen}
          onClose={() => setQuickOpen(false)}
          title={t.quickAdd.title}
        >
          <QuickAddGrid
            petId={selectedPet.id}
            onLogged={() => setQuickOpen(false)}
          />
        </Sheet>
      )}
```

Replace it with:

```tsx
      {canEdit && (
        <Sheet
          open={quickOpen}
          onClose={() => {
            setQuickOpen(false);
            setQuickCategory(undefined);
          }}
          title={t.quickAdd.title}
        >
          <QuickAddGrid
            petId={selectedPet.id}
            category={quickCategory}
            onLogged={() => {
              setQuickOpen(false);
              setQuickCategory(undefined);
            }}
          />
        </Sheet>
      )}
```

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck -w app && npm run build -w app`
Expected: both succeed.

- [ ] **Step 5: Manual verification**

Run: `npm run dev` (from repo root). In the browser:
- Visit `http://localhost:5173/?action=quickadd` → Quick Add sheet opens; URL bar settles to `/`.
- Visit `http://localhost:5173/?action=quickadd&category=food` → sheet opens showing only Food presets (or the empty state if none).
- Visit `http://localhost:5173/?action=quickadd&category=bogus` → sheet opens showing all presets.
- Reload after the sheet opened → sheet does not re-open.

Note actual observed behavior. (If no pet is selected the app shows Onboarding and the action is a no-op — expected.)

- [ ] **Step 6: Commit**

```bash
git add app/src/routes/Shell.tsx
git commit -m "feat: open Quick Add from ?action=quickadd deep link"
```

---

### Task 4: Manifest shortcut entry

**Files:**
- Modify: `app/vite.config.ts`

**Interfaces:**
- Consumes: nothing. Produces: an installable Android shortcut pointing at the Task 1–3 URL.

- [ ] **Step 1: Add the `shortcuts` array to the manifest**

In `app/vite.config.ts`, inside the `VitePWA({ manifest: { … } })` object, add a `shortcuts` key after the `icons` array (sibling of `icons`):

```ts
        shortcuts: [
          {
            name: "Quick Add",
            short_name: "Quick Add",
            description: "Quickly log a pet activity",
            url: "/?action=quickadd",
            icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
          },
        ],
```

- [ ] **Step 2: Build and confirm the manifest contains shortcuts**

Run: `npm run build -w app`
Expected: build succeeds.

Run: `grep -c "\"shortcuts\"" app/dist/manifest.webmanifest`
Expected: prints `1` (the generated manifest includes the shortcuts array). If the generated filename differs, locate it: `ls app/dist/*.webmanifest`.

- [ ] **Step 3: Commit**

```bash
git add app/vite.config.ts
git commit -m "feat: add Quick Add manifest shortcut"
```

---

### Task 5: Document Apple Shortcuts usage

**Files:**
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Add a documentation section**

Append a section to `README.md` (place it near other usage/feature docs; if unsure, add it before the final section):

```markdown
## Quick Add shortcuts

Pawary's Quick Add can be opened directly via URL:

- `https://pawary.okdtsk.dev/?action=quickadd` — opens the Quick Add grid.
- `https://pawary.okdtsk.dev/?action=quickadd&category=food` — opens it filtered
  to one category (`food`, `water`, `toilet`, `weight`, `exercise`, `symptom`,
  `medication`, `vet_visit`, `grooming`, `vaccination`, `note`).

The action runs against the currently-selected pet.

### Android

Install the PWA, then long-press the home-screen icon — a **Quick Add** shortcut
appears (provided by the web app manifest).

### iOS

iOS does not support PWA manifest shortcuts. Instead, use the **Shortcuts** app:

1. Create a new Shortcut with the **Open URLs** action.
2. Set the URL to `https://pawary.okdtsk.dev/?action=quickadd`.
3. Add the Shortcut to the Home Screen, the Action Button, the Lock Screen, or a
   Shortcuts widget.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document Quick Add deep-link shortcuts"
```

---

### Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test + typecheck suite**

Run: `npm run typecheck && npm run test`
Expected: typecheck passes for shared/worker/app; app build + worker tests + app tests all pass (including the new `quickAction` tests).

- [ ] **Step 2: Confirm the working tree is clean and commits are present**

Run: `git log --oneline -6 && git status --short`
Expected: the five feature/doc commits present; no uncommitted changes.

---

## Self-Review

**Spec coverage:**
- URL contract (`action=quickadd`, optional validated `category`) → Task 1.
- Open grid, currently-selected pet, clear params, no-pet/viewer no-op → Task 3 (viewer no-op is inherent: the Sheet is gated behind `canEdit`; no-pet returns Onboarding before the Sheet renders).
- Category filter on grid → Task 2.
- Manifest shortcuts (Android) → Task 4.
- Apple Shortcuts docs (iOS) → Task 5.
- Testing via pure parser in node env → Task 1; manual verification → Tasks 3 & 6.
- i18n (static English manifest names) → enforced in Task 4 / Global Constraints.

**Placeholder scan:** none — all steps contain concrete code/commands.

**Type consistency:** `parseQuickAction` signature identical in Tasks 1 & 3; `category?: Category` prop identical in Tasks 2 & 3; `quickCategory` state type matches the prop.
