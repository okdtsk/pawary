# Pawlog Plan 3: Frontend Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The complete v1 frontend on top of the Plan-2 API: a warm, family-pet-journal app shell (tab bar + FAB on mobile, sidebar on desktop), pet onboarding and management, the 11-category add/edit flow with photos, Quick Add with undo, the Home dashboard, Calendar (Month / Week / 3-Day / Day), the filterable infinite Log, activity detail, and Settings (profile, pets, presets, export, account deletion) — fully i18n'd (EN + JA) and visually distinctive per the approved "warm & friendly" direction.

**Architecture:** React 19 SPA in `app/` consuming the existing Worker API. React Router v7 in **library mode** (`BrowserRouter` + `<Routes>` — no framework mode, no loaders). One typed TanStack Query hook module per resource in `app/src/api/`, all types imported from `@pawlog/shared`. A `PetProvider` keeps the selected pet id in React context + `localStorage`; every data hook takes an explicit `petId`. The design system lives in `app/src/index.css` (Tailwind 4 `@theme` tokens) + `app/src/components/` primitives. Pure date/grid math lives in `app/src/lib/dates.ts` and is the only unit-tested frontend code (plus timeline lane math), per spec §9.

**Tech Stack:** React 19, React Router 7 (library mode), TanStack Query 5, Tailwind CSS 4, Zod (via `@pawlog/shared`), Vitest 3 (node environment, no jsdom) for `app/`, self-hosted variable fonts via `@fontsource-variable/*`. **No chart, animation, or component libraries** — motion is CSS-only.

**Spec:** `docs/superpowers/specs/2026-06-11-pawlog-design.md` (read sections 1, 3, 8 before starting).

**Roadmap context:** This is plan 3 of 5. Plans 1–2 are merged on `main`: the Worker API (auth, me, pets, activities, photos, presets, export, account deletion) is complete and its tests are green. **The worker is FROZEN for this plan** with exactly two sanctioned touches, both itemized in tasks below: (a) the OAuth error-redirect fix in Task 4 (a deferred Plan-1 review item), and (b) nothing else — schema, middleware, and all other routes must not change. `shared/` gets exactly one addition (`UpdateMeResponse`, Task 3). Plan 4 (Care & Analyzer) fills the Health tab and the Home care/anomaly slots; Plan 5 does PWA polish. This plan ships warm placeholders for those slots.

**Conventions used throughout (carried from Plans 1–2):**
- API responses: success `{ data }`, failure `{ error: { code, message } }` — already unwrapped by `app/src/api/client.ts`'s `api()`.
- Timestamps are epoch milliseconds. Activities carry `occurredAt` (epoch ms UTC) + `tzOffsetMin` (household offset, **positive east of UTC**: JST = `+540` = `-new Date().getTimezoneOffset()`).
- Every task that adds a UI string extends the typed `Messages` interface AND both catalogs (`en.ts`, `ja.ts`) **in the same task** — `npm run typecheck -w app` failing on a missing key means the task is incomplete.
- Per-task verification: `npm run typecheck -w app` && `npm run build -w app`; tasks touching `shared/` or `worker/` additionally run root `npm run test`; tasks with unit tests run `npm run test -w app`.
- Accessibility floor: every icon-only button has an `aria-label` (enforced by `IconButton`'s required `label` prop), Sheets trap focus and close on Escape, animations respect `prefers-reduced-motion`.
- Version numbers are minimums; never pin downward.
- Each task ends with a commit using the exact message given.

**Locked decisions for this plan (do not relitigate):**

| Decision | Choice | Why |
|---|---|---|
| Visual direction | **Warm & friendly**: cream paper surfaces, clay/terracotta primary, blob-shaped avatars, rounded display type, hand-drawn-feel SVG empty states | Approved in spec §3 "Visual language". A family pet journal — NOT a clinical dashboard, NOT default-Tailwind gray. |
| Fonts | Self-hosted `@fontsource-variable/fredoka` (display) + `@fontsource-variable/nunito` (body); JA falls back to rounded system fonts | CSP is `default-src 'self'` — external font CDNs are blocked. Fredoka/Nunito are OFL. |
| Router | React Router 7 **library mode** (`BrowserRouter`), routes declared in `App.tsx`, `Shell` as a layout route | Already a dependency; SPA-fallback serving is configured in the Worker. |
| Selected pet | `localStorage["pawlog:selectedPetId"]` + `PetProvider` context; invalid/missing id falls back to the first pet; zero pets ⇒ Onboarding replaces the routed UI | Spec §3: all views scoped to the selected pet. |
| Types | Frontend types come **ONLY** from `@pawlog/shared` (one addition: `UpdateMeResponse`); per-category details types are derived via `z.infer<typeof activityDetailsSchemas[C]>` | Single source of truth; drift impossible. |
| Query keys | Namespaced by petId: `["activities", petId, ...]`, `["summary", petId, month]`, `["presets", petId]`, `["pets", petId]`; mutations invalidate by prefix as itemized in Task 3 | Pet switching must never show stale cross-pet data. |
| Category forms | ONE config map (`CATEGORY_FIELDS`) + ONE renderer drives all 11 category forms; built payloads are validated client-side with the **same** `activityDetailsSchemas` the server uses | DRY and provably schema-exact. |
| Photo attach | Create the activity first, then upload photos **sequentially** in the same submit handler with a progress label | `POST .../activities/:activityId/photos` requires an existing activity (Plan-2 locked decision). |
| Quick Add undo | Undo = `DELETE` the just-created activity (soft delete server-side) via the toast action | Spec §3 "one tap = logged now, undo toast". |
| Calendar weeks | Start **Monday**; month grid pads with leading/trailing out-of-month days to full weeks (35 or 42 cells) | JA + EU convention; tested in Task 2. |
| Date math | Day-keys and timeline positions use **household time** (`occurredAt + tzOffsetMin·60000` read as UTC); query ranges (`from`/`to`) use **device-local** day boundaries | Matches the server's summary bucketing; device ≈ household for a family app. Documented in `dates.ts`. |
| Timeline | ONE `Timeline` component parameterized by a `days: DayKey[]` array (7 / 3 / 1 columns); activities are point events rendered as fixed-height chips in greedy lanes | Spec §3: "one timeline component with different column counts". All activities have a time; no untimed clustering. |
| Frontend tests | `lib/dates.ts` + `lib/timeline.ts` unit tests only (Vitest, node env, no jsdom); everything else verified by typecheck/build + the manual smoke checklist in Task 15 | Spec §9: "component tests for calendar grid math and timeline layout only". |
| Worker touches | Exactly one: OAuth callback redirects user-denied/error flows to `/?auth_error=…` instead of returning JSON (Task 4, with a worker test) | Deferred Plan-1 review item; a browser navigation landing on raw JSON is broken UX and cannot be fixed client-side. |
| Photo input | `<input accept="image/*">`; client pre-checks the 10 MB cap with a friendly toast; the server stays the validator of record | iOS Safari auto-converts HEIC→JPEG for web file inputs; JPEG/PNG/WebP reach the sniffer. |
| Presets | Store **complete, schema-valid** `details` (the preset form enforces required fields via the same `buildDetails`) | `presetSchema` validates details against the category schema; partial defaults would 400. |
| Deferred from spec §3 | Health tab content + care items + anomaly banners (Plan 4 — warm placeholder slots ship now); PWA/install polish (Plan 5); sharing UI (post-v1) | Per roadmap; placeholders are real, styled components — not TODOs. |

**Design language (lock this in — every task must stay on-palette):**

- **Surfaces**: page `bg-cream-100` (#faf3e7), cards `bg-paper` (#fffdf8) with `rounded-card` (1.25rem) and the warm `shadow-card`. No pure white, no pure black, no gray-*.
- **Ink**: text `text-ink` (#3d2c1e), secondary `text-ink-soft`, hints `text-ink-faint`.
- **Primary**: the `clay` ramp (terracotta, #db7434 at 500). Buttons/FAB/selection states are clay. Success = `moss`, destructive = `berry`.
- **Type**: headings `font-display` (Fredoka — rounded, friendly), body `font-sans` (Nunito). JA text falls back to Hiragino Maru Gothic / BIZ UD via the font stacks.
- **Shape**: pills for buttons/chips, `rounded-card`/`rounded-bubble` for surfaces, the `.blob` organic radius for avatars and empty-state art. The FAB is a 56px clay circle with a white paw-plus.
- **Category identity**: each of the 11 categories has a fixed accent + soft tint (`--color-cat-*`), used consistently for icons, dots, chips, and detail banners via the `categoryTone` map. Icons are inline SVG (`CategoryIcon`) — **never emoji** in the product UI.
- **Motion**: one springy ease (`--ease-springy`), `animate-pop` staggered reveals on screen mount, `animate-sheet` slide-up for sheets. CSS only; everything collapses under `prefers-reduced-motion`.
- **Empty states**: `EmptyState` renders a soft blob + paw illustration with a friendly one-liner and optional action — never a bare "No data".

---

### Task 1: Design system foundation — tokens, icons, primitives, category identity

**Files:**
- Modify: `app/package.json` (deps: fonts + zod)
- Modify: `app/src/index.css` (full warm token set)
- Create: `app/src/lib/cn.ts`
- Create: `app/src/components/icons.tsx`
- Create: `app/src/components/CategoryIcon.tsx`
- Create: `app/src/components/Button.tsx`
- Create: `app/src/components/IconButton.tsx`
- Create: `app/src/components/Card.tsx`
- Create: `app/src/components/Chip.tsx`
- Create: `app/src/components/Spinner.tsx`
- Create: `app/src/components/Avatar.tsx`
- Create: `app/src/components/EmptyState.tsx`
- Create: `app/src/components/form.tsx`
- Modify: `app/src/i18n/messages.ts`, `app/src/i18n/en.ts`, `app/src/i18n/ja.ts`
- Modify: `app/src/i18n/index.tsx` (expose the resolved locale tag)

- [ ] **Step 1: Install dependencies**

Run: `npm install -w app @fontsource-variable/fredoka @fontsource-variable/nunito zod`
Expected: success; `zod` is declared directly (the app derives details types from shared's schemas), fonts are self-hosted (CSP allows no font CDN).

- [ ] **Step 2: Replace `app/src/index.css` with the full warm theme**

The old `warm-*` tokens are kept as deprecated aliases so `Login.tsx`/`Shell.tsx` keep compiling until Task 4 rewrites them.

```css
@import "tailwindcss";
@import "@fontsource-variable/fredoka";
@import "@fontsource-variable/nunito";

@theme {
  --font-display:
    "Fredoka Variable", "Hiragino Maru Gothic ProN", "BIZ UDPGothic",
    "Yu Gothic", sans-serif;
  --font-sans:
    "Nunito Variable", "Hiragino Kaku Gothic ProN", "BIZ UDPGothic",
    "Yu Gothic", sans-serif;

  /* warm paper neutrals */
  --color-cream-50: #fdfaf4;
  --color-cream-100: #faf3e7;
  --color-cream-200: #f3e7d2;
  --color-cream-300: #e8d5b8;
  --color-cream-400: #d9bd97;
  --color-paper: #fffdf8;
  --color-ink: #3d2c1e;
  --color-ink-soft: #6f5a45;
  --color-ink-faint: #a3907b;

  /* clay — the terracotta primary */
  --color-clay-50: #fdf1e8;
  --color-clay-100: #fbe2cf;
  --color-clay-200: #f6c5a2;
  --color-clay-300: #efa471;
  --color-clay-400: #e68a4e;
  --color-clay-500: #db7434;
  --color-clay-600: #c05f26;
  --color-clay-700: #9c4b1f;
  --color-clay-800: #7a3b1b;
  --color-clay-900: #5c2d16;

  /* support */
  --color-moss-100: #e6efdc;
  --color-moss-600: #5f8c3f;
  --color-moss-700: #4a7030;
  --color-berry-100: #fbe3e4;
  --color-berry-600: #c8424f;
  --color-berry-700: #a33340;

  /* category accents + soft tints (the 11-category visual identity) */
  --color-cat-food: #db7434;
  --color-cat-food-soft: #fbe2cf;
  --color-cat-water: #3f8fb8;
  --color-cat-water-soft: #ddeef6;
  --color-cat-toilet: #96714a;
  --color-cat-toilet-soft: #efe3d4;
  --color-cat-weight: #8e62a8;
  --color-cat-weight-soft: #ece1f2;
  --color-cat-exercise: #5f8c3f;
  --color-cat-exercise-soft: #e6efdc;
  --color-cat-symptom: #c8424f;
  --color-cat-symptom-soft: #fbe3e4;
  --color-cat-medication: #2f9180;
  --color-cat-medication-soft: #dcefeb;
  --color-cat-vet: #5c70bd;
  --color-cat-vet-soft: #e2e6f7;
  --color-cat-grooming: #c66b9a;
  --color-cat-grooming-soft: #f6dfeb;
  --color-cat-vaccine: #b08a1d;
  --color-cat-vaccine-soft: #f3ead0;
  --color-cat-note: #877a68;
  --color-cat-note-soft: #ebe5da;

  /* shape, depth, motion */
  --radius-card: 1.25rem;
  --radius-bubble: 1.75rem;
  --shadow-card: 0 2px 10px rgb(92 45 22 / 0.07), 0 1px 2px rgb(92 45 22 / 0.05);
  --shadow-float: 0 10px 30px rgb(92 45 22 / 0.18);
  --shadow-fab: 0 8px 22px rgb(192 95 38 / 0.4);
  --ease-springy: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* DEPRECATED Plan-1 aliases — removed in Task 4 */
  --color-warm-50: #fdfaf4;
  --color-warm-100: #faf3e7;
  --color-warm-500: #db7434;
  --color-warm-600: #c05f26;
  --color-warm-900: #3d2c1e;
}

@layer base {
  html {
    font-family: var(--font-sans);
    background-color: var(--color-cream-100);
    color: var(--color-ink);
    -webkit-tap-highlight-color: transparent;
  }
  h1, h2, h3 {
    font-family: var(--font-display);
    letter-spacing: 0.01em;
  }
}

/* organic avatar / illustration shape */
.blob {
  border-radius: 53% 47% 52% 48% / 51% 49% 53% 47%;
}

/* iOS safe areas */
.pb-safe { padding-bottom: env(safe-area-inset-bottom); }
.pt-safe { padding-top: env(safe-area-inset-top); }

@keyframes pop-in {
  from { opacity: 0; transform: translateY(10px) scale(0.97); }
  to { opacity: 1; transform: none; }
}
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes sheet-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
@keyframes paw-pulse {
  0%, 100% { transform: scale(1); opacity: 0.85; }
  50% { transform: scale(1.12); opacity: 1; }
}
.animate-pop { animation: pop-in 0.35s var(--ease-springy) both; }
.animate-fade { animation: fade-in 0.2s ease-out both; }
.animate-sheet { animation: sheet-up 0.32s var(--ease-springy) both; }
.animate-paw { animation: paw-pulse 1.4s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .animate-pop, .animate-fade, .animate-sheet, .animate-paw {
    animation: none;
  }
  * {
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 3: Create `app/src/lib/cn.ts`**

```ts
/** Joins class names, skipping falsy values. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
```

- [ ] **Step 4: Create `app/src/components/icons.tsx`**

All chrome icons are stylized 24×24 stroke SVGs (hand-drawn feel: 1.8 stroke, round caps). They inherit `currentColor`; size via `className`.

```tsx
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** The Pawlog mark: solid paw print. */
export function PawIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <ellipse cx="7" cy="8.4" rx="1.7" ry="2.1" />
      <ellipse cx="10.4" cy="5.9" rx="1.7" ry="2.1" />
      <ellipse cx="13.6" cy="5.9" rx="1.7" ry="2.1" />
      <ellipse cx="17" cy="8.4" rx="1.7" ry="2.1" />
      <path d="M12 11.2c2.9 0 5.2 2 5.2 4.4 0 2.1-1.7 3.4-5.2 3.4s-5.2-1.3-5.2-3.4c0-2.4 2.3-4.4 5.2-4.4Z" />
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4.5 11 12 4.5 19.5 11v8a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19Z" />
      <path d="M9.5 20.5v-5.5h5v5.5" />
    </Base>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" />
      <circle cx="8.5" cy="14" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="14" r="0.9" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function ListIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <circle cx="4.8" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.8" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.8" cy="17.5" r="1.1" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function HeartIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 20s-7.5-4.8-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.2 12 20 12 20Z" />
    </Base>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18" />
    </Base>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
    </Base>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
    </Base>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Base>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Base>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </Base>
  );
}

export function XIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Base>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Base>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2L9 5h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5Z" />
      <circle cx="12" cy="13" r="3.2" />
    </Base>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 7h14M9.5 7V4.5h5V7M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </Base>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14.5 5 19 9.5 8.5 20H4v-4.5Z" />
      <path d="m12.5 7 4.5 4.5" />
    </Base>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15.5 15.5 5 5" />
    </Base>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 4v11M7.5 11 12 15.5 16.5 11M4.5 19.5h15" />
    </Base>
  );
}

export function SproutIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 20v-7" />
      <path d="M12 13c0-3.5 2.5-6 6.5-6 0 3.5-2.5 6-6.5 6ZM12 11C12 8 10 6 6.5 6c0 3 2 5 5.5 5Z" />
    </Base>
  );
}

export function DogIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M7 5.5C5 6 4 8 4 10.5c0 1 .5 1.8 1.5 2L6 15c.5 2.8 2.8 4.5 6 4.5s5.5-1.7 6-4.5l.5-2.5c1-.2 1.5-1 1.5-2C20 8 19 6 17 5.5 15.7 4.5 14 4 12 4s-3.7.5-5 1.5Z" />
      <circle cx="9.3" cy="11" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="11" r="0.9" fill="currentColor" stroke="none" />
      <path d="M10.8 15h2.4l-1.2 1.3Z" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function CatIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5.5 10 5 4.5 9.3 7a7.6 7.6 0 0 1 5.4 0L19 4.5 18.5 10c.2.6.3 1.2.3 1.8 0 3.8-3 6.4-6.8 6.4s-6.8-2.6-6.8-6.4c0-.6.1-1.2.3-1.8Z" />
      <circle cx="9.3" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
      <path d="M2.5 12.5h2.8M2.8 15l2.6-.8M21.5 12.5h-2.8M21.2 15l-2.6-.8" />
    </Base>
  );
}
```

- [ ] **Step 5: Create `app/src/components/CategoryIcon.tsx`**

The 11-category visual identity: one inline-SVG icon per category plus the `categoryTone` map of **literal** Tailwind classes (literal strings are required so Tailwind's scanner extracts them — never build class names dynamically).

```tsx
import type { Category } from "@pawlog/shared";
import type { ReactElement, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

/** Literal utility classes per category (Tailwind extracts literals only). */
export const categoryTone: Record<
  Category,
  { text: string; bg: string; soft: string; border: string }
> = {
  food: { text: "text-cat-food", bg: "bg-cat-food", soft: "bg-cat-food-soft", border: "border-cat-food" },
  water: { text: "text-cat-water", bg: "bg-cat-water", soft: "bg-cat-water-soft", border: "border-cat-water" },
  toilet: { text: "text-cat-toilet", bg: "bg-cat-toilet", soft: "bg-cat-toilet-soft", border: "border-cat-toilet" },
  weight: { text: "text-cat-weight", bg: "bg-cat-weight", soft: "bg-cat-weight-soft", border: "border-cat-weight" },
  exercise: { text: "text-cat-exercise", bg: "bg-cat-exercise", soft: "bg-cat-exercise-soft", border: "border-cat-exercise" },
  symptom: { text: "text-cat-symptom", bg: "bg-cat-symptom", soft: "bg-cat-symptom-soft", border: "border-cat-symptom" },
  medication: { text: "text-cat-medication", bg: "bg-cat-medication", soft: "bg-cat-medication-soft", border: "border-cat-medication" },
  vet_visit: { text: "text-cat-vet", bg: "bg-cat-vet", soft: "bg-cat-vet-soft", border: "border-cat-vet" },
  grooming: { text: "text-cat-grooming", bg: "bg-cat-grooming", soft: "bg-cat-grooming-soft", border: "border-cat-grooming" },
  vaccination: { text: "text-cat-vaccine", bg: "bg-cat-vaccine", soft: "bg-cat-vaccine-soft", border: "border-cat-vaccine" },
  note: { text: "text-cat-note", bg: "bg-cat-note", soft: "bg-cat-note-soft", border: "border-cat-note" },
};

function Base({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

const icons: Record<Category, (props: IconProps) => ReactElement> = {
  food: (p) => (
    <Base {...p}>
      <path d="M3.5 13a8.5 8.5 0 0 0 17 0Z" />
      <circle cx="8.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
    </Base>
  ),
  water: (p) => (
    <Base {...p}>
      <path d="M12 3.5c3.6 4.3 6 7.3 6 10.3a6 6 0 0 1-12 0c0-3 2.4-6 6-10.3Z" />
      <path d="M9.5 14a2.6 2.6 0 0 0 2 2.4" />
    </Base>
  ),
  toilet: (p) => (
    <Base {...p}>
      <path d="M4 18.5h16" />
      <path d="M7.5 18.5a4.5 4.5 0 0 1 9 0" />
      <path d="M10 10.5 9 12.8M14 10.5l1 2.3M12 9.5v2.3" />
    </Base>
  ),
  weight: (p) => (
    <Base {...p}>
      <rect x="4" y="4.5" width="16" height="15" rx="4" />
      <path d="M8.8 10.5a4 4 0 0 1 6.4 0" />
      <path d="m12 11.5 1.6-1.8" />
    </Base>
  ),
  exercise: (p) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 4.5a13.5 13.5 0 0 0 0 15M4.5 12h15" />
    </Base>
  ),
  symptom: (p) => (
    <Base {...p}>
      <path d="M10.5 13.8V5.5a1.5 1.5 0 0 1 3 0v8.3a3.6 3.6 0 1 1-3 0Z" />
      <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
    </Base>
  ),
  medication: (p) => (
    <Base {...p}>
      <rect x="4.5" y="8.8" width="15" height="6.5" rx="3.25" />
      <path d="M12 8.8v6.5" />
    </Base>
  ),
  vet_visit: (p) => (
    <Base {...p}>
      <path d="M12 20s-7-4.5-7-9.7A4 4 0 0 1 12 7.7a4 4 0 0 1 7 2.6C19 15.5 12 20 12 20Z" />
      <path d="M12 9.5v4.6M9.7 11.8h4.6" />
    </Base>
  ),
  grooming: (p) => (
    <Base {...p}>
      <rect x="4.5" y="8" width="15" height="4.5" rx="2.25" />
      <path d="M7.5 12.5v3.5M10.5 12.5v3.5M13.5 12.5v3.5M16.5 12.5v3.5" />
    </Base>
  ),
  vaccination: (p) => (
    <Base {...p}>
      <path d="m18.5 3 2.5 2.5M13.5 4.5l6 6" />
      <path d="M16.5 7.5 7.5 16.5l-3.5 1 1-3.5 9-9" />
      <path d="m4.5 19.5-2 2" />
    </Base>
  ),
  note: (p) => (
    <Base {...p}>
      <path d="M6.5 3.5H14l5.5 5.5v11.5h-13Z" />
      <path d="M14 3.5V9h5.5M9.5 13h5M9.5 16.5h3.5" />
    </Base>
  ),
};

export function CategoryIcon({
  category,
  ...props
}: { category: Category } & IconProps) {
  const Icon = icons[category];
  return <Icon {...props} />;
}
```

- [ ] **Step 6: Create the small primitives**

```tsx
// app/src/components/Button.tsx
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

type Variant = "primary" | "soft" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variantClasses: Record<Variant, string> = {
  primary: "bg-clay-500 text-white shadow-card hover:bg-clay-600 active:scale-[0.98]",
  soft: "bg-clay-100 text-clay-800 hover:bg-clay-200 active:scale-[0.98]",
  ghost: "bg-transparent text-clay-700 hover:bg-clay-50",
  danger: "bg-berry-600 text-white hover:bg-berry-700 active:scale-[0.98]",
};
const sizeClasses: Record<Size, string> = {
  sm: "px-3.5 py-1.5 text-sm",
  md: "px-5 py-2.5",
  lg: "px-7 py-3.5 text-lg",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  type,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button
      type={type ?? "button"}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition",
        "disabled:pointer-events-none disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...rest}
    />
  );
}
```

```tsx
// app/src/components/IconButton.tsx
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

/** Icon-only button. `label` is REQUIRED and becomes the aria-label. */
export function IconButton({
  label,
  className,
  type,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type={type ?? "button"}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-soft",
        "transition hover:bg-cream-200 hover:text-ink active:scale-95",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...rest}
    />
  );
}
```

```tsx
// app/src/components/Card.tsx
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-card bg-paper p-4 shadow-card", className)}
      {...rest}
    />
  );
}
```

```tsx
// app/src/components/Chip.tsx
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

/**
 * Selectable pill. When `tone` (a `categoryTone` entry) is given, the selected
 * state uses the category accent; otherwise clay.
 */
export function Chip({
  selected = false,
  tone,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  tone?: { text: string; soft: string; border: string };
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition active:scale-95",
        selected
          ? tone
            ? cn(tone.soft, tone.text, tone.border)
            : "border-clay-500 bg-clay-100 text-clay-800"
          : "border-cream-300 bg-paper text-ink-soft hover:bg-cream-50",
        className,
      )}
      {...rest}
    />
  );
}
```

```tsx
// app/src/components/Spinner.tsx
import { cn } from "../lib/cn";

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("h-6 w-6 animate-spin text-clay-500", className)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Step 7: Create `app/src/components/Avatar.tsx`**

Pet avatars are blob-shaped (organic radius) and pet-forward: a real photo when uploaded, otherwise a species icon on a tint chosen by hashing the pet id (stable per pet).

```tsx
import { cn } from "../lib/cn";
import { CatIcon, DogIcon, PawIcon } from "./icons";

type PetLike = {
  id: string;
  name: string;
  species: "dog" | "cat" | "other";
  avatarR2Key: string | null;
};

const FALLBACK_TINTS = [
  { bg: "bg-cat-food-soft", text: "text-cat-food" },
  { bg: "bg-cat-water-soft", text: "text-cat-water" },
  { bg: "bg-cat-exercise-soft", text: "text-cat-exercise" },
  { bg: "bg-cat-weight-soft", text: "text-cat-weight" },
  { bg: "bg-cat-grooming-soft", text: "text-cat-grooming" },
  { bg: "bg-cat-medication-soft", text: "text-cat-medication" },
] as const;

function tintFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return FALLBACK_TINTS[Math.abs(hash) % FALLBACK_TINTS.length]!;
}

const sizeClasses = {
  sm: "h-8 w-8",
  md: "h-11 w-11",
  lg: "h-16 w-16",
  xl: "h-24 w-24",
} as const;
const iconSize = { sm: "h-5 w-5", md: "h-6 w-6", lg: "h-9 w-9", xl: "h-12 w-12" } as const;

export function PetAvatar({
  pet,
  size = "md",
  className,
}: {
  pet: PetLike;
  size?: keyof typeof sizeClasses;
  className?: string;
}) {
  const tint = tintFor(pet.id);
  if (pet.avatarR2Key) {
    return (
      <img
        src={`/api/pets/${pet.id}/avatar`}
        alt={pet.name}
        className={cn("blob object-cover", sizeClasses[size], className)}
      />
    );
  }
  const Icon =
    pet.species === "dog" ? DogIcon : pet.species === "cat" ? CatIcon : PawIcon;
  return (
    <span
      role="img"
      aria-label={pet.name}
      className={cn(
        "blob inline-flex shrink-0 items-center justify-center",
        tint.bg,
        tint.text,
        sizeClasses[size],
        className,
      )}
    >
      <Icon className={iconSize[size]} />
    </span>
  );
}

export function UserAvatar({
  name,
  avatarUrl,
  size = "sm",
  className,
}: {
  name: string;
  avatarUrl: string | null;
  size?: keyof typeof sizeClasses;
  className?: string;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={cn("rounded-full object-cover", sizeClasses[size], className)}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-clay-100 font-display text-clay-700",
        sizeClasses[size],
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
```

- [ ] **Step 8: Create `app/src/components/EmptyState.tsx`**

The signature illustrated empty state: a soft two-blob composition with a tilted paw, warm copy, optional action. Custom art can be injected via `art`.

```tsx
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { PawIcon } from "./icons";

function DefaultArt() {
  return (
    <div className="relative h-28 w-32" aria-hidden="true">
      <div className="blob absolute left-2 top-3 h-24 w-24 bg-cream-200" />
      <div className="blob absolute right-0 top-0 h-12 w-12 bg-clay-100" />
      <PawIcon className="absolute left-9 top-10 h-11 w-11 rotate-[-12deg] text-clay-300" />
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  art,
  className,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  art?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 px-6 py-10 text-center",
        className,
      )}
    >
      {art ?? <DefaultArt />}
      <p className="font-display text-lg text-ink">{title}</p>
      {hint && <p className="max-w-xs text-sm text-ink-faint">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 9: Create `app/src/components/form.tsx`**

All field primitives in one module. `Field` renders the label + error wiring; inputs share one warm base style.

```tsx
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "../lib/cn";

const inputBase =
  "w-full rounded-2xl border border-cream-300 bg-paper px-4 py-2.5 text-ink " +
  "placeholder:text-ink-faint focus:border-clay-400 focus:outline-none " +
  "focus:ring-2 focus:ring-clay-200 disabled:opacity-50";

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | null;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink-soft">
        {label}
      </span>
      {children}
      {hint && !error && (
        <span className="mt-1 block text-xs text-ink-faint">{hint}</span>
      )}
      {error && (
        <span role="alert" className="mt-1 block text-xs font-semibold text-berry-600">
          {error}
        </span>
      )}
    </label>
  );
}

export function TextInput({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputBase, className)} {...rest} />;
}

export function NumberInput({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step="any"
      className={cn(inputBase, className)}
      {...rest}
    />
  );
}

export function Select({
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(inputBase, "appearance-none", className)} {...rest} />;
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} className={cn(inputBase, className)} {...rest} />;
}

export function DateInput({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="date" className={cn(inputBase, className)} {...rest} />;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Epoch-ms → device-local `datetime-local` string. */
export function msToLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function DateTimeInput({
  valueMs,
  onChangeMs,
  className,
}: {
  valueMs: number;
  onChangeMs: (ms: number) => void;
  className?: string;
}) {
  return (
    <input
      type="datetime-local"
      className={cn(inputBase, className)}
      value={msToLocalInput(valueMs)}
      onChange={(e) => {
        const parsed = new Date(e.target.value).getTime();
        if (Number.isFinite(parsed)) onChangeMs(parsed);
      }}
    />
  );
}
```

- [ ] **Step 10: Expose the resolved locale tag from i18n**

Replace `app/src/i18n/index.tsx` with (adds `useLocaleTag` for `Intl` formatting; provider now carries `{ messages, tag }`):

```tsx
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "@pawlog/shared";
import { en } from "./en";
import { ja } from "./ja";
import type { Messages } from "./messages";

export type LocaleTag = "en" | "ja";

const catalogs: Record<LocaleTag, Messages> = { en, ja };

function resolveLocale(setting: Locale | undefined): LocaleTag {
  if (setting === "en" || setting === "ja") return setting;
  return navigator.language.toLowerCase().startsWith("ja") ? "ja" : "en";
}

const I18nContext = createContext<{ messages: Messages; tag: LocaleTag }>({
  messages: en,
  tag: "en",
});

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale | undefined;
  children: ReactNode;
}) {
  const tag = resolveLocale(locale);
  const value = useMemo(() => ({ messages: catalogs[tag], tag }), [tag]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): Messages {
  return useContext(I18nContext).messages;
}

/** Locale tag for Intl date/number formatting. */
export function useLocaleTag(): LocaleTag {
  return useContext(I18nContext).tag;
}
```

- [ ] **Step 11: Add category names + common strings to the catalogs**

Add this import at the top of `app/src/i18n/messages.ts`:

```ts
import type { Category } from "@pawlog/shared";
```

Append inside the `Messages` interface (before the closing brace):

```ts
  categories: Record<Category, string>;
  common: {
    save: string;
    cancel: string;
    delete: string;
    edit: string;
    add: string;
    close: string;
    back: string;
    retry: string;
    today: string;
    yesterday: string;
    confirm: string;
    optional: string;
    showMore: string;
  };
```

Append inside the `en` object in `app/src/i18n/en.ts`:

```ts
  categories: {
    food: "Food",
    water: "Water",
    toilet: "Toilet",
    weight: "Weight",
    exercise: "Exercise",
    symptom: "Symptom",
    medication: "Medication",
    vet_visit: "Vet visit",
    grooming: "Grooming",
    vaccination: "Vaccination",
    note: "Note",
  },
  common: {
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    edit: "Edit",
    add: "Add",
    close: "Close",
    back: "Back",
    retry: "Try again",
    today: "Today",
    yesterday: "Yesterday",
    confirm: "Confirm",
    optional: "optional",
    showMore: "Show more",
  },
```

Append inside the `ja` object in `app/src/i18n/ja.ts`:

```ts
  categories: {
    food: "ごはん",
    water: "お水",
    toilet: "トイレ",
    weight: "体重",
    exercise: "運動",
    symptom: "症状",
    medication: "お薬",
    vet_visit: "通院",
    grooming: "お手入れ",
    vaccination: "ワクチン",
    note: "メモ",
  },
  common: {
    save: "保存",
    cancel: "キャンセル",
    delete: "削除",
    edit: "編集",
    add: "追加",
    close: "閉じる",
    back: "戻る",
    retry: "再試行",
    today: "今日",
    yesterday: "昨日",
    confirm: "確認",
    optional: "任意",
    showMore: "もっと見る",
  },
```

- [ ] **Step 12: Verify**

Run: `npm run typecheck -w app && npm run build -w app`
Expected: both succeed. The new components are not imported anywhere yet — fine (`noUnusedLocals` does not flag exports).

- [ ] **Step 13: Commit**

```bash
git add app/ package-lock.json
git commit -m "feat: add warm design system tokens, ui primitives, and category icons"
```

---

### Task 2: Household-time date utilities + app Vitest harness (TDD)

**Files:**
- Modify: `app/package.json` (vitest + test script)
- Create: `app/vitest.config.ts`
- Modify: `app/tsconfig.json` (include test/)
- Modify: root `package.json` (root test runs app unit tests too)
- Test: `app/test/dates.test.ts`
- Create: `app/src/lib/dates.ts`

This is the plan's only TDD task (spec §9: calendar grid math gets real tests; Task 11 adds the timeline-lane test to the same harness). Tests run in a plain **node** environment — the functions are pure.

- [ ] **Step 1: Install Vitest and wire the scripts**

Run: `npm install -w app -D vitest@~3.2.0`

Add to `app/package.json` `scripts`:

```json
    "test": "vitest run"
```

Create `app/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
```

In `app/tsconfig.json`, change `"include"` to:

```json
  "include": ["src", "test", "vite.config.ts", "vitest.config.ts"]
```

Update the root `package.json` `"test"` script to:

```json
    "test": "npm run build -w app && npm run test -w worker && npm run test -w app"
```

- [ ] **Step 2: Write the failing test `app/test/dates.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  addDays,
  dayKeyOf,
  formatTime,
  minutesIntoDay,
  monthGrid,
  monthKeyOf,
  relativeDayKind,
  shiftAnchor,
  shiftMonth,
  viewDays,
} from "../src/lib/dates";

// 2026-06-11 03:30:00 UTC == 2026-06-11 12:30 JST (tzOffsetMin +540)
const T = Date.UTC(2026, 5, 11, 3, 30);

describe("dayKeyOf / minutesIntoDay (household time)", () => {
  it("uses the activity's stored offset, not the device", () => {
    expect(dayKeyOf(T, 540)).toBe("2026-06-11");
    expect(minutesIntoDay(T, 540)).toBe(12 * 60 + 30);
  });
  it("crosses midnight correctly", () => {
    // 2026-06-11 23:30 UTC == 2026-06-12 08:30 JST
    const late = Date.UTC(2026, 5, 11, 23, 30);
    expect(dayKeyOf(late, 540)).toBe("2026-06-12");
    expect(minutesIntoDay(late, 540)).toBe(8 * 60 + 30);
    // ...and negative offsets: 2026-06-11 03:30 UTC == 2026-06-10 22:30 at UTC-5
    expect(dayKeyOf(T, -300)).toBe("2026-06-10");
  });
});

describe("addDays / monthKeyOf / shiftMonth", () => {
  it("adds across month and year boundaries", () => {
    expect(addDays("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29"); // leap year
  });
  it("derives and shifts month keys", () => {
    expect(monthKeyOf("2026-06-11")).toBe("2026-06");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("monthGrid (Monday start, leading/trailing fill)", () => {
  it("June 2026 starts on a Monday: no leading fill, 35 cells", () => {
    const grid = monthGrid("2026-06");
    expect(grid).toHaveLength(35);
    expect(grid[0]).toEqual({ key: "2026-06-01", inMonth: true });
    expect(grid[29]).toEqual({ key: "2026-06-30", inMonth: true });
    expect(grid[34]).toEqual({ key: "2026-07-05", inMonth: false });
  });
  it("February 2026 starts on a Sunday: 6 leading days, 35 cells", () => {
    const grid = monthGrid("2026-02");
    expect(grid).toHaveLength(35);
    expect(grid[0]).toEqual({ key: "2026-01-26", inMonth: false });
    expect(grid[6]).toEqual({ key: "2026-02-01", inMonth: true });
    expect(grid[34]).toEqual({ key: "2026-03-01", inMonth: false });
  });
});

describe("viewDays / shiftAnchor", () => {
  it("week view returns the Monday-start week containing the anchor", () => {
    // 2026-06-11 is a Thursday; its week is Mon 06-08 .. Sun 06-14
    const days = viewDays("week", "2026-06-11");
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-06-08");
    expect(days[6]).toBe("2026-06-14");
  });
  it("3day starts at the anchor; day is just the anchor", () => {
    expect(viewDays("3day", "2026-06-11")).toEqual([
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
    ]);
    expect(viewDays("day", "2026-06-11")).toEqual(["2026-06-11"]);
  });
  it("shiftAnchor steps by the view size", () => {
    expect(shiftAnchor("week", "2026-06-11", 1)).toBe("2026-06-18");
    expect(shiftAnchor("3day", "2026-06-11", -1)).toBe("2026-06-08");
    expect(shiftAnchor("day", "2026-06-11", 1)).toBe("2026-06-12");
  });
});

describe("formatting", () => {
  it("formats household time with Intl regardless of device tz", () => {
    expect(formatTime(T, 540, "en")).toMatch(/12:30/);
  });
  it("classifies relative days", () => {
    expect(relativeDayKind("2026-06-11", "2026-06-11")).toBe("today");
    expect(relativeDayKind("2026-06-10", "2026-06-11")).toBe("yesterday");
    expect(relativeDayKind("2026-06-01", "2026-06-11")).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test -w app`
Expected: FAIL — `../src/lib/dates` not found.

- [ ] **Step 4: Create `app/src/lib/dates.ts`**

```ts
/**
 * Date math for Pawlog views.
 *
 * Two clocks exist:
 * - HOUSEHOLD time: `occurredAt + tzOffsetMin * 60000`, read via UTC getters.
 *   Used for day-keys, timeline positions, and displayed times — it matches
 *   the server's monthly-summary bucketing exactly.
 * - DEVICE time: used only to build query ranges (from/to epoch ms) and the
 *   "today" anchor. For a family app the device clock ≈ household clock.
 *
 * Day keys are "YYYY-MM-DD"; month keys are "YYYY-MM". Weeks start Monday.
 */

export type DayKey = string;
export type MonthKey = string;
export type CalendarView = "month" | "week" | "3day" | "day";

const MIN_MS = 60_000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Positive east of UTC (JST = +540). The value to send as `tzOffsetMin`. */
export function deviceTzOffsetMin(): number {
  return -new Date().getTimezoneOffset();
}

/** Household calendar day of an activity. */
export function dayKeyOf(occurredAt: number, tzOffsetMin: number): DayKey {
  const d = new Date(occurredAt + tzOffsetMin * MIN_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Minutes since household midnight (0..1439) — timeline y-position. */
export function minutesIntoDay(occurredAt: number, tzOffsetMin: number): number {
  const d = new Date(occurredAt + tzOffsetMin * MIN_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Today's day-key on the device clock. */
export function todayKey(now: number = Date.now()): DayKey {
  return dayKeyOf(now, deviceTzOffsetMin());
}

export function dayKeyToParts(key: DayKey): {
  year: number;
  month: number;
  day: number;
} {
  return {
    year: Number(key.slice(0, 4)),
    month: Number(key.slice(5, 7)),
    day: Number(key.slice(8, 10)),
  };
}

/** Day-key arithmetic in UTC space (immune to DST). */
export function addDays(key: DayKey, n: number): DayKey {
  const { year, month, day } = dayKeyToParts(key);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function monthKeyOf(key: DayKey): MonthKey {
  return key.slice(0, 7);
}

export function shiftMonth(monthKey: MonthKey, delta: number): MonthKey {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

/** Device-local start of a day in epoch ms (query range building). */
export function dayStartMs(key: DayKey): number {
  const { year, month, day } = dayKeyToParts(key);
  return new Date(year, month - 1, day).getTime();
}

/** Device-local inclusive end of a day (the API's `to` is `lte`). */
export function dayEndMs(key: DayKey): number {
  const { year, month, day } = dayKeyToParts(key);
  return new Date(year, month - 1, day + 1).getTime() - 1;
}

/** Inclusive epoch-ms range covering a consecutive day-key span. */
export function rangeMs(days: DayKey[]): { from: number; to: number } {
  const first = days[0] ?? todayKey();
  const last = days[days.length - 1] ?? first;
  return { from: dayStartMs(first), to: dayEndMs(last) };
}

/** ISO weekday 0=Monday .. 6=Sunday for a day-key. */
function mondayIndex(key: DayKey): number {
  const { year, month, day } = dayKeyToParts(key);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export type MonthGridCell = { key: DayKey; inMonth: boolean };

/**
 * Full-week month grid (Monday start): leading/trailing out-of-month days
 * pad to a multiple of 7 (35 or 42 cells; 28 for a Feb starting on Monday).
 */
export function monthGrid(monthKey: MonthKey): MonthGridCell[] {
  const first: DayKey = `${monthKey}-01`;
  const start = addDays(first, -mondayIndex(first));
  const cells: MonthGridCell[] = [];
  let cursor = start;
  // emit full weeks until the upcoming week no longer touches the month
  do {
    for (let i = 0; i < 7; i++) {
      cells.push({ key: cursor, inMonth: monthKeyOf(cursor) === monthKey });
      cursor = addDays(cursor, 1);
    }
  } while (monthKeyOf(cursor) === monthKey);
  return cells;
}

/** The day columns a timeline view shows for a given anchor day. */
export function viewDays(
  view: Exclude<CalendarView, "month">,
  anchor: DayKey,
): DayKey[] {
  if (view === "day") return [anchor];
  if (view === "3day") return [anchor, addDays(anchor, 1), addDays(anchor, 2)];
  const monday = addDays(anchor, -mondayIndex(anchor));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Swipe/arrow step: one full view-width per step. */
export function shiftAnchor(
  view: Exclude<CalendarView, "month">,
  anchor: DayKey,
  delta: number,
): DayKey {
  const step = view === "week" ? 7 : view === "3day" ? 3 : 1;
  return addDays(anchor, delta * step);
}

/** Household wall-clock time of an activity, via Intl. */
export function formatTime(
  occurredAt: number,
  tzOffsetMin: number,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(occurredAt + tzOffsetMin * MIN_MS));
}

/** Long date heading for a day-key ("Thursday, June 11" / 「6月11日木曜日」). */
export function formatDayHeading(key: DayKey, locale: string): string {
  const { year, month, day } = dayKeyToParts(key);
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** Short column header for timelines ("Thu 11" / 「11日(木)」). */
export function formatDayShort(key: DayKey, locale: string): string {
  const { year, month, day } = dayKeyToParts(key);
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** Month title ("June 2026" / 「2026年6月」). */
export function formatMonthTitle(monthKey: MonthKey, locale: string): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** Full date+time for the detail screen. */
export function formatDateTime(
  occurredAt: number,
  tzOffsetMin: number,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(occurredAt + tzOffsetMin * MIN_MS));
}

export function relativeDayKind(
  key: DayKey,
  today: DayKey,
): "today" | "yesterday" | null {
  if (key === today) return "today";
  if (key === addDays(today, -1)) return "yesterday";
  return null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -w app`
Expected: PASS (all dates tests).

- [ ] **Step 6: Full verification**

Run: `npm run typecheck -w app && npm run build -w app && npm run test`
Expected: typecheck/build clean; root test runs app build → worker tests → app unit tests, all green.

- [ ] **Step 7: Commit**

```bash
git add app/ package.json package-lock.json
git commit -m "feat: add household-time date utilities with unit tests"
```

---

### Task 3: Typed API hook layer (all resources) + `UpdateMeResponse` in shared

**Files:**
- Modify: `shared/src/index.ts` (add `UpdateMeResponse` — the plan's only shared touch)
- Modify: `app/src/api/client.ts` (FormData support)
- Create: `app/src/api/keys.ts`
- Modify: `app/src/api/me.ts` (add `useUpdateMe`, `useDeleteAccount`)
- Create: `app/src/api/pets.ts`
- Create: `app/src/api/activities.ts`
- Create: `app/src/api/presets.ts`
- Create: `app/src/api/photos.ts`
- Create: `app/src/api/export.ts`
- Create: `app/src/lib/details.ts`

Every hook takes an explicit `petId`. Query keys are namespaced by petId; each mutation's invalidations are listed in its `onSuccess`. The worker is NOT modified (its `PATCH /api/me` response already matches `UpdateMeResponse` structurally).

- [ ] **Step 1: Append to `shared/src/index.ts`**

```ts
// ---------------------------------------------------------------------------
// Plan 3: frontend
// ---------------------------------------------------------------------------

/** Response shape of PATCH /api/me (already produced by the worker). */
export type UpdateMeResponse = {
  user: MeResponse["user"];
};
```

- [ ] **Step 2: Teach `app/src/api/client.ts` about FormData**

Replace the Content-Type line inside `api()`:

```ts
    if (init.body) headers.set("Content-Type", "application/json");
```

with:

```ts
    if (init.body && !(init.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
```

(FormData must set its own multipart boundary; the CSRF header logic is unchanged.)

- [ ] **Step 3: Create `app/src/api/keys.ts`**

```ts
import type { Category } from "@pawlog/shared";

/**
 * Query-key conventions (everything pet-scoped starts with [root, petId]):
 *   ["me"]                                      session + pet list
 *   ["pets", petId]                             full PetResponse (targets, breed…)
 *   ["activities", petId, ...]                  every activity list/detail
 *   ["activities", petId, "range", from, to]    calendar/home/day ranges
 *   ["activities", petId, "log", cats, q]       infinite log pages
 *   ["activities", petId, "one", id]            single activity
 *   ["summary", petId, month]                   month-grid category dots
 *   ["presets", petId]                          quick-add presets
 *
 * Invalidation rules (enforced in the mutation hooks):
 *   activity create/update/delete  → ["activities", petId] + ["summary", petId, month-of-activity]
 *   photo add/remove               → ["activities", petId]
 *   preset mutations               → ["presets", petId]
 *   pet create/update/avatar       → ["me"] + ["pets", petId]
 */
export const keys = {
  me: ["me"] as const,
  pet: (petId: string) => ["pets", petId] as const,
  activitiesRoot: (petId: string) => ["activities", petId] as const,
  activitiesRange: (petId: string, from: number, to: number) =>
    ["activities", petId, "range", from, to] as const,
  activitiesLog: (petId: string, categories: Category[], q: string) =>
    ["activities", petId, "log", [...categories].sort().join(","), q] as const,
  activity: (petId: string, id: string) =>
    ["activities", petId, "one", id] as const,
  summaryRoot: (petId: string) => ["summary", petId] as const,
  summary: (petId: string, month: string) => ["summary", petId, month] as const,
  presets: (petId: string) => ["presets", petId] as const,
};
```

- [ ] **Step 4: Extend `app/src/api/me.ts`**

Append (and extend the imports at the top of the file to):

```ts
import type { MeResponse, UpdateMeInput, UpdateMeResponse } from "@pawlog/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, setCsrfToken } from "./client";
import { keys } from "./keys";
```

```ts
export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMeInput) =>
      api<UpdateMeResponse>("/api/me", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: (res) => {
      qc.setQueryData<MeResponse>(keys.me, (old) =>
        old ? { ...old, user: res.user } : old,
      );
    },
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: (confirmEmail: string) =>
      api<{ ok: boolean }>("/api/me", {
        method: "DELETE",
        body: JSON.stringify({ confirmEmail }),
      }),
  });
}
```

(Also change the existing `useMe`'s `queryKey: ["me"]` to `queryKey: keys.me` for consistency.)

- [ ] **Step 5: Create `app/src/api/pets.ts`**

```ts
import type {
  CreatePetInput,
  PetResponse,
  PetTargetsInput,
  UpdatePetInput,
} from "@pawlog/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { keys } from "./keys";

export function usePet(petId: string, enabled = true) {
  return useQuery({
    queryKey: keys.pet(petId),
    queryFn: () => api<PetResponse>(`/api/pets/${petId}`),
    enabled,
  });
}

export function useCreatePet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePetInput) =>
      api<PetResponse>("/api/pets", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
}

export function useUpdatePet(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePetInput) =>
      api<PetResponse>(`/api/pets/${petId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.me }),
        qc.invalidateQueries({ queryKey: keys.pet(petId) }),
      ]);
    },
  });
}

export function useSetPetTargets(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PetTargetsInput) =>
      api<PetTargetsInput>(`/api/pets/${petId}/targets`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.pet(petId) }),
  });
}

export function useUploadPetAvatar(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api<{ avatarR2Key: string }>(`/api/pets/${petId}/avatar`, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.me }),
        qc.invalidateQueries({ queryKey: keys.pet(petId) }),
      ]);
    },
  });
}
```

- [ ] **Step 6: Create `app/src/api/activities.ts`**

```ts
import type {
  ActivityListResponse,
  ActivityResponse,
  Category,
  CreateActivityInput,
  DaySummaryResponse,
  UpdateActivityInput,
} from "@pawlog/shared";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { dayKeyOf, monthKeyOf } from "../lib/dates";
import { api } from "./client";
import { keys } from "./keys";

function listPath(
  petId: string,
  params: {
    from?: number;
    to?: number;
    categories?: Category[];
    q?: string;
    cursor?: string;
    limit?: number;
  },
): string {
  const search = new URLSearchParams();
  if (params.from !== undefined) search.set("from", String(params.from));
  if (params.to !== undefined) search.set("to", String(params.to));
  for (const cat of params.categories ?? []) search.append("category", cat);
  if (params.q) search.set("q", params.q);
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  const qs = search.toString();
  return `/api/pets/${petId}/activities${qs ? `?${qs}` : ""}`;
}

/** All activities in [from, to] (inclusive) — calendar ranges, "today so far". */
export function useActivitiesRange(petId: string, from: number, to: number) {
  return useQuery({
    queryKey: keys.activitiesRange(petId, from, to),
    queryFn: async () => {
      const res = await api<ActivityListResponse>(
        listPath(petId, { from, to, limit: 200 }),
      );
      return res.items;
    },
  });
}

/** Infinite reverse-chronological log with filters. */
export function useLogActivities(
  petId: string,
  filters: { categories: Category[]; q: string },
) {
  return useInfiniteQuery({
    queryKey: keys.activitiesLog(petId, filters.categories, filters.q),
    queryFn: ({ pageParam }) =>
      api<ActivityListResponse>(
        listPath(petId, {
          categories: filters.categories,
          q: filters.q || undefined,
          cursor: pageParam,
          limit: 50,
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useActivity(petId: string, id: string) {
  return useQuery({
    queryKey: keys.activity(petId, id),
    queryFn: () => api<ActivityResponse>(`/api/pets/${petId}/activities/${id}`),
  });
}

export function useDaySummary(petId: string, month: string) {
  return useQuery({
    queryKey: keys.summary(petId, month),
    queryFn: () =>
      api<DaySummaryResponse>(`/api/pets/${petId}/summary?month=${month}`),
  });
}

async function invalidateActivityData(
  qc: ReturnType<typeof useQueryClient>,
  petId: string,
  occurredAt: number,
  tzOffsetMin: number,
): Promise<void> {
  const month = monthKeyOf(dayKeyOf(occurredAt, tzOffsetMin));
  await Promise.all([
    qc.invalidateQueries({ queryKey: keys.activitiesRoot(petId) }),
    qc.invalidateQueries({ queryKey: keys.summary(petId, month) }),
  ]);
}

export function useCreateActivity(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateActivityInput) =>
      api<ActivityResponse>(`/api/pets/${petId}/activities`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (created) =>
      invalidateActivityData(qc, petId, created.occurredAt, created.tzOffsetMin),
  });
}

export function useUpdateActivity(petId: string, id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateActivityInput) =>
      api<ActivityResponse>(`/api/pets/${petId}/activities/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: (updated) =>
      invalidateActivityData(qc, petId, updated.occurredAt, updated.tzOffsetMin),
  });
}

export function useDeleteActivity(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean }>(`/api/pets/${petId}/activities/${id}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      // occurredAt is unknown here; invalidate all months for this pet
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.activitiesRoot(petId) }),
        qc.invalidateQueries({ queryKey: keys.summaryRoot(petId) }),
      ]);
    },
  });
}
```

- [ ] **Step 7: Create `app/src/api/presets.ts`**

```ts
import type {
  PresetInput,
  PresetResponse,
  UpdatePresetInput,
} from "@pawlog/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { keys } from "./keys";

export function usePresets(petId: string) {
  return useQuery({
    queryKey: keys.presets(petId),
    queryFn: () => api<PresetResponse[]>(`/api/pets/${petId}/presets`),
  });
}

export function useCreatePreset(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PresetInput) =>
      api<PresetResponse>(`/api/pets/${petId}/presets`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.presets(petId) }),
  });
}

export function useUpdatePreset(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePresetInput }) =>
      api<PresetResponse>(`/api/pets/${petId}/presets/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.presets(petId) }),
  });
}

export function useDeletePreset(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean }>(`/api/pets/${petId}/presets/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.presets(petId) }),
  });
}
```

- [ ] **Step 8: Create `app/src/api/photos.ts`**

```ts
import type { ActivityPhotoMeta } from "@pawlog/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { keys } from "./keys";

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_ACTIVITY = 6;

export function photoUrl(photoId: string, size: "thumb" | "full"): string {
  return `/api/photos/${photoId}?size=${size}`;
}

/** Plain async fn (not a hook) so the add-flow can upload sequentially. */
export function uploadActivityPhoto(
  petId: string,
  activityId: string,
  file: File,
): Promise<ActivityPhotoMeta> {
  const form = new FormData();
  form.append("file", file);
  return api<ActivityPhotoMeta>(
    `/api/pets/${petId}/activities/${activityId}/photos`,
    { method: "POST", body: form },
  );
}

export function useDeletePhoto(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) =>
      api<{ ok: boolean }>(`/api/photos/${photoId}`, { method: "DELETE" }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: keys.activitiesRoot(petId) }),
  });
}
```

- [ ] **Step 9: Create `app/src/api/export.ts`**

Exports are plain browser downloads (cookie-authenticated GETs) — anchors, not fetches.

```ts
export function myExportUrl(): string {
  return "/api/me/export";
}

export function petExportUrl(petId: string, format: "json" | "csv"): string {
  return `/api/pets/${petId}/export?format=${format}`;
}
```

- [ ] **Step 10: Create `app/src/lib/details.ts`**

Typed access to the per-category `details` payloads, derived from the SAME Zod schemas the server validates with.

```ts
import {
  activityDetailsSchemas,
  type Category,
} from "@pawlog/shared";
import type { z } from "zod";

export type DetailsMap = {
  [C in Category]: z.infer<(typeof activityDetailsSchemas)[C]>;
};

/** Safe-parses an unknown payload into the typed details for a category. */
export function parseDetails<C extends Category>(
  category: C,
  details: unknown,
): DetailsMap[C] | null {
  const parsed = activityDetailsSchemas[category].safeParse(details ?? {});
  return parsed.success ? (parsed.data as DetailsMap[C]) : null;
}
```

- [ ] **Step 11: Verify (shared touched ⇒ root test)**

Run: `npm run typecheck -w app && npm run build -w app && npm run typecheck -w shared && npm run test`
Expected: all green (worker tests unaffected — shared change is additive).

- [ ] **Step 12: Commit**

```bash
git add shared/ app/
git commit -m "feat: add typed tanstack query api hooks for all resources"
```

---

### Task 4: App shell — router, pet switcher, tab bar + FAB, sidebar, warm Login, error states

**Files:**
- Create: `app/src/state/pets.tsx`
- Create: `app/src/components/ErrorScreen.tsx`
- Modify: `app/src/App.tsx` (router + error/retry + splash)
- Modify: `app/src/routes/Shell.tsx` (full rewrite: layout chrome)
- Create: `app/src/routes/Home.tsx` (minimal first version — replaced wholesale in Task 9)
- Create: `app/src/routes/CalendarTab.tsx` (minimal — replaced wholesale in Task 10)
- Create: `app/src/routes/LogTab.tsx` (minimal — replaced wholesale in Task 12)
- Create: `app/src/routes/HealthTab.tsx` (FINAL Plan-3 placeholder)
- Modify: `app/src/routes/Login.tsx` (full warm rewrite + OAuth error banner)
- Modify: `app/src/index.css` (delete the deprecated `warm-*` aliases)
- Modify: `worker/src/routes/auth.ts` (**sanctioned worker touch**: OAuth error redirect)
- Test: `worker/test/oauth.test.ts` (extend)
- Modify: `app/src/i18n/messages.ts`, `en.ts`, `ja.ts`

- [ ] **Step 1: Create `app/src/state/pets.tsx`**

```tsx
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { MeResponse, Role } from "@pawlog/shared";

export type MePet = MeResponse["pets"][number];

const STORAGE_KEY = "pawlog:selectedPetId";

type PetContextValue = {
  pets: MePet[];
  selectedPet: MePet | null;
  selectPet: (id: string) => void;
  roleFor: (petId: string) => Role | null;
};

const PetContext = createContext<PetContextValue | null>(null);

export function PetProvider({
  me,
  children,
}: {
  me: MeResponse;
  children: ReactNode;
}) {
  const [storedId, setStoredId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );
  const pets = me.pets;
  const value = useMemo<PetContextValue>(() => {
    const selectedPet = pets.find((p) => p.id === storedId) ?? pets[0] ?? null;
    return {
      pets,
      selectedPet,
      selectPet: (id: string) => {
        localStorage.setItem(STORAGE_KEY, id);
        setStoredId(id);
      },
      roleFor: (petId: string) =>
        pets.find((p) => p.id === petId)?.role ?? null,
    };
  }, [pets, storedId]);
  return <PetContext.Provider value={value}>{children}</PetContext.Provider>;
}

export function usePets(): PetContextValue {
  const ctx = useContext(PetContext);
  if (!ctx) throw new Error("usePets must be used inside PetProvider");
  return ctx;
}

/** For screens only reachable when ≥1 pet exists (Shell guards zero-pet). */
export function useRequiredPet(): MePet {
  const { selectedPet } = usePets();
  if (!selectedPet) throw new Error("useRequiredPet with no pets");
  return selectedPet;
}
```

- [ ] **Step 2: Create `app/src/components/ErrorScreen.tsx`**

```tsx
import { useT } from "../i18n";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { PawIcon } from "./icons";

function SadArt() {
  return (
    <div className="relative h-28 w-32" aria-hidden="true">
      <div className="blob absolute left-2 top-3 h-24 w-24 bg-berry-100" />
      <PawIcon className="absolute left-9 top-10 h-11 w-11 rotate-[168deg] text-berry-600/50" />
    </div>
  );
}

export function ErrorScreen({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-cream-100 p-6">
      <EmptyState
        art={<SadArt />}
        title={t.errors.title}
        hint={t.errors.body}
        action={<Button onClick={onRetry}>{t.common.retry}</Button>}
      />
    </main>
  );
}
```

- [ ] **Step 3: Rewrite `app/src/routes/Shell.tsx`**

The whole chrome: mobile bottom tab bar with the overlapping center FAB, desktop left sidebar, sticky header with the pet-avatar switcher. The Add/Quick-Add sheets mount in Tasks 7–8; until then the FAB toggles state that renders nothing (explicitly wired later — `addOpen`/`quickOpen` are already threaded so Tasks 7–8 only add the sheet elements).

```tsx
import { useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { PetAvatar } from "../components/Avatar";
import { EmptyState } from "../components/EmptyState";
import { Button } from "../components/Button";
import { IconButton } from "../components/IconButton";
import {
  CalendarIcon,
  GearIcon,
  HeartIcon,
  HomeIcon,
  ListIcon,
  PawIcon,
  PlusIcon,
} from "../components/icons";
import { useT } from "../i18n";
import { cn } from "../lib/cn";
import { usePets } from "../state/pets";

export type ShellOutletContext = {
  openAdd: () => void;
  openQuickAdd: () => void;
};

function TabLink({
  to,
  label,
  children,
}: {
  to: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold transition",
          isActive ? "text-clay-600" : "text-ink-faint hover:text-ink-soft",
        )
      }
    >
      {children}
      <span>{label}</span>
    </NavLink>
  );
}

function SideLink({
  to,
  label,
  children,
}: {
  to: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-full px-4 py-2.5 font-semibold transition",
          isActive
            ? "bg-clay-100 text-clay-800"
            : "text-ink-soft hover:bg-cream-100 hover:text-ink",
        )
      }
    >
      {children}
      <span>{label}</span>
    </NavLink>
  );
}

export function Shell() {
  const t = useT();
  const navigate = useNavigate();
  const { pets, selectedPet, selectPet } = usePets();
  const [addOpen, setAddOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);

  const outletContext: ShellOutletContext = {
    openAdd: () => setAddOpen(true),
    openQuickAdd: () => setQuickOpen(true),
  };
  // Task 7 mounts <AddSheet open={addOpen} …/>, Task 8 mounts the Quick Add
  // sheet for quickOpen — the state is wired now so screens can call into it.
  void addOpen;
  void quickOpen;

  if (!selectedPet) {
    // Zero pets: Task 5 replaces this branch with the full Onboarding screen.
    return (
      <main className="flex min-h-dvh items-center justify-center bg-cream-100 p-6">
        <EmptyState title={t.appName} hint={t.tagline} />
      </main>
    );
  }

  return (
    <div className="min-h-dvh bg-cream-100">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-cream-200 bg-paper px-4 py-6 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2 font-display text-2xl text-clay-700">
          <PawIcon className="h-7 w-7" />
          {t.appName}
        </div>
        <nav className="flex flex-col gap-1" aria-label={t.shell.mainNav}>
          <SideLink to="/" label={t.nav.home}>
            <HomeIcon className="h-5 w-5" />
          </SideLink>
          <SideLink to="/calendar" label={t.nav.calendar}>
            <CalendarIcon className="h-5 w-5" />
          </SideLink>
          <SideLink to="/log" label={t.nav.log}>
            <ListIcon className="h-5 w-5" />
          </SideLink>
          <SideLink to="/health" label={t.nav.health}>
            <HeartIcon className="h-5 w-5" />
          </SideLink>
        </nav>
        <div className="mt-auto">
          <SideLink to="/settings" label={t.nav.settings}>
            <GearIcon className="h-5 w-5" />
          </SideLink>
        </div>
      </aside>

      <div className="md:pl-60">
        {/* header: wordmark (mobile), pet switcher, add (desktop), settings */}
        <header className="pt-safe sticky top-0 z-30 border-b border-cream-200 bg-cream-100/90 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2.5">
            <span className="flex items-center gap-1.5 font-display text-lg text-clay-700 md:hidden">
              <PawIcon className="h-6 w-6" />
              {t.appName}
            </span>
            <div
              role="group"
              aria-label={t.shell.petSwitcher}
              className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
            >
              {pets.map((pet) => {
                const selected = pet.id === selectedPet.id;
                return (
                  <button
                    key={pet.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => selectPet(pet.id)}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 transition active:scale-95",
                      selected
                        ? "border-clay-300 bg-clay-50"
                        : "border-transparent opacity-70 hover:opacity-100",
                    )}
                  >
                    <PetAvatar pet={pet} size="sm" />
                    <span className="text-sm font-semibold text-ink">
                      {pet.name}
                    </span>
                  </button>
                );
              })}
            </div>
            <Button
              size="sm"
              className="hidden md:inline-flex"
              onClick={() => setAddOpen(true)}
            >
              <PlusIcon className="h-4 w-4" />
              {t.nav.addActivity}
            </Button>
            <IconButton
              label={t.nav.settings}
              className="md:hidden"
              onClick={() => navigate("/settings")}
            >
              <GearIcon className="h-5 w-5" />
            </IconButton>
          </div>
        </header>

        <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-4 md:pb-12">
          <Outlet context={outletContext} />
        </main>
      </div>

      {/* mobile tab bar + overlapping FAB */}
      <nav
        aria-label={t.shell.mainNav}
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-cream-200 bg-paper/95 backdrop-blur md:hidden"
      >
        <div className="mx-auto grid max-w-md grid-cols-5 items-center px-2">
          <TabLink to="/" label={t.nav.home}>
            <HomeIcon className="h-6 w-6" />
          </TabLink>
          <TabLink to="/calendar" label={t.nav.calendar}>
            <CalendarIcon className="h-6 w-6" />
          </TabLink>
          <div className="relative flex justify-center">
            <button
              type="button"
              aria-label={t.nav.addActivity}
              onClick={() => setAddOpen(true)}
              className="shadow-fab -mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-clay-500 text-white transition active:scale-95"
            >
              <span className="relative">
                <PawIcon className="h-7 w-7" />
                <PlusIcon className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 rounded-full bg-clay-500" />
              </span>
            </button>
          </div>
          <TabLink to="/log" label={t.nav.log}>
            <ListIcon className="h-6 w-6" />
          </TabLink>
          <TabLink to="/health" label={t.nav.health}>
            <HeartIcon className="h-6 w-6" />
          </TabLink>
        </div>
      </nav>
    </div>
  );
}
```

- [ ] **Step 4: Create the four tab screens**

`app/src/routes/HealthTab.tsx` — the FINAL Plan-3 version (Plan 4 replaces it with charts):

```tsx
import { EmptyState } from "../components/EmptyState";
import { HeartIcon, PawIcon } from "../components/icons";
import { useT } from "../i18n";

function HealthArt() {
  return (
    <div className="relative h-28 w-32" aria-hidden="true">
      <div className="blob absolute left-2 top-3 h-24 w-24 bg-cat-vet-soft" />
      <HeartIcon className="absolute left-8 top-9 h-12 w-12 text-cat-vet" />
      <PawIcon className="absolute right-0 top-0 h-8 w-8 rotate-12 text-clay-300" />
    </div>
  );
}

export function HealthTab() {
  const t = useT();
  return (
    <div className="animate-pop">
      <h1 className="mb-2 text-2xl text-ink">{t.nav.health}</h1>
      <EmptyState
        art={<HealthArt />}
        title={t.health.soonTitle}
        hint={t.health.soonBody}
      />
    </div>
  );
}
```

`app/src/routes/Home.tsx` — minimal version, replaced wholesale in Task 9:

```tsx
import { PetAvatar } from "../components/Avatar";
import { useT } from "../i18n";
import { useRequiredPet } from "../state/pets";

export function Home() {
  const t = useT();
  const pet = useRequiredPet();
  return (
    <div className="animate-pop flex items-center gap-4">
      <PetAvatar pet={pet} size="lg" />
      <h1 className="text-2xl text-ink">{t.greeting(pet.name)}</h1>
    </div>
  );
}
```

`app/src/routes/CalendarTab.tsx` — minimal version, replaced wholesale in Task 10:

```tsx
import { EmptyState } from "../components/EmptyState";
import { useT } from "../i18n";

export function CalendarTab() {
  const t = useT();
  return <EmptyState title={t.nav.calendar} />;
}
```

`app/src/routes/LogTab.tsx` — minimal version, replaced wholesale in Task 12:

```tsx
import { EmptyState } from "../components/EmptyState";
import { useT } from "../i18n";

export function LogTab() {
  const t = useT();
  return <EmptyState title={t.nav.log} />;
}
```

- [ ] **Step 5: Rewrite `app/src/routes/Login.tsx` (the first-impression screen)**

Full warm treatment: layered blob atmosphere, oversized Fredoka wordmark, staggered pop-in reveals, and the OAuth-error banner read from `?auth_error=`.

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Button } from "../components/Button";
import { PawIcon } from "../components/icons";
import { useT } from "../i18n";

export function Login() {
  const t = useT();
  const qc = useQueryClient();
  const authError = new URLSearchParams(window.location.search).get(
    "auth_error",
  );

  const devLogin = async () => {
    await api("/api/auth/dev-login", {
      method: "POST",
      body: JSON.stringify({}),
    });
    await qc.invalidateQueries({ queryKey: ["me"] });
  };

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-cream-100 p-6">
      {/* atmosphere */}
      <div
        aria-hidden="true"
        className="blob absolute -left-24 -top-20 h-72 w-72 bg-clay-100"
      />
      <div
        aria-hidden="true"
        className="blob absolute -bottom-24 -right-20 h-80 w-80 bg-cat-water-soft"
      />
      <PawIcon
        aria-hidden="true"
        className="absolute left-10 top-1/3 h-10 w-10 -rotate-12 text-cream-200"
      />
      <PawIcon
        aria-hidden="true"
        className="absolute bottom-1/4 right-12 h-14 w-14 rotate-[24deg] text-cream-200"
      />

      <div className="relative flex w-full max-w-sm flex-col items-center gap-5 text-center">
        <span className="animate-pop blob flex h-24 w-24 items-center justify-center bg-clay-500 text-white shadow-float">
          <PawIcon className="h-12 w-12" />
        </span>
        <h1
          className="animate-pop text-5xl text-clay-800"
          style={{ animationDelay: "80ms" }}
        >
          {t.appName}
        </h1>
        <p
          className="animate-pop text-ink-soft"
          style={{ animationDelay: "140ms" }}
        >
          {t.tagline}
        </p>

        {authError && (
          <p
            role="alert"
            className="animate-pop w-full rounded-card bg-berry-100 px-4 py-3 text-sm font-semibold text-berry-700"
          >
            {t.login.authError}
          </p>
        )}

        <a
          href="/api/auth/google"
          className="animate-pop shadow-card inline-flex w-full items-center justify-center gap-2 rounded-full bg-clay-500 px-7 py-3.5 text-lg font-semibold text-white transition hover:bg-clay-600 active:scale-[0.98]"
          style={{ animationDelay: "200ms" }}
        >
          {t.signInWithGoogle}
        </a>
        {import.meta.env.DEV && (
          <Button
            variant="ghost"
            size="sm"
            onClick={devLogin}
            className="animate-pop"
            style={{ animationDelay: "260ms" }}
          >
            {t.signInDev}
          </Button>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Rewrite `app/src/App.tsx` (router + the non-401 error screen)**

`BrowserRouter` lives here (not main.tsx) so it only mounts for authenticated users; routes added by later tasks slot into the `<Route element={<Shell/>}>` block.

```tsx
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { ApiError } from "./api/client";
import { useMe } from "./api/me";
import { ErrorScreen } from "./components/ErrorScreen";
import { PawIcon } from "./components/icons";
import { I18nProvider } from "./i18n";
import { CalendarTab } from "./routes/CalendarTab";
import { HealthTab } from "./routes/HealthTab";
import { Home } from "./routes/Home";
import { Login } from "./routes/Login";
import { LogTab } from "./routes/LogTab";
import { Shell } from "./routes/Shell";
import { PetProvider } from "./state/pets";

function Splash() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-cream-100">
      <PawIcon className="animate-paw h-14 w-14 text-clay-400" />
    </main>
  );
}

export function App() {
  const me = useMe();
  const locale = me.data?.user.locale;
  return (
    <I18nProvider locale={locale}>
      {me.isLoading ? (
        <Splash />
      ) : me.error instanceof ApiError && me.error.status === 401 ? (
        <Login />
      ) : me.error ? (
        <ErrorScreen onRetry={() => void me.refetch()} />
      ) : me.data ? (
        <PetProvider me={me.data}>
          <BrowserRouter>
            <Routes>
              <Route element={<Shell />}>
                <Route path="/" element={<Home />} />
                <Route path="/calendar" element={<CalendarTab />} />
                <Route path="/log" element={<LogTab />} />
                <Route path="/health" element={<HealthTab />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </PetProvider>
      ) : (
        <Login />
      )}
    </I18nProvider>
  );
}
```

- [ ] **Step 7: Delete the deprecated aliases from `app/src/index.css`**

Remove the block:

```css
  /* DEPRECATED Plan-1 aliases — removed in Task 4 */
  --color-warm-50: #fdfaf4;
  --color-warm-100: #faf3e7;
  --color-warm-500: #db7434;
  --color-warm-600: #c05f26;
  --color-warm-900: #3d2c1e;
```

(Nothing references `warm-*` anymore after Steps 3–6.)

- [ ] **Step 8: Add the i18n keys**

Append inside the `Messages` interface in `app/src/i18n/messages.ts`:

```ts
  nav: {
    home: string;
    calendar: string;
    log: string;
    health: string;
    settings: string;
    addActivity: string;
  };
  shell: {
    petSwitcher: string;
    mainNav: string;
  };
  errors: {
    title: string;
    body: string;
    notFound: string;
  };
  health: {
    soonTitle: string;
    soonBody: string;
  };
  login: {
    authError: string;
  };
```

Append inside `en` in `app/src/i18n/en.ts`:

```ts
  nav: {
    home: "Home",
    calendar: "Calendar",
    log: "Log",
    health: "Health",
    settings: "Settings",
    addActivity: "Add activity",
  },
  shell: {
    petSwitcher: "Switch pet",
    mainNav: "Main navigation",
  },
  errors: {
    title: "Something went wrong",
    body: "We couldn't reach Pawlog. Check your connection and try again.",
    notFound: "We couldn't find that.",
  },
  health: {
    soonTitle: "Health insights are on their way",
    soonBody:
      "Weight trends, intake vs targets, and gentle anomaly alerts arrive in the next update. Keep logging — every entry feeds the charts.",
  },
  login: {
    authError: "Sign-in didn't complete. Please try again.",
  },
```

Append inside `ja` in `app/src/i18n/ja.ts`:

```ts
  nav: {
    home: "ホーム",
    calendar: "カレンダー",
    log: "記録",
    health: "健康",
    settings: "設定",
    addActivity: "記録を追加",
  },
  shell: {
    petSwitcher: "ペットを切り替え",
    mainNav: "メインナビゲーション",
  },
  errors: {
    title: "問題が発生しました",
    body: "Pawlog に接続できませんでした。通信環境を確認して再試行してください。",
    notFound: "見つかりませんでした。",
  },
  health: {
    soonTitle: "健康インサイトはもうすぐ",
    soonBody:
      "体重の推移、食事・水分の目標比較、やさしい異常アラートは次のアップデートで届きます。記録を続けるほどグラフが充実します。",
  },
  login: {
    authError: "サインインが完了しませんでした。もう一度お試しください。",
  },
```

- [ ] **Step 9: Sanctioned worker touch — OAuth error redirect**

In `worker/src/routes/auth.ts`, inside the `/google/callback` handler, replace:

```ts
  if (!code || !state || !raw) {
    return err(c, 400, "oauth_invalid", "Missing OAuth parameters");
  }
```

with:

```ts
  // User-facing OAuth failures (consent denied, expired prompt) arrive as a
  // top-level browser navigation — redirect into the SPA with a marker query
  // instead of stranding the user on raw JSON. State mismatches and malformed
  // cookies below stay hard 400s (suspicious, not user-recoverable).
  const oauthError = c.req.query("error");
  if (oauthError !== undefined || !code) {
    return c.redirect(
      `/?auth_error=${encodeURIComponent(oauthError ?? "missing_code")}`,
    );
  }
  if (!state || !raw) {
    return err(c, 400, "oauth_invalid", "Missing OAuth parameters");
  }
```

Append to `worker/test/oauth.test.ts`:

```ts
it("callback redirects into the spa with auth_error when google reports an error", async () => {
  const res = await SELF.fetch(
    "https://app.local/api/auth/google/callback?error=access_denied&state=whatever",
    { redirect: "manual" },
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe("/?auth_error=access_denied");
});
```

- [ ] **Step 10: Verify (worker touched ⇒ root test)**

Run: `npm run typecheck -w app && npm run build -w app && npm run test`
Expected: all green, including the new oauth redirect test and the untouched state-mismatch 400 test.

- [ ] **Step 11: Manual smoke**

Run: `npm run dev`, open http://localhost:5173 →
- Login shows the warm hero (blobs, paw mark, staggered reveal); dev sign-in lands in the shell.
- With no pets: the interim welcome screen shows (Onboarding arrives in Task 5).
- Visiting http://localhost:5173/?auth_error=access_denied while signed out shows the error banner.
Stop the dev servers.

- [ ] **Step 12: Commit**

```bash
git add app/ worker/
git commit -m "feat: add routed app shell with tab bar, pet switcher, and warm login"
```

---

### Task 5: Onboarding + pet management (create, edit, archive, avatar)

**Files:**
- Create: `app/src/features/pets/PetForm.tsx`
- Create: `app/src/routes/Onboarding.tsx`
- Create: `app/src/routes/settings/PetsSettings.tsx`
- Create: `app/src/routes/settings/PetEditor.tsx`
- Modify: `app/src/routes/Shell.tsx` (zero-pet branch → Onboarding)
- Modify: `app/src/App.tsx` (register the pet-settings routes)
- Modify: `app/src/i18n/messages.ts`, `en.ts`, `ja.ts`

The pet-settings screens are fully functional now and get linked from the Settings hub in Task 14 (until then they're reachable by URL: `/settings/pets`).

- [ ] **Step 1: Create `app/src/features/pets/PetForm.tsx`**

One form used by Onboarding (create) and PetEditor (edit). It is presentational: collects values, parent builds the API payload.

```tsx
import type { Sex, Species } from "@pawlog/shared";
import { useState, type ReactNode } from "react";
import { Button } from "../../components/Button";
import { DateInput, Field, Select, TextInput } from "../../components/form";
import { CatIcon, DogIcon, PawIcon } from "../../components/icons";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";

export type PetFormValues = {
  name: string;
  species: Species;
  breed: string;
  sex: "" | Sex;
  birthday: string; // "" or YYYY-MM-DD
};

function SpeciesButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex flex-1 flex-col items-center gap-1.5 rounded-card border-2 px-2 py-3 font-semibold transition active:scale-95",
        active
          ? "border-clay-400 bg-clay-50 text-clay-800"
          : "border-cream-200 bg-paper text-ink-faint hover:border-cream-300",
      )}
    >
      {children}
      <span className="text-sm">{label}</span>
    </button>
  );
}

export function PetForm({
  initial,
  submitting,
  submitLabel,
  onSubmit,
}: {
  initial?: PetFormValues;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (values: PetFormValues) => void;
}) {
  const t = useT();
  const [values, setValues] = useState<PetFormValues>(
    initial ?? { name: "", species: "dog", breed: "", sex: "", birthday: "" },
  );
  const [nameError, setNameError] = useState<string | null>(null);

  const set = <K extends keyof PetFormValues>(key: K, v: PetFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (values.name.trim() === "") {
          setNameError(t.pets.nameRequired);
          return;
        }
        setNameError(null);
        onSubmit({ ...values, name: values.name.trim() });
      }}
    >
      <div className="flex gap-2" role="group" aria-label={t.pets.species}>
        <SpeciesButton
          active={values.species === "dog"}
          label={t.pets.speciesDog}
          onClick={() => set("species", "dog")}
        >
          <DogIcon className="h-9 w-9" />
        </SpeciesButton>
        <SpeciesButton
          active={values.species === "cat"}
          label={t.pets.speciesCat}
          onClick={() => set("species", "cat")}
        >
          <CatIcon className="h-9 w-9" />
        </SpeciesButton>
        <SpeciesButton
          active={values.species === "other"}
          label={t.pets.speciesOther}
          onClick={() => set("species", "other")}
        >
          <PawIcon className="h-9 w-9" />
        </SpeciesButton>
      </div>

      <Field label={t.pets.name} error={nameError}>
        <TextInput
          value={values.name}
          maxLength={50}
          onChange={(e) => set("name", e.target.value)}
        />
      </Field>
      <Field label={`${t.pets.breed} (${t.common.optional})`}>
        <TextInput
          value={values.breed}
          maxLength={100}
          onChange={(e) => set("breed", e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`${t.pets.sex} (${t.common.optional})`}>
          <Select
            value={values.sex}
            onChange={(e) => set("sex", e.target.value as PetFormValues["sex"])}
          >
            <option value="">—</option>
            <option value="male">{t.pets.sexMale}</option>
            <option value="female">{t.pets.sexFemale}</option>
            <option value="unknown">{t.pets.sexUnknown}</option>
          </Select>
        </Field>
        <Field label={`${t.pets.birthday} (${t.common.optional})`}>
          <DateInput
            value={values.birthday}
            onChange={(e) => set("birthday", e.target.value)}
          />
        </Field>
      </div>

      <Button type="submit" disabled={submitting} className="mt-2">
        {submitLabel}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Create `app/src/routes/Onboarding.tsx`**

The first-run moment: warm hero + the pet form. On success the new pet is selected and `["me"]` refetches, which flips the Shell into the real app.

```tsx
import type { CreatePetInput } from "@pawlog/shared";
import { useCreatePet } from "../api/pets";
import { Card } from "../components/Card";
import { PawIcon } from "../components/icons";
import { PetForm, type PetFormValues } from "../features/pets/PetForm";
import { useT } from "../i18n";
import { usePets } from "../state/pets";

export function Onboarding() {
  const t = useT();
  const { selectPet } = usePets();
  const createPet = useCreatePet();

  const submit = (values: PetFormValues) => {
    const input: CreatePetInput = {
      name: values.name,
      species: values.species,
      ...(values.breed.trim() ? { breed: values.breed.trim() } : {}),
      ...(values.sex ? { sex: values.sex } : {}),
      ...(values.birthday ? { birthday: values.birthday } : {}),
    };
    createPet.mutate(input, { onSuccess: (pet) => selectPet(pet.id) });
  };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-cream-100 px-4 py-10">
      <div
        aria-hidden="true"
        className="blob absolute -right-20 -top-16 h-64 w-64 bg-clay-100"
      />
      <div className="relative mx-auto flex max-w-md flex-col gap-5">
        <div className="animate-pop flex flex-col items-center gap-3 text-center">
          <span className="blob flex h-20 w-20 items-center justify-center bg-clay-500 text-white shadow-float">
            <PawIcon className="h-10 w-10" />
          </span>
          <h1 className="text-3xl text-ink">{t.onboarding.title}</h1>
          <p className="text-ink-soft">{t.onboarding.intro}</p>
        </div>
        <Card className="animate-pop p-5" style={{ animationDelay: "120ms" }}>
          <PetForm
            submitting={createPet.isPending}
            submitLabel={t.onboarding.cta}
            onSubmit={submit}
          />
        </Card>
      </div>
    </main>
  );
}
```

(`Card` spreads `HTMLAttributes`, so `style` passes through.)

- [ ] **Step 3: Swap the Shell zero-pet branch**

In `app/src/routes/Shell.tsx`, add the import:

```ts
import { Onboarding } from "./Onboarding";
```

and replace the interim `if (!selectedPet)` branch body with:

```tsx
  if (!selectedPet) {
    return <Onboarding />;
  }
```

(Remove the now-unused `EmptyState` import from Shell.)

- [ ] **Step 4: Create `app/src/routes/settings/PetsSettings.tsx`**

```tsx
import { Link } from "react-router";
import { PetAvatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { ChevronRightIcon, PlusIcon } from "../../components/icons";
import { useT } from "../../i18n";
import { usePets } from "../../state/pets";
import { SettingsPage } from "./SettingsPage";

export function PetsSettings() {
  const t = useT();
  const { pets } = usePets();

  return (
    <SettingsPage title={t.pets.yourPets} backTo="/settings">
      <Card className="divide-y divide-cream-200 p-0">
        {pets.map((pet) => (
          <Link
            key={pet.id}
            to={`/settings/pets/${pet.id}`}
            className="flex items-center gap-3 px-4 py-3 transition hover:bg-cream-50"
          >
            <PetAvatar pet={pet} size="md" />
            <span className="flex-1 font-semibold text-ink">{pet.name}</span>
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {t.pets.role[pet.role]}
            </span>
            <ChevronRightIcon className="h-4 w-4 text-ink-faint" />
          </Link>
        ))}
      </Card>
      <Link to="/settings/pets/new" className="self-start">
        <Button variant="soft" size="sm">
          <PlusIcon className="h-4 w-4" />
          {t.pets.addPet}
        </Button>
      </Link>
    </SettingsPage>
  );
}
```

Create the tiny shared layout `app/src/routes/settings/SettingsPage.tsx` (used by every settings screen, including Task 14's):

```tsx
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { IconButton } from "../../components/IconButton";
import { ArrowLeftIcon } from "../../components/icons";
import { useT } from "../../i18n";

export function SettingsPage({
  title,
  backTo,
  children,
}: {
  title: string;
  backTo: string;
  children: ReactNode;
}) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div className="animate-pop flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <IconButton label={t.common.back} onClick={() => navigate(backTo)}>
          <ArrowLeftIcon className="h-5 w-5" />
        </IconButton>
        <h1 className="text-2xl text-ink">{title}</h1>
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 5: Create `app/src/routes/settings/PetEditor.tsx`**

Handles both `/settings/pets/new` and `/settings/pets/:petId`: create, edit (null-clears), avatar upload (crop-free direct upload with a client-side 10 MB pre-check), daily targets, archive/unarchive. Editing controls hide for viewers.

```tsx
import type { PetResponse, UpdatePetInput } from "@pawlog/shared";
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { MAX_PHOTO_BYTES } from "../../api/photos";
import {
  useCreatePet,
  usePet,
  useSetPetTargets,
  useUpdatePet,
  useUploadPetAvatar,
} from "../../api/pets";
import { PetAvatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Field, NumberInput } from "../../components/form";
import { Spinner } from "../../components/Spinner";
import { PetForm, type PetFormValues } from "../../features/pets/PetForm";
import { useT } from "../../i18n";
import { SettingsPage } from "./SettingsPage";

function EditExisting({ pet }: { pet: PetResponse }) {
  const t = useT();
  const navigate = useNavigate();
  const updatePet = useUpdatePet(pet.id);
  const setTargets = useSetPetTargets(pet.id);
  const uploadAvatar = useUploadPetAvatar(pet.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [food, setFood] = useState(
    pet.targets?.foodGPerDay != null ? String(pet.targets.foodGPerDay) : "",
  );
  const [water, setWater] = useState(
    pet.targets?.waterMlPerDay != null ? String(pet.targets.waterMlPerDay) : "",
  );
  const [saved, setSaved] = useState(false);
  const canEdit = pet.role !== "viewer";

  const onPickAvatar = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      setAvatarError(t.pets.photoTooLarge);
      return;
    }
    setAvatarError(null);
    uploadAvatar.mutate(file, {
      onError: () => setAvatarError(t.errors.title),
    });
  };

  const submit = async (values: PetFormValues) => {
    const input: UpdatePetInput = {
      name: values.name,
      species: values.species,
      breed: values.breed.trim() === "" ? null : values.breed.trim(),
      sex: values.sex === "" ? null : values.sex,
      birthday: values.birthday === "" ? null : values.birthday,
    };
    await updatePet.mutateAsync(input);
    const foodN = food.trim() === "" ? null : Number(food);
    const waterN = water.trim() === "" ? null : Number(water);
    if (
      (foodN === null || (Number.isFinite(foodN) && foodN > 0)) &&
      (waterN === null || (Number.isFinite(waterN) && waterN > 0))
    ) {
      await setTargets.mutateAsync({
        foodGPerDay: foodN,
        waterMlPerDay: waterN,
      });
    }
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  return (
    <SettingsPage title={pet.name} backTo="/settings/pets">
      <Card className="flex items-center gap-4 p-5">
        <PetAvatar pet={pet} size="xl" />
        <div className="flex flex-col items-start gap-1.5">
          {canEdit && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onPickAvatar(e.target.files?.[0])}
              />
              <Button
                variant="soft"
                size="sm"
                disabled={uploadAvatar.isPending}
                onClick={() => fileRef.current?.click()}
              >
                {uploadAvatar.isPending ? (
                  <Spinner className="h-4 w-4" />
                ) : null}
                {t.pets.changePhoto}
              </Button>
            </>
          )}
          {avatarError && (
            <span role="alert" className="text-xs font-semibold text-berry-600">
              {avatarError}
            </span>
          )}
          {pet.archived && (
            <span className="rounded-full bg-cream-200 px-2.5 py-0.5 text-xs font-semibold text-ink-soft">
              {t.pets.archivedBadge}
            </span>
          )}
        </div>
      </Card>

      {canEdit ? (
        <Card className="p-5">
          <PetForm
            initial={{
              name: pet.name,
              species: pet.species,
              breed: pet.breed ?? "",
              sex: pet.sex ?? "",
              birthday: pet.birthday ?? "",
            }}
            submitting={updatePet.isPending || setTargets.isPending}
            submitLabel={saved ? t.pets.saved : t.common.save}
            onSubmit={(values) => void submit(values)}
          />
          <div className="mt-5 border-t border-cream-200 pt-4">
            <h2 className="mb-1 font-display text-lg text-ink">
              {t.pets.targetsTitle}
            </h2>
            <p className="mb-3 text-sm text-ink-faint">{t.pets.targetsHint}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t.pets.foodTarget}>
                <NumberInput
                  value={food}
                  min={0}
                  onChange={(e) => setFood(e.target.value)}
                />
              </Field>
              <Field label={t.pets.waterTarget}>
                <NumberInput
                  value={water}
                  min={0}
                  onChange={(e) => setWater(e.target.value)}
                />
              </Field>
            </div>
          </div>
        </Card>
      ) : null}

      {canEdit && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-ink-faint"
          disabled={updatePet.isPending}
          onClick={() =>
            updatePet.mutate(
              { archived: !pet.archived },
              { onSuccess: () => navigate("/settings/pets") },
            )
          }
        >
          {pet.archived ? t.pets.unarchive : t.pets.archive}
        </Button>
      )}
    </SettingsPage>
  );
}

export function PetEditor() {
  const t = useT();
  const navigate = useNavigate();
  const { petId } = useParams<{ petId: string }>();
  const isNew = petId === undefined;
  const createPet = useCreatePet();
  // hook stays unconditional; the query is disabled in "new" mode
  const petQuery = usePet(petId ?? "", !isNew);

  if (isNew) {
    return (
      <SettingsPage title={t.pets.addPet} backTo="/settings/pets">
        <Card className="p-5">
          <PetForm
            submitting={createPet.isPending}
            submitLabel={t.common.add}
            onSubmit={(values) =>
              createPet.mutate(
                {
                  name: values.name,
                  species: values.species,
                  ...(values.breed.trim() ? { breed: values.breed.trim() } : {}),
                  ...(values.sex ? { sex: values.sex } : {}),
                  ...(values.birthday ? { birthday: values.birthday } : {}),
                },
                { onSuccess: () => navigate("/settings/pets") },
              )
            }
          />
        </Card>
      </SettingsPage>
    );
  }

  if (petQuery.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (!petQuery.data) {
    return (
      <SettingsPage title={t.errors.notFound} backTo="/settings/pets">
        <p className="text-ink-faint">{t.errors.notFound}</p>
      </SettingsPage>
    );
  }
  return <EditExisting pet={petQuery.data} />;
}
```

- [ ] **Step 6: Register the routes in `app/src/App.tsx`**

Add the imports:

```ts
import { PetEditor } from "./routes/settings/PetEditor";
import { PetsSettings } from "./routes/settings/PetsSettings";
```

and add inside the `<Route element={<Shell />}>` block (before the wildcard):

```tsx
                <Route path="/settings/pets" element={<PetsSettings />} />
                <Route path="/settings/pets/new" element={<PetEditor />} />
                <Route path="/settings/pets/:petId" element={<PetEditor />} />
```

- [ ] **Step 7: Add the i18n keys**

Append inside the `Messages` interface in `app/src/i18n/messages.ts` (and add `import type { Role } from "@pawlog/shared";` — extend the existing type-import line):

```ts
  onboarding: {
    title: string;
    intro: string;
    cta: string;
  };
  pets: {
    yourPets: string;
    addPet: string;
    name: string;
    nameRequired: string;
    species: string;
    speciesDog: string;
    speciesCat: string;
    speciesOther: string;
    breed: string;
    sex: string;
    sexMale: string;
    sexFemale: string;
    sexUnknown: string;
    birthday: string;
    changePhoto: string;
    photoTooLarge: string;
    archive: string;
    unarchive: string;
    archivedBadge: string;
    targetsTitle: string;
    targetsHint: string;
    foodTarget: string;
    waterTarget: string;
    saved: string;
    role: Record<Role, string>;
  };
```

Append inside `en`:

```ts
  onboarding: {
    title: "Who's the lucky pet?",
    intro:
      "Tell us about your companion — you can add photos, housemates, and more pets later.",
    cta: "Start the journal",
  },
  pets: {
    yourPets: "Your pets",
    addPet: "Add a pet",
    name: "Name",
    nameRequired: "Every pet needs a name",
    species: "Species",
    speciesDog: "Dog",
    speciesCat: "Cat",
    speciesOther: "Other",
    breed: "Breed",
    sex: "Sex",
    sexMale: "Male",
    sexFemale: "Female",
    sexUnknown: "Unknown",
    birthday: "Birthday",
    changePhoto: "Change photo",
    photoTooLarge: "That photo is over 10 MB — please pick a smaller one.",
    archive: "Archive this pet",
    unarchive: "Restore this pet",
    archivedBadge: "Archived",
    targetsTitle: "Daily targets",
    targetsHint: "Used by the Health tab to compare intake. Leave blank to skip.",
    foodTarget: "Food (g / day)",
    waterTarget: "Water (ml / day)",
    saved: "Saved!",
    role: { owner: "Owner", editor: "Editor", viewer: "Viewer" },
  },
```

Append inside `ja`:

```ts
  onboarding: {
    title: "どんな子と暮らしていますか？",
    intro:
      "あなたのパートナーについて教えてください。写真や家族、ほかのペットは後から追加できます。",
    cta: "日記をはじめる",
  },
  pets: {
    yourPets: "ペット一覧",
    addPet: "ペットを追加",
    name: "名前",
    nameRequired: "名前を入力してください",
    species: "種類",
    speciesDog: "犬",
    speciesCat: "猫",
    speciesOther: "その他",
    breed: "品種",
    sex: "性別",
    sexMale: "オス",
    sexFemale: "メス",
    sexUnknown: "不明",
    birthday: "誕生日",
    changePhoto: "写真を変更",
    photoTooLarge: "写真が10MBを超えています。小さいものを選んでください。",
    archive: "このペットをアーカイブ",
    unarchive: "このペットを元に戻す",
    archivedBadge: "アーカイブ済み",
    targetsTitle: "1日の目標",
    targetsHint: "健康タブで摂取量と比較されます。未設定でも構いません。",
    foodTarget: "ごはん（g / 日）",
    waterTarget: "お水（ml / 日）",
    saved: "保存しました！",
    role: { owner: "オーナー", editor: "編集者", viewer: "閲覧者" },
  },
```

- [ ] **Step 8: Verify**

Run: `npm run typecheck -w app && npm run build -w app`
Expected: clean. Manual smoke (`npm run dev`): a fresh dev-login account lands on Onboarding; creating a pet flips into the shell with the pet chip selected; `/settings/pets` lists pets; editing name/targets/avatar and archive round-trip.

- [ ] **Step 9: Commit**

```bash
git add app/
git commit -m "feat: add onboarding and pet management screens"
```

---

### Task 6: Sheet + Toast primitives (drag-dismiss, focus trap, undo)

**Files:**
- Create: `app/src/components/Sheet.tsx`
- Create: `app/src/components/Toast.tsx`
- Modify: `app/src/main.tsx` (mount ToastProvider)

These are the two intricate primitives everything after this leans on: the bottom sheet (mobile drag-dismiss, desktop modal) and the toast stack (undo actions).

- [ ] **Step 1: Create `app/src/components/Sheet.tsx`**

```tsx
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { cn } from "../lib/cn";
import { IconButton } from "./IconButton";
import { XIcon } from "./icons";

const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet on mobile (drag the handle down ≥120px to dismiss),
 * centered modal on md+. Traps focus, closes on Escape/backdrop,
 * locks body scroll, restores focus on close.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const dragStart = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    setDragY(0);
    return () => {
      document.body.style.overflow = "";
      restoreRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
      <div
        aria-hidden="true"
        className="animate-fade absolute inset-0 bg-ink/40"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={
          dragY > 0
            ? { transform: `translateY(${dragY}px)`, animation: "none" }
            : undefined
        }
        className={cn(
          "animate-sheet rounded-t-bubble shadow-float relative flex max-h-[92dvh] w-full flex-col bg-paper outline-none",
          "md:rounded-bubble md:max-h-[85dvh]",
          wide ? "md:max-w-2xl" : "md:max-w-md",
        )}
      >
        {/* drag handle (touch-dismiss, mobile only) */}
        <div
          className="flex justify-center pb-1 pt-2 md:hidden"
          style={{ touchAction: "none" }}
          onPointerDown={(e) => {
            dragStart.current = e.clientY;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (dragStart.current === null) return;
            setDragY(Math.max(0, e.clientY - dragStart.current));
          }}
          onPointerUp={() => {
            const shouldClose = dragY > 120;
            dragStart.current = null;
            setDragY(0);
            if (shouldClose) onClose();
          }}
          onPointerCancel={() => {
            dragStart.current = null;
            setDragY(0);
          }}
        >
          <div className="h-1.5 w-10 rounded-full bg-cream-300" />
        </div>
        <header className="flex items-center justify-between px-5 pb-2 pt-1 md:pt-4">
          <h2 className="font-display text-xl text-ink">{title}</h2>
          <IconButton label={t.common.close} onClick={onClose}>
            <XIcon className="h-5 w-5" />
          </IconButton>
        </header>
        <div className="overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Create `app/src/components/Toast.tsx`**

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../lib/cn";

type ToastTone = "default" | "danger";
type ToastAction = { label: string; onClick: () => void };
type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
};
type ShowToast = (
  message: string,
  opts?: { tone?: ToastTone; action?: ToastAction },
) => void;

const ToastContext = createContext<{ show: ShowToast } | null>(null);

export function useToast(): { show: ShowToast } {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const show = useCallback<ShowToast>(
    (message, opts) => {
      const id = ++idRef.current;
      setToasts((prev) => [
        ...prev.slice(-2),
        { id, message, tone: opts?.tone ?? "default", action: opts?.action },
      ]);
      window.setTimeout(() => dismiss(id), opts?.action ? 6000 : 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            role="status"
            className={cn(
              "animate-pop shadow-float pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-full py-2.5 pl-5 pr-2.5 text-sm font-semibold",
              item.tone === "danger"
                ? "bg-berry-700 text-white"
                : "bg-ink text-cream-50",
            )}
          >
            <span className="flex-1">{item.message}</span>
            {item.action && (
              <button
                type="button"
                className="rounded-full bg-white/15 px-3.5 py-1.5 font-display transition hover:bg-white/25 active:scale-95"
                onClick={() => {
                  item.action!.onClick();
                  dismiss(item.id);
                }}
              >
                {item.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
```

- [ ] **Step 3: Mount the provider in `app/src/main.tsx`**

Replace the render block:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./components/Toast";
import "./index.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
```

(ToastProvider sits outside `App` so toasts survive route changes; its strings come from callers, so it needs no i18n context.)

- [ ] **Step 4: Verify**

Run: `npm run typecheck -w app && npm run build -w app`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/
git commit -m "feat: add sheet and toast primitives with drag dismiss and undo"
```

---

### Task 7: Add flow — category grid, config-driven forms, photo attach, edit mode

**Files:**
- Create: `app/src/features/add/categoryFields.ts`
- Create: `app/src/features/add/DetailsFields.tsx`
- Create: `app/src/features/add/CategoryGrid.tsx`
- Create: `app/src/features/add/ActivityForm.tsx`
- Create: `app/src/features/add/AddSheet.tsx`
- Modify: `app/src/routes/Shell.tsx` (mount AddSheet on the FAB)
- Modify: `app/src/i18n/messages.ts`, `en.ts`, `ja.ts`

One config map drives all 11 category forms. `buildDetails` constructs the payload and validates it with the **same** Zod schemas the server uses — the form cannot drift from the API contract.

- [ ] **Step 1: Create `app/src/features/add/categoryFields.ts`**

```ts
import {
  activityDetailsSchemas,
  type Category,
} from "@pawlog/shared";
import type { Messages } from "../../i18n/messages";

export type OptionGroup = keyof Messages["options"];
export type FieldName = keyof Messages["fields"];

export type FieldSpec = {
  /** key inside the category's details payload */
  key: string;
  label: FieldName;
  control: "select" | "number" | "text" | "date";
  /** for selects: allowed values + the option-label group in the catalog */
  options?: readonly string[];
  optionGroup?: OptionGroup;
  required?: boolean;
  /** for selects with required values: pre-selected value */
  defaultValue?: string;
  maxLength?: number;
};

/**
 * Field specs per category. Order matters: the first 2–3 fields are the
 * above-the-fold essentials (spec §3). Keys/values mirror
 * `activityDetailsSchemas` in shared/ exactly — buildDetails() proves it.
 */
export const CATEGORY_FIELDS: Record<Category, FieldSpec[]> = {
  food: [
    { key: "foodType", label: "foodType", control: "select", options: ["dry", "wet", "treat", "supplement"], optionGroup: "foodType", required: true, defaultValue: "dry" },
    { key: "amount", label: "amount", control: "number" },
    { key: "unit", label: "unit", control: "select", options: ["g", "ml", "pieces"], optionGroup: "unit", required: true, defaultValue: "g" },
    { key: "name", label: "name", control: "text", maxLength: 100 },
    { key: "leftoverPct", label: "leftoverPct", control: "number" },
  ],
  water: [{ key: "amountMl", label: "amountMl", control: "number", required: true }],
  toilet: [
    { key: "kind", label: "kind", control: "select", options: ["pee", "poop"], optionGroup: "toiletKind", required: true, defaultValue: "pee" },
    { key: "condition", label: "condition", control: "select", options: ["normal", "soft", "diarrhea", "hard", "bloody"], optionGroup: "condition", required: true, defaultValue: "normal" },
    { key: "colorNote", label: "colorNote", control: "text", maxLength: 200 },
  ],
  weight: [{ key: "kg", label: "kg", control: "number", required: true }],
  exercise: [
    { key: "kind", label: "kind", control: "select", options: ["walk", "play", "other"], optionGroup: "exerciseKind", required: true, defaultValue: "walk" },
    { key: "durationMin", label: "durationMin", control: "number" },
    { key: "distanceKm", label: "distanceKm", control: "number" },
  ],
  symptom: [
    { key: "name", label: "name", control: "text", required: true, maxLength: 100 },
    { key: "severity", label: "severity", control: "select", options: ["mild", "moderate", "severe"], optionGroup: "severity", required: true, defaultValue: "mild" },
  ],
  medication: [
    { key: "name", label: "name", control: "text", required: true, maxLength: 100 },
    { key: "dose", label: "dose", control: "number" },
    { key: "doseUnit", label: "doseUnit", control: "text", maxLength: 20 },
  ],
  vet_visit: [
    { key: "clinic", label: "clinic", control: "text", maxLength: 200 },
    { key: "reason", label: "reason", control: "text", maxLength: 500 },
    { key: "diagnosis", label: "diagnosis", control: "text", maxLength: 500 },
    { key: "nextVisitDate", label: "nextVisitDate", control: "date" },
  ],
  grooming: [
    { key: "kind", label: "kind", control: "select", options: ["bath", "brush", "nails", "trim", "other"], optionGroup: "groomingKind", required: true, defaultValue: "bath" },
  ],
  vaccination: [
    { key: "vaccineName", label: "vaccineName", control: "text", required: true, maxLength: 100 },
    { key: "nextDueDate", label: "nextDueDate", control: "date" },
  ],
  note: [],
};

export type FormValues = Record<string, string>;

/**
 * Builds the details payload from form strings, then validates it with the
 * SAME shared Zod schema the server uses. Returns either `{ details }` or a
 * localized `{ error }`.
 */
export function buildDetails(
  category: Category,
  values: FormValues,
  t: Messages,
): { details: unknown } | { error: string } {
  for (const spec of CATEGORY_FIELDS[category]) {
    if (spec.required && (values[spec.key] ?? "").trim() === "") {
      return { error: t.add.requiredField(t.fields[spec.label]) };
    }
  }
  const raw: Record<string, unknown> = {};
  for (const spec of CATEGORY_FIELDS[category]) {
    const v = (values[spec.key] ?? "").trim();
    if (v === "") continue;
    raw[spec.key] = spec.control === "number" ? Number(v) : v;
  }
  const parsed = activityDetailsSchemas[category].safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const key = issue?.path[0];
    const spec = CATEGORY_FIELDS[category].find((s) => s.key === key);
    return {
      error: spec
        ? `${t.fields[spec.label]}: ${issue?.message ?? ""}`
        : (issue?.message ?? t.add.detailsInvalid),
    };
  }
  return { details: parsed.data };
}

/** Initial form strings for create (defaults), edit, or preset prefill. */
export function initialValues(
  category: Category,
  details?: unknown,
): FormValues {
  const parsed =
    details === undefined
      ? null
      : activityDetailsSchemas[category].safeParse(details);
  const src: Record<string, unknown> =
    parsed?.success ? (parsed.data as Record<string, unknown>) : {};
  const out: FormValues = {};
  for (const spec of CATEGORY_FIELDS[category]) {
    const v = src[spec.key];
    out[spec.key] =
      v === undefined || v === null ? (spec.defaultValue ?? "") : String(v);
  }
  return out;
}
```

- [ ] **Step 2: Create `app/src/features/add/DetailsFields.tsx`**

```tsx
import type { Category } from "@pawlog/shared";
import {
  DateInput,
  Field,
  NumberInput,
  Select,
  TextInput,
} from "../../components/form";
import { useT } from "../../i18n";
import {
  CATEGORY_FIELDS,
  type FieldSpec,
  type FormValues,
} from "./categoryFields";

function OneField({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useT();
  const label = spec.required
    ? t.fields[spec.label]
    : `${t.fields[spec.label]} (${t.common.optional})`;

  if (spec.control === "select") {
    const labels = t.options[spec.optionGroup!];
    return (
      <Field label={label}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          {!spec.required && <option value="">—</option>}
          {spec.options!.map((opt) => (
            <option key={opt} value={opt}>
              {(labels as Record<string, string>)[opt]}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  if (spec.control === "number") {
    return (
      <Field label={label}>
        <NumberInput value={value} onChange={(e) => onChange(e.target.value)} />
      </Field>
    );
  }
  if (spec.control === "date") {
    return (
      <Field label={label}>
        <DateInput value={value} onChange={(e) => onChange(e.target.value)} />
      </Field>
    );
  }
  return (
    <Field label={label}>
      <TextInput
        value={value}
        maxLength={spec.maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function DetailsFields({
  category,
  values,
  onChange,
}: {
  category: Category;
  values: FormValues;
  onChange: (values: FormValues) => void;
}) {
  const specs = CATEGORY_FIELDS[category];
  if (specs.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3">
      {specs.map((spec) => (
        <div
          key={spec.key}
          className={spec.control === "text" ? "col-span-2" : ""}
        >
          <OneField
            spec={spec}
            value={values[spec.key] ?? ""}
            onChange={(v) => onChange({ ...values, [spec.key]: v })}
          />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `app/src/features/add/CategoryGrid.tsx`**

The 11-category picker (reused by the preset editor in Task 14).

```tsx
import { CATEGORIES, type Category } from "@pawlog/shared";
import { CategoryIcon, categoryTone } from "../../components/CategoryIcon";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";

export function CategoryGrid({
  onPick,
  selected,
}: {
  onPick: (category: Category) => void;
  selected?: Category;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
      {CATEGORIES.map((category, i) => {
        const tone = categoryTone[category];
        const active = selected === category;
        return (
          <button
            key={category}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(category)}
            className={cn(
              "animate-pop flex flex-col items-center gap-1.5 rounded-card border-2 px-1 py-3 transition active:scale-95",
              active
                ? cn("border-current", tone.soft, tone.text)
                : "border-transparent bg-cream-50 hover:bg-cream-100",
            )}
            style={{ animationDelay: `${i * 25}ms` }}
          >
            <span
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-full",
                tone.soft,
                tone.text,
              )}
            >
              <CategoryIcon category={category} className="h-6 w-6" />
            </span>
            <span className="text-xs font-semibold text-ink">
              {t.categories[category]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Create `app/src/features/add/ActivityForm.tsx`**

Create AND edit in one component: time (defaults to now), the category's config-driven fields, memo, photos. On create: POST the activity, then upload photos sequentially with progress; on edit: PATCH, manage existing photos, upload new ones.

```tsx
import type { ActivityResponse, Category } from "@pawlog/shared";
import { useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateActivity,
  useUpdateActivity,
} from "../../api/activities";
import { ApiError } from "../../api/client";
import { keys } from "../../api/keys";
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_ACTIVITY,
  photoUrl,
  uploadActivityPhoto,
  useDeletePhoto,
} from "../../api/photos";
import { Button } from "../../components/Button";
import { DateTimeInput, Field, Textarea } from "../../components/form";
import { IconButton } from "../../components/IconButton";
import { CameraIcon, XIcon } from "../../components/icons";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";
import { deviceTzOffsetMin } from "../../lib/dates";
import { buildDetails, initialValues, type FormValues } from "./categoryFields";
import { DetailsFields } from "./DetailsFields";

export function ActivityForm({
  petId,
  category,
  existing,
  presetDetails,
  onSaved,
}: {
  petId: string;
  category: Category;
  /** edit mode: pre-fills everything and switches to PATCH */
  existing?: ActivityResponse;
  /** quick-add prefill for create mode */
  presetDetails?: unknown;
  onSaved: (activity: ActivityResponse) => void;
}) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const create = useCreateActivity(petId);
  const update = useUpdateActivity(petId, existing?.id ?? "");
  const deletePhoto = useDeletePhoto(petId);

  const [occurredAtMs, setOccurredAtMs] = useState(
    existing?.occurredAt ?? Date.now(),
  );
  const [values, setValues] = useState<FormValues>(() =>
    initialValues(category, existing?.details ?? presetDetails),
  );
  const [memo, setMemo] = useState(existing?.memo ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const existingPhotos = existing?.photos ?? [];
  const photoCount = existingPhotos.length + files.length;
  const busy = create.isPending || update.isPending || progress !== null;

  const addFiles = (picked: FileList | null) => {
    if (!picked) return;
    const next = [...files];
    for (const file of Array.from(picked)) {
      if (existingPhotos.length + next.length >= MAX_PHOTOS_PER_ACTIVITY) {
        toast.show(t.add.photoLimit, { tone: "danger" });
        break;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        toast.show(t.add.photoTooLarge(file.name), { tone: "danger" });
        continue;
      }
      next.push(file);
    }
    setFiles(next);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const built = buildDetails(category, values, t);
    if ("error" in built) {
      setDetailsError(built.error);
      return;
    }
    setDetailsError(null);
    try {
      const trimmedMemo = memo.trim();
      let saved: ActivityResponse;
      if (existing) {
        saved = await update.mutateAsync({
          occurredAt: occurredAtMs,
          tzOffsetMin: deviceTzOffsetMin(),
          memo: trimmedMemo === "" ? null : trimmedMemo,
          details: built.details,
        });
      } else {
        saved = await create.mutateAsync({
          category,
          occurredAt: occurredAtMs,
          tzOffsetMin: deviceTzOffsetMin(),
          ...(trimmedMemo !== "" ? { memo: trimmedMemo } : {}),
          details: built.details,
        });
      }
      if (files.length > 0) {
        setProgress({ done: 0, total: files.length });
        for (let i = 0; i < files.length; i++) {
          await uploadActivityPhoto(petId, saved.id, files[i]!);
          setProgress({ done: i + 1, total: files.length });
        }
        await qc.invalidateQueries({ queryKey: keys.activitiesRoot(petId) });
      }
      onSaved(saved);
    } catch (error) {
      toast.show(
        error instanceof ApiError ? error.message : t.errors.title,
        { tone: "danger" },
      );
    } finally {
      setProgress(null);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
      <Field label={t.add.time}>
        <DateTimeInput valueMs={occurredAtMs} onChangeMs={setOccurredAtMs} />
      </Field>

      <DetailsFields category={category} values={values} onChange={setValues} />
      {detailsError && (
        <p role="alert" className="text-sm font-semibold text-berry-600">
          {detailsError}
        </p>
      )}

      <Field label={`${t.add.memo} (${t.common.optional})`}>
        <Textarea
          value={memo}
          maxLength={2000}
          onChange={(e) => setMemo(e.target.value)}
        />
      </Field>

      <div>
        <span className="mb-1.5 block text-sm font-semibold text-ink-soft">
          {t.add.photos}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {existingPhotos.map((photo) => (
            <span key={photo.id} className="relative">
              <img
                src={photoUrl(photo.id, "thumb")}
                alt=""
                className="h-16 w-16 rounded-2xl object-cover"
              />
              <IconButton
                label={t.common.delete}
                className="absolute -right-2 -top-2 h-7 w-7 bg-paper shadow-card"
                disabled={deletePhoto.isPending}
                onClick={() => deletePhoto.mutate(photo.id)}
              >
                <XIcon className="h-3.5 w-3.5" />
              </IconButton>
            </span>
          ))}
          {files.map((file, i) => (
            <span key={`${file.name}-${i}`} className="relative">
              <img
                src={URL.createObjectURL(file)}
                alt=""
                className="h-16 w-16 rounded-2xl object-cover"
              />
              <IconButton
                label={t.common.delete}
                className="absolute -right-2 -top-2 h-7 w-7 bg-paper shadow-card"
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
              >
                <XIcon className="h-3.5 w-3.5" />
              </IconButton>
            </span>
          ))}
          {photoCount < MAX_PHOTOS_PER_ACTIVITY && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => addFiles(e.target.files)}
              />
              <button
                type="button"
                aria-label={t.add.addPhotos}
                onClick={() => fileRef.current?.click()}
                className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-cream-300 text-ink-faint transition hover:border-clay-300 hover:text-clay-500"
              >
                <CameraIcon className="h-6 w-6" />
              </button>
            </>
          )}
        </div>
      </div>

      <Button type="submit" disabled={busy} className="mt-1">
        {progress ? (
          <>
            <Spinner className="h-4 w-4 text-white" />
            {t.add.uploadingPhoto(progress.done + 1, progress.total)}
          </>
        ) : busy ? (
          <Spinner className="h-4 w-4 text-white" />
        ) : (
          t.common.save
        )}
      </Button>
    </form>
  );
}
```

- [ ] **Step 5: Create `app/src/features/add/AddSheet.tsx`**

Two-step sheet: category grid → form. The back arrow returns to the grid.

```tsx
import type { Category } from "@pawlog/shared";
import { useEffect, useState } from "react";
import { IconButton } from "../../components/IconButton";
import { ArrowLeftIcon } from "../../components/icons";
import { Sheet } from "../../components/Sheet";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";
import { useRequiredPet } from "../../state/pets";
import { ActivityForm } from "./ActivityForm";
import { CategoryGrid } from "./CategoryGrid";

export function AddSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const pet = useRequiredPet();
  const [category, setCategory] = useState<Category | null>(null);

  useEffect(() => {
    if (!open) setCategory(null);
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={category ? t.categories[category] : t.add.pickCategory}
      wide={category === null}
    >
      {category === null ? (
        <CategoryGrid onPick={setCategory} />
      ) : (
        <div className="flex flex-col gap-3">
          <IconButton
            label={t.common.back}
            className="-mt-1 self-start"
            onClick={() => setCategory(null)}
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </IconButton>
          <ActivityForm
            petId={pet.id}
            category={category}
            onSaved={() => {
              toast.show(t.add.saved);
              onClose();
            }}
          />
        </div>
      )}
    </Sheet>
  );
}
```

- [ ] **Step 6: Mount the AddSheet in `app/src/routes/Shell.tsx`**

Add the import:

```ts
import { AddSheet } from "../features/add/AddSheet";
```

Delete the placeholder line `void addOpen;` (keep `void quickOpen;` — Task 8 consumes it), and add this immediately before the closing `</div>` of the root element (after the mobile `<nav>` block):

```tsx
      <AddSheet open={addOpen} onClose={() => setAddOpen(false)} />
```

- [ ] **Step 7: Add the i18n keys**

Append inside the `Messages` interface in `app/src/i18n/messages.ts`:

```ts
  add: {
    pickCategory: string;
    time: string;
    memo: string;
    photos: string;
    addPhotos: string;
    photoTooLarge: (name: string) => string;
    photoLimit: string;
    uploadingPhoto: (current: number, total: number) => string;
    saved: string;
    requiredField: (field: string) => string;
    detailsInvalid: string;
  };
  fields: {
    name: string;
    foodType: string;
    amount: string;
    unit: string;
    leftoverPct: string;
    amountMl: string;
    kind: string;
    condition: string;
    colorNote: string;
    kg: string;
    durationMin: string;
    distanceKm: string;
    severity: string;
    dose: string;
    doseUnit: string;
    clinic: string;
    reason: string;
    diagnosis: string;
    nextVisitDate: string;
    vaccineName: string;
    nextDueDate: string;
  };
  options: {
    foodType: Record<"dry" | "wet" | "treat" | "supplement", string>;
    unit: Record<"g" | "ml" | "pieces", string>;
    toiletKind: Record<"pee" | "poop", string>;
    condition: Record<"normal" | "soft" | "diarrhea" | "hard" | "bloody", string>;
    exerciseKind: Record<"walk" | "play" | "other", string>;
    severity: Record<"mild" | "moderate" | "severe", string>;
    groomingKind: Record<"bath" | "brush" | "nails" | "trim" | "other", string>;
  };
```

Append inside `en`:

```ts
  add: {
    pickCategory: "What happened?",
    time: "When",
    memo: "Memo",
    photos: "Photos",
    addPhotos: "Add photos",
    photoTooLarge: (name) => `"${name}" is over 10 MB — please pick a smaller photo.`,
    photoLimit: "An activity can have up to 6 photos.",
    uploadingPhoto: (current, total) => `Uploading photo ${current} of ${total}…`,
    saved: "Logged!",
    requiredField: (field) => `${field} is required`,
    detailsInvalid: "Please check the highlighted fields.",
  },
  fields: {
    name: "Name",
    foodType: "Food type",
    amount: "Amount",
    unit: "Unit",
    leftoverPct: "Leftover %",
    amountMl: "Amount (ml)",
    kind: "Type",
    condition: "Condition",
    colorNote: "Color note",
    kg: "Weight (kg)",
    durationMin: "Duration (min)",
    distanceKm: "Distance (km)",
    severity: "Severity",
    dose: "Dose",
    doseUnit: "Dose unit",
    clinic: "Clinic",
    reason: "Reason",
    diagnosis: "Diagnosis",
    nextVisitDate: "Next visit",
    vaccineName: "Vaccine",
    nextDueDate: "Next due",
  },
  options: {
    foodType: { dry: "Dry", wet: "Wet", treat: "Treat", supplement: "Supplement" },
    unit: { g: "g", ml: "ml", pieces: "pcs" },
    toiletKind: { pee: "Pee", poop: "Poop" },
    condition: {
      normal: "Normal",
      soft: "Soft",
      diarrhea: "Diarrhea",
      hard: "Hard",
      bloody: "Bloody",
    },
    exerciseKind: { walk: "Walk", play: "Play", other: "Other" },
    severity: { mild: "Mild", moderate: "Moderate", severe: "Severe" },
    groomingKind: {
      bath: "Bath",
      brush: "Brushing",
      nails: "Nail trim",
      trim: "Haircut",
      other: "Other",
    },
  },
```

Append inside `ja`:

```ts
  add: {
    pickCategory: "なにがあった？",
    time: "日時",
    memo: "メモ",
    photos: "写真",
    addPhotos: "写真を追加",
    photoTooLarge: (name) => `「${name}」は10MBを超えています。小さい写真を選んでください。`,
    photoLimit: "写真は1つの記録につき6枚までです。",
    uploadingPhoto: (current, total) => `写真をアップロード中 ${current}/${total}…`,
    saved: "記録しました！",
    requiredField: (field) => `${field}を入力してください`,
    detailsInvalid: "入力内容を確認してください。",
  },
  fields: {
    name: "名前",
    foodType: "フードの種類",
    amount: "量",
    unit: "単位",
    leftoverPct: "食べ残し %",
    amountMl: "量（ml）",
    kind: "種類",
    condition: "状態",
    colorNote: "色メモ",
    kg: "体重（kg）",
    durationMin: "時間（分）",
    distanceKm: "距離（km）",
    severity: "程度",
    dose: "用量",
    doseUnit: "用量の単位",
    clinic: "病院",
    reason: "受診理由",
    diagnosis: "診断",
    nextVisitDate: "次回の通院",
    vaccineName: "ワクチン名",
    nextDueDate: "次回予定",
  },
  options: {
    foodType: { dry: "ドライ", wet: "ウェット", treat: "おやつ", supplement: "サプリ" },
    unit: { g: "g", ml: "ml", pieces: "個" },
    toiletKind: { pee: "おしっこ", poop: "うんち" },
    condition: {
      normal: "正常",
      soft: "やわらかい",
      diarrhea: "下痢",
      hard: "かたい",
      bloody: "血が混じる",
    },
    exerciseKind: { walk: "散歩", play: "遊び", other: "その他" },
    severity: { mild: "軽い", moderate: "中くらい", severe: "重い" },
    groomingKind: {
      bath: "シャンプー",
      brush: "ブラッシング",
      nails: "爪切り",
      trim: "トリミング",
      other: "その他",
    },
  },
```

- [ ] **Step 8: Verify**

Run: `npm run typecheck -w app && npm run build -w app`
Expected: clean. Manual smoke (`npm run dev`): FAB → grid → Food form (type/amount/unit above the fold, time pre-filled with now) → save with 2 photos shows "Uploading photo 1 of 2…" then the toast; a Water entry without amount shows the localized required-field error.

- [ ] **Step 9: Commit**

```bash
git add app/
git commit -m "feat: add config-driven activity add and edit flow with photo upload"
```

---

### Task 8: Quick Add — preset grid, undo toast, FAB long-press

**Files:**
- Create: `app/src/features/quickadd/QuickAddGrid.tsx`
- Modify: `app/src/routes/Shell.tsx` (Quick Add sheet + FAB long-press)
- Modify: `app/src/i18n/messages.ts`, `en.ts`, `ja.ts`

One tap on a preset = activity logged at `now` with the preset's stored details; the toast offers Undo (deletes the created activity — soft delete server-side).

- [ ] **Step 1: Create `app/src/features/quickadd/QuickAddGrid.tsx`**

```tsx
import type { PresetResponse } from "@pawlog/shared";
import { Link } from "react-router";
import { useCreateActivity, useDeleteActivity } from "../../api/activities";
import { usePresets } from "../../api/presets";
import { CategoryIcon, categoryTone } from "../../components/CategoryIcon";
import { EmptyState } from "../../components/EmptyState";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { deviceTzOffsetMin } from "../../lib/dates";

export function QuickAddGrid({
  petId,
  onLogged,
}: {
  petId: string;
  /** e.g. close the surrounding sheet */
  onLogged?: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const presets = usePresets(petId);
  const create = useCreateActivity(petId);
  const remove = useDeleteActivity(petId);

  if (presets.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  const items = presets.data ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        title={t.quickAdd.emptyTitle}
        hint={t.quickAdd.emptyHint}
        action={
          <Link
            to="/settings/presets"
            className="font-semibold text-clay-600 underline underline-offset-4"
          >
            {t.quickAdd.manage}
          </Link>
        }
      />
    );
  }

  const tap = (preset: PresetResponse) => {
    create.mutate(
      {
        category: preset.category,
        occurredAt: Date.now(),
        tzOffsetMin: deviceTzOffsetMin(),
        details: preset.details ?? {},
      },
      {
        onSuccess: (activity) => {
          onLogged?.();
          toast.show(t.quickAdd.logged(preset.label), {
            action: {
              label: t.quickAdd.undo,
              onClick: () =>
                remove.mutate(activity.id, {
                  onSuccess: () => toast.show(t.quickAdd.undone),
                }),
            },
          });
        },
        onError: () => toast.show(t.errors.title, { tone: "danger" }),
      },
    );
  };

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {items.map((preset) => {
        const tone = categoryTone[preset.category];
        return (
          <button
            key={preset.id}
            type="button"
            disabled={create.isPending}
            onClick={() => tap(preset)}
            className={cn(
              "flex items-center gap-2.5 rounded-card border border-cream-200 bg-paper px-3 py-2.5 text-left shadow-card transition",
              "hover:border-cream-300 active:scale-[0.97] disabled:opacity-60",
            )}
          >
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                tone.soft,
                tone.text,
              )}
            >
              <CategoryIcon category={preset.category} className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">
                {preset.label}
              </span>
              <span className="block text-xs text-ink-faint">
                {t.categories[preset.category]}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Wire the Quick Add sheet + FAB long-press into `app/src/routes/Shell.tsx`**

Add the imports:

```ts
import { useRef, useState, type ReactNode } from "react";
import { Sheet } from "../components/Sheet";
import { QuickAddGrid } from "../features/quickadd/QuickAddGrid";
```

(this replaces the existing react import line). Delete the remaining `void quickOpen;` placeholder line. Inside `Shell()` add the long-press refs next to the existing state:

```ts
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const clearPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
```

Replace the mobile FAB `<button …>` opening tag's handlers with (the visual classes stay identical):

```tsx
            <button
              type="button"
              aria-label={t.nav.addActivity}
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={() => {
                longPressed.current = false;
                pressTimer.current = window.setTimeout(() => {
                  longPressed.current = true;
                  setQuickOpen(true);
                }, 500);
              }}
              onPointerUp={clearPress}
              onPointerLeave={clearPress}
              onPointerCancel={clearPress}
              onClick={() => {
                if (!longPressed.current) setAddOpen(true);
              }}
              className="shadow-fab -mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-clay-500 text-white transition active:scale-95"
            >
```

(Tap still opens the Add sheet — the long-press is a pure enhancement and the app is fully usable without it.) Then add, next to the `<AddSheet …/>` mount:

```tsx
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
```

- [ ] **Step 3: Add the i18n keys**

Append inside the `Messages` interface:

```ts
  quickAdd: {
    title: string;
    logged: (label: string) => string;
    undo: string;
    undone: string;
    emptyTitle: string;
    emptyHint: string;
    manage: string;
  };
```

Append inside `en`:

```ts
  quickAdd: {
    title: "Quick add",
    logged: (label) => `Logged "${label}"`,
    undo: "Undo",
    undone: "Removed again",
    emptyTitle: "No shortcuts yet",
    emptyHint:
      "Quick Add turns a routine into one tap — morning kibble, the evening walk…",
    manage: "Set up shortcuts",
  },
```

Append inside `ja`:

```ts
  quickAdd: {
    title: "クイック追加",
    logged: (label) => `「${label}」を記録しました`,
    undo: "元に戻す",
    undone: "取り消しました",
    emptyTitle: "ショートカットがありません",
    emptyHint:
      "クイック追加なら、朝ごはんや夕方の散歩などの日課をワンタップで記録できます。",
    manage: "ショートカットを設定",
  },
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck -w app && npm run build -w app`
Expected: clean. Manual smoke: long-press the FAB (touch emulation) → Quick Add sheet; tapping a preset closes the sheet, shows the toast, Undo removes the entry.

- [ ] **Step 5: Commit**

```bash
git add app/
git commit -m "feat: add quick add presets with undo toast and fab long-press"
```

---

### Task 9: Home dashboard — today so far, quick add, care/anomaly slots

**Files:**
- Create: `app/src/lib/activitySummary.ts`
- Create: `app/src/components/ActivityRow.tsx`
- Modify: `app/src/routes/Home.tsx` (full replacement)
- Modify: `app/src/i18n/messages.ts`, `en.ts`, `ja.ts`

- [ ] **Step 1: Create `app/src/lib/activitySummary.ts`**

One localized summary line per activity, reused by Home, the calendar day sheet, timeline chips, and the Log.

```ts
import type { ActivityResponse } from "@pawlog/shared";
import type { Messages } from "../i18n/messages";
import { parseDetails } from "./details";

/** "Dry · 60 g" / "250 ml" / "Pee · Normal" / "4.2 kg" … */
export function summarizeActivity(a: ActivityResponse, t: Messages): string {
  switch (a.category) {
    case "food": {
      const d = parseDetails("food", a.details);
      if (!d) return "";
      const parts = [t.options.foodType[d.foodType]];
      if (d.amount !== undefined)
        parts.push(`${d.amount} ${t.options.unit[d.unit]}`);
      if (d.name) parts.push(d.name);
      return parts.join(" · ");
    }
    case "water": {
      const d = parseDetails("water", a.details);
      return d ? `${d.amountMl} ml` : "";
    }
    case "toilet": {
      const d = parseDetails("toilet", a.details);
      return d
        ? `${t.options.toiletKind[d.kind]} · ${t.options.condition[d.condition]}`
        : "";
    }
    case "weight": {
      const d = parseDetails("weight", a.details);
      return d ? `${d.kg} kg` : "";
    }
    case "exercise": {
      const d = parseDetails("exercise", a.details);
      if (!d) return "";
      const parts = [t.options.exerciseKind[d.kind]];
      if (d.durationMin !== undefined) parts.push(`${d.durationMin} min`);
      if (d.distanceKm !== undefined) parts.push(`${d.distanceKm} km`);
      return parts.join(" · ");
    }
    case "symptom": {
      const d = parseDetails("symptom", a.details);
      return d ? `${d.name} · ${t.options.severity[d.severity]}` : "";
    }
    case "medication": {
      const d = parseDetails("medication", a.details);
      if (!d) return "";
      const parts = [d.name];
      if (d.dose !== undefined) parts.push(`${d.dose}${d.doseUnit ?? ""}`);
      return parts.join(" · ");
    }
    case "vet_visit": {
      const d = parseDetails("vet_visit", a.details);
      return d?.clinic ?? d?.reason ?? "";
    }
    case "grooming": {
      const d = parseDetails("grooming", a.details);
      return d ? t.options.groomingKind[d.kind] : "";
    }
    case "vaccination": {
      const d = parseDetails("vaccination", a.details);
      return d?.vaccineName ?? "";
    }
    case "note":
      return "";
  }
}
```

- [ ] **Step 2: Create `app/src/components/ActivityRow.tsx`**

```tsx
import type { ActivityResponse } from "@pawlog/shared";
import { Link } from "react-router";
import { useLocaleTag, useT } from "../i18n";
import { summarizeActivity } from "../lib/activitySummary";
import { formatTime } from "../lib/dates";
import { CategoryIcon, categoryTone } from "./CategoryIcon";
import { CameraIcon } from "./icons";
import { cn } from "../lib/cn";

export function ActivityRow({ activity }: { activity: ActivityResponse }) {
  const t = useT();
  const tag = useLocaleTag();
  const tone = categoryTone[activity.category];
  const summary = summarizeActivity(activity, t);

  return (
    <Link
      to={`/pets/${activity.petId}/activities/${activity.id}`}
      className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-cream-50"
    >
      <span className="w-11 shrink-0 text-sm font-semibold tabular-nums text-ink-faint">
        {formatTime(activity.occurredAt, activity.tzOffsetMin, tag)}
      </span>
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          tone.soft,
          tone.text,
        )}
      >
        <CategoryIcon category={activity.category} className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-ink">
            {t.categories[activity.category]}
          </span>
          {summary && (
            <span className="truncate text-sm text-ink-soft">{summary}</span>
          )}
        </span>
        {activity.memo && (
          <span className="block truncate text-xs text-ink-faint">
            {activity.memo}
          </span>
        )}
      </span>
      {activity.photos.length > 0 && (
        <CameraIcon className="h-4 w-4 shrink-0 text-ink-faint" />
      )}
    </Link>
  );
}
```

(The detail route lands in Task 13; until then a row click bounces off the wildcard redirect — harmless mid-plan.)

- [ ] **Step 3: Replace `app/src/routes/Home.tsx` (final version)**

```tsx
import { Link, useOutletContext } from "react-router";
import { useActivitiesRange } from "../api/activities";
import { ActivityRow } from "../components/ActivityRow";
import { PetAvatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { SproutIcon } from "../components/icons";
import { Spinner } from "../components/Spinner";
import { QuickAddGrid } from "../features/quickadd/QuickAddGrid";
import { useLocaleTag, useT } from "../i18n";
import { dayEndMs, dayStartMs, formatDayHeading, todayKey } from "../lib/dates";
import { useRequiredPet } from "../state/pets";
import type { ShellOutletContext } from "./Shell";

export function Home() {
  const t = useT();
  const tag = useLocaleTag();
  const pet = useRequiredPet();
  const { openAdd } = useOutletContext<ShellOutletContext>();
  const today = todayKey();
  const activities = useActivitiesRange(
    pet.id,
    dayStartMs(today),
    dayEndMs(today),
  );
  const items = [...(activities.data ?? [])].sort(
    (a, b) => b.occurredAt - a.occurredAt,
  );

  return (
    <div className="flex flex-col gap-5">
      {/* greeting hero */}
      <section className="animate-pop flex items-center gap-4">
        <PetAvatar pet={pet} size="lg" />
        <div>
          <h1 className="text-2xl text-ink">{t.home.greeting(pet.name)}</h1>
          <p className="text-sm text-ink-faint">
            {formatDayHeading(today, tag)}
          </p>
        </div>
      </section>

      {/* Plan-4 slot: anomaly banners render here (insights API) */}
      <section data-slot="anomaly-banners" className="hidden" aria-hidden="true" />

      {/* Plan-4 slot: care items (overdue / due today) */}
      <Card
        data-slot="care-items"
        className="animate-pop flex items-center gap-3 bg-moss-100/60"
        style={{ animationDelay: "60ms" }}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper text-moss-600">
          <SproutIcon className="h-6 w-6" />
        </span>
        <div>
          <p className="font-display text-ink">{t.home.careSoonTitle}</p>
          <p className="text-sm text-ink-soft">{t.home.careSoonBody}</p>
        </div>
      </Card>

      {/* today so far */}
      <section className="animate-pop" style={{ animationDelay: "120ms" }}>
        <h2 className="mb-2 font-display text-lg text-ink">
          {t.home.todaySoFar}
        </h2>
        <Card className="p-0">
          {activities.isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              title={t.home.quietTitle}
              hint={t.home.quietHint}
              action={
                <Button size="sm" onClick={openAdd}>
                  {t.nav.addActivity}
                </Button>
              }
            />
          ) : (
            <div className="divide-y divide-cream-200">
              {items.map((activity) => (
                <ActivityRow key={activity.id} activity={activity} />
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* quick add */}
      <section className="animate-pop" style={{ animationDelay: "180ms" }}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-lg text-ink">{t.quickAdd.title}</h2>
          <Link
            to="/settings/presets"
            className="text-sm font-semibold text-clay-600 underline-offset-4 hover:underline"
          >
            {t.quickAdd.manage}
          </Link>
        </div>
        <QuickAddGrid petId={pet.id} />
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Add the i18n keys**

Append inside the `Messages` interface:

```ts
  home: {
    greeting: (petName: string) => string;
    todaySoFar: string;
    quietTitle: string;
    quietHint: string;
    careSoonTitle: string;
    careSoonBody: string;
  };
```

Append inside `en`:

```ts
  home: {
    greeting: (petName) => `Hello, ${petName}!`,
    todaySoFar: "Today so far",
    quietTitle: "A quiet day so far",
    quietHint: "Anything your family logs shows up here as the day unfolds.",
    careSoonTitle: "Care reminders are coming",
    careSoonBody:
      "Medication schedules and due-date reminders will live right here soon.",
  },
```

Append inside `ja`:

```ts
  home: {
    greeting: (petName) => `${petName}、こんにちは！`,
    todaySoFar: "今日のようす",
    quietTitle: "今日はまだ静かです",
    quietHint: "家族の誰かが記録すると、ここに今日のようすが集まります。",
    careSoonTitle: "ケアのリマインダーは準備中",
    careSoonBody: "お薬のスケジュールや予定日のお知らせが、まもなくここに届きます。",
  },
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck -w app && npm run build -w app`
Expected: clean. Manual smoke: Home shows greeting + date, the moss care slot, today's entries newest-first (after logging via FAB), the empty state with its Add button when fresh, and the Quick Add grid.

- [ ] **Step 6: Commit**

```bash
git add app/
git commit -m "feat: assemble home dashboard with today timeline and placeholders"
```

---

### Task 10: Calendar tab — view switcher, month grid with category dots, day sheet

**Files:**
- Create: `app/src/lib/useSwipe.ts`
- Create: `app/src/features/calendar/MonthGrid.tsx`
- Create: `app/src/features/calendar/DaySheet.tsx`
- Modify: `app/src/routes/CalendarTab.tsx` (full replacement)
- Modify: `app/src/i18n/messages.ts`, `en.ts`, `ja.ts`

URL state: `/calendar?view=month|week|3day|day&date=YYYY-MM-DD` (shareable, survives reload). This task ships Month completely; the three timeline views render an interim empty body that Task 11 replaces with `<Timeline/>` (the header/switcher/swipe plumbing for them is finished here).

- [ ] **Step 1: Create `app/src/lib/useSwipe.ts`**

```ts
import { useRef, type TouchEvent } from "react";

/**
 * Horizontal swipe detection (touch). Returns handlers to spread onto a
 * container. Fires when |dx| > threshold and the gesture is clearly
 * horizontal (|dx| > 1.5·|dy|) — vertical scrolling stays untouched.
 */
export function useSwipe(opts: {
  onLeft: () => void;
  onRight: () => void;
  thresholdPx?: number;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) start.current = { x: touch.clientX, y: touch.clientY };
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      const touch = e.changedTouches[0];
      if (!s || !touch) return;
      const dx = touch.clientX - s.x;
      const dy = touch.clientY - s.y;
      const threshold = opts.thresholdPx ?? 48;
      if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) opts.onLeft();
        else opts.onRight();
      }
    },
  };
}
```

- [ ] **Step 2: Create `app/src/features/calendar/MonthGrid.tsx`**

Per-day colored category dots (max 4 + "+n"), today ring, dimmed out-of-month cells, Monday-start weekday header.

```tsx
import { CATEGORIES, type DaySummaryResponse } from "@pawlog/shared";
import { categoryTone } from "../../components/CategoryIcon";
import { useLocaleTag } from "../../i18n";
import { cn } from "../../lib/cn";
import {
  dayKeyToParts,
  monthGrid,
  todayKey,
  type DayKey,
  type MonthKey,
} from "../../lib/dates";

const MAX_DOTS = 4;

function weekdayLabels(tag: string, firstWeek: DayKey[]): string[] {
  const fmt = new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" });
  return firstWeek.map((key) => {
    const { year, month, day } = dayKeyToParts(key);
    return fmt.format(new Date(Date.UTC(year, month - 1, day)));
  });
}

export function MonthGrid({
  monthKey,
  days,
  onSelectDay,
}: {
  monthKey: MonthKey;
  days: DaySummaryResponse["days"] | undefined;
  onSelectDay: (key: DayKey) => void;
}) {
  const tag = useLocaleTag();
  const cells = monthGrid(monthKey);
  const today = todayKey();
  const headers = weekdayLabels(tag, cells.slice(0, 7).map((c) => c.key));

  return (
    <div>
      <div className="grid grid-cols-7 pb-1">
        {headers.map((label) => (
          <span
            key={label}
            className="text-center text-xs font-semibold text-ink-faint"
          >
            {label}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-card bg-paper shadow-card">
        {cells.map((cell) => {
          const counts = days?.[cell.key];
          // stable category order for the dots
          const cats = counts
            ? CATEGORIES.filter((c) => (counts[c] ?? 0) > 0)
            : [];
          const shown = cats.slice(0, MAX_DOTS);
          const extra = cats.length - shown.length;
          const isToday = cell.key === today;
          return (
            <button
              key={cell.key}
              type="button"
              onClick={() => onSelectDay(cell.key)}
              className={cn(
                "flex min-h-16 flex-col items-center gap-1 border-b border-r border-cream-100 py-1.5 transition hover:bg-cream-50 active:bg-cream-100",
                !cell.inMonth && "opacity-35",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
                  isToday ? "bg-clay-500 text-white" : "text-ink",
                )}
              >
                {dayKeyToParts(cell.key).day}
              </span>
              <span className="flex h-3 items-center gap-0.5">
                {shown.map((cat) => (
                  <span
                    key={cat}
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      categoryTone[cat].bg,
                    )}
                  />
                ))}
                {extra > 0 && (
                  <span className="text-[9px] font-bold leading-none text-ink-faint">
                    +{extra}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `app/src/features/calendar/DaySheet.tsx`**

```tsx
import { useActivitiesRange } from "../../api/activities";
import { ActivityRow } from "../../components/ActivityRow";
import { EmptyState } from "../../components/EmptyState";
import { Sheet } from "../../components/Sheet";
import { Spinner } from "../../components/Spinner";
import { useLocaleTag, useT } from "../../i18n";
import {
  dayEndMs,
  dayStartMs,
  formatDayHeading,
  type DayKey,
} from "../../lib/dates";

export function DaySheet({
  petId,
  day,
  onClose,
}: {
  petId: string;
  day: DayKey | null;
  onClose: () => void;
}) {
  const t = useT();
  const tag = useLocaleTag();
  const enabled = day !== null;
  const activities = useActivitiesRange(
    petId,
    enabled ? dayStartMs(day) : 0,
    enabled ? dayEndMs(day) : 0,
  );
  const items = [...(activities.data ?? [])].sort(
    (a, b) => a.occurredAt - b.occurredAt,
  );

  return (
    <Sheet
      open={enabled}
      onClose={onClose}
      title={day ? formatDayHeading(day, tag) : ""}
    >
      {activities.isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={t.calendar.dayEmpty} />
      ) : (
        <div className="-mx-5 divide-y divide-cream-200">
          {items.map((activity) => (
            <ActivityRow key={activity.id} activity={activity} />
          ))}
        </div>
      )}
    </Sheet>
  );
}
```

(When `day` is null the Sheet is closed and TanStack Query still mounts the hook — the `0..0` range query is fired at most once and returns an empty page; acceptable and keeps hooks unconditional.)

- [ ] **Step 4: Replace `app/src/routes/CalendarTab.tsx`**

Segmented switcher + header with chevrons (steps a month in month view, one view-width otherwise) + swipeable month grid + day sheet. The `view !== "month"` body is the interim block Task 11 replaces.

```tsx
import { useState } from "react";
import { useSearchParams } from "react-router";
import { useDaySummary } from "../api/activities";
import { EmptyState } from "../components/EmptyState";
import { IconButton } from "../components/IconButton";
import { ChevronLeftIcon, ChevronRightIcon } from "../components/icons";
import { DaySheet } from "../features/calendar/DaySheet";
import { MonthGrid } from "../features/calendar/MonthGrid";
import { useLocaleTag, useT } from "../i18n";
import { cn } from "../lib/cn";
import {
  formatDayHeading,
  formatDayShort,
  formatMonthTitle,
  monthKeyOf,
  shiftAnchor,
  shiftMonth,
  todayKey,
  viewDays,
  type CalendarView,
  type DayKey,
} from "../lib/dates";
import { useSwipe } from "../lib/useSwipe";
import { useRequiredPet } from "../state/pets";

const VIEWS: CalendarView[] = ["month", "week", "3day", "day"];

export function CalendarTab() {
  const t = useT();
  const tag = useLocaleTag();
  const pet = useRequiredPet();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sheetDay, setSheetDay] = useState<DayKey | null>(null);

  const viewParam = searchParams.get("view");
  const view: CalendarView = VIEWS.includes(viewParam as CalendarView)
    ? (viewParam as CalendarView)
    : "month";
  const dateParam = searchParams.get("date");
  const date: DayKey = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? "")
    ? (dateParam as DayKey)
    : todayKey();

  const setParams = (nextView: CalendarView, nextDate: DayKey) =>
    setSearchParams({ view: nextView, date: nextDate }, { replace: true });

  const monthKey = monthKeyOf(date);
  const summary = useDaySummary(pet.id, monthKey);

  const shift = (delta: number) => {
    if (view === "month") {
      setParams(view, `${shiftMonth(monthKey, delta)}-01`);
    } else {
      setParams(view, shiftAnchor(view, date, delta));
    }
  };
  const swipe = useSwipe({ onLeft: () => shift(1), onRight: () => shift(-1) });

  const title =
    view === "month"
      ? formatMonthTitle(monthKey, tag)
      : view === "day"
        ? formatDayHeading(date, tag)
        : (() => {
            const days = viewDays(view, date);
            const last = days[days.length - 1] ?? date;
            return `${formatDayShort(days[0] ?? date, tag)} – ${formatDayShort(last, tag)}`;
          })();

  return (
    <div className="animate-pop flex flex-col gap-3">
      {/* segmented view switcher */}
      <div
        role="group"
        aria-label={t.nav.calendar}
        className="flex rounded-full bg-cream-200 p-1"
      >
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setParams(v, date)}
            className={cn(
              "flex-1 rounded-full py-1.5 text-sm font-semibold transition",
              view === v
                ? "bg-paper text-clay-700 shadow-card"
                : "text-ink-soft hover:text-ink",
            )}
          >
            {t.calendar.views[v]}
          </button>
        ))}
      </div>

      {/* range header */}
      <div className="flex items-center justify-between">
        <IconButton label={t.calendar.previous} onClick={() => shift(-1)}>
          <ChevronLeftIcon className="h-5 w-5" />
        </IconButton>
        <button
          type="button"
          className="font-display text-lg text-ink"
          onClick={() => setParams(view, todayKey())}
          title={t.common.today}
        >
          {title}
        </button>
        <IconButton label={t.calendar.next} onClick={() => shift(1)}>
          <ChevronRightIcon className="h-5 w-5" />
        </IconButton>
      </div>

      {view === "month" ? (
        <div {...swipe}>
          <MonthGrid
            monthKey={monthKey}
            days={summary.data?.days}
            onSelectDay={setSheetDay}
          />
        </div>
      ) : (
        <EmptyState title={t.calendar.views[view]} />
      )}

      <DaySheet petId={pet.id} day={sheetDay} onClose={() => setSheetDay(null)} />
    </div>
  );
}
```

- [ ] **Step 5: Add the i18n keys**

Append inside the `Messages` interface (the view keys are declared inline — messages.ts must not import from `lib/`):

```ts
  calendar: {
    views: Record<"month" | "week" | "3day" | "day", string>;
    previous: string;
    next: string;
    dayEmpty: string;
  };
```

Append inside `en`:

```ts
  calendar: {
    views: { month: "Month", week: "Week", "3day": "3 days", day: "Day" },
    previous: "Previous",
    next: "Next",
    dayEmpty: "Nothing logged this day",
  },
```

Append inside `ja`:

```ts
  calendar: {
    views: { month: "月", week: "週", "3day": "3日", day: "日" },
    previous: "前へ",
    next: "次へ",
    dayEmpty: "この日の記録はありません",
  },
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck -w app && npm run build -w app`
Expected: clean. Manual smoke: month grid shows dots colored by category (log a Food + Water today first), swiping/chevrons change the month, tapping a day opens the bottom sheet with that day's list, tapping the title jumps back to today.

- [ ] **Step 7: Commit**

```bash
git add app/
git commit -m "feat: add calendar month grid with day sheet"
```

---

### Task 11: Timeline component (Week / 3-Day / Day) + lane math test

**Files:**
- Create: `app/src/lib/timeline.ts`
- Test: `app/test/timeline.test.ts`
- Create: `app/src/features/calendar/Timeline.tsx`
- Modify: `app/src/routes/CalendarTab.tsx` (swap the interim branch)

ONE component renders all three views — only the `days` array length differs (7 / 3 / 1). Activities are point events: fixed-height chips positioned by household time, greedy lanes resolving overlaps. Lane math is pure and unit-tested (spec §9 "timeline layout").

- [ ] **Step 1: Write the failing test `app/test/timeline.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { LANE_GAP_MIN, placeItems } from "../src/lib/timeline";

describe("placeItems", () => {
  it("returns [] for no items", () => {
    expect(placeItems([])).toEqual([]);
  });

  it("keeps well-spaced items in one lane", () => {
    const placed = placeItems([
      { id: "a", minute: 60 },
      { id: "b", minute: 60 + LANE_GAP_MIN },
      { id: "c", minute: 60 + LANE_GAP_MIN * 2 },
    ]);
    expect(placed.map((p) => p.lane)).toEqual([0, 0, 0]);
    expect(placed.every((p) => p.laneCount === 1)).toBe(true);
  });

  it("splits overlapping items into lanes and reuses freed lanes", () => {
    const placed = placeItems([
      { id: "a", minute: 60 },
      { id: "b", minute: 80 }, // overlaps a → lane 1
      { id: "c", minute: 300 }, // far later → back to lane 0
    ]);
    const byId = Object.fromEntries(placed.map((p) => [p.id, p]));
    expect(byId["a"]!.lane).toBe(0);
    expect(byId["b"]!.lane).toBe(1);
    expect(byId["c"]!.lane).toBe(0);
    expect(placed.every((p) => p.laneCount === 2)).toBe(true);
  });

  it("sorts by minute before placing", () => {
    const placed = placeItems([
      { id: "late", minute: 500 },
      { id: "early", minute: 10 },
    ]);
    expect(placed[0]!.id).toBe("early");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w app`
Expected: FAIL — `../src/lib/timeline` not found (dates tests still pass).

- [ ] **Step 3: Create `app/src/lib/timeline.ts`**

```ts
/** Two chips within this many minutes are considered overlapping. */
export const LANE_GAP_MIN = 45;

export type Placed<T> = T & { lane: number; laneCount: number };

/**
 * Greedy lane assignment for point events in one day column:
 * each item takes the first lane whose previous item is ≥ LANE_GAP_MIN
 * minutes earlier; otherwise a new lane opens. `laneCount` is the column's
 * total lane count (all chips share the width evenly).
 */
export function placeItems<T extends { minute: number }>(
  items: T[],
): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.minute - b.minute);
  const laneLastMinute: number[] = [];
  const placed = sorted.map((item) => {
    let lane = laneLastMinute.findIndex(
      (last) => item.minute - last >= LANE_GAP_MIN,
    );
    if (lane === -1) {
      lane = laneLastMinute.length;
      laneLastMinute.push(item.minute);
    } else {
      laneLastMinute[lane] = item.minute;
    }
    return { ...item, lane, laneCount: 1 };
  });
  const laneCount = Math.max(1, laneLastMinute.length);
  return placed.map((p) => ({ ...p, laneCount }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w app`
Expected: PASS (dates + timeline).

- [ ] **Step 5: Create `app/src/features/calendar/Timeline.tsx`**

```tsx
import type { ActivityResponse } from "@pawlog/shared";
import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router";
import { useActivitiesRange } from "../../api/activities";
import { CategoryIcon, categoryTone } from "../../components/CategoryIcon";
import { Spinner } from "../../components/Spinner";
import { useLocaleTag, useT } from "../../i18n";
import { cn } from "../../lib/cn";
import {
  dayKeyOf,
  formatDayShort,
  formatTime,
  minutesIntoDay,
  rangeMs,
  todayKey,
  type DayKey,
} from "../../lib/dates";
import { placeItems, type Placed } from "../../lib/timeline";
import { useSwipe } from "../../lib/useSwipe";

const HOUR_PX = 44;
const CHIP_PX = 38;
const DAY_HEIGHT = 24 * HOUR_PX;

function Chip({
  activity,
  lane,
  laneCount,
  minute,
}: {
  activity: ActivityResponse;
  lane: number;
  laneCount: number;
  minute: number;
}) {
  const t = useT();
  const tag = useLocaleTag();
  const tone = categoryTone[activity.category];
  const width = 100 / laneCount;
  return (
    <Link
      to={`/pets/${activity.petId}/activities/${activity.id}`}
      title={`${formatTime(activity.occurredAt, activity.tzOffsetMin, tag)} ${t.categories[activity.category]}`}
      style={{
        top: (minute / 60) * HOUR_PX,
        height: CHIP_PX,
        left: `${lane * width}%`,
        width: `calc(${width}% - 3px)`,
      }}
      className={cn(
        "absolute flex items-center gap-1 overflow-hidden rounded-lg border-l-4 bg-paper px-1.5 shadow-card transition hover:z-10 hover:shadow-float",
        tone.border,
      )}
    >
      <span className={cn("shrink-0", tone.text)}>
        <CategoryIcon category={activity.category} className="h-4 w-4" />
      </span>
      <span className="truncate text-[11px] font-semibold leading-tight text-ink">
        {formatTime(activity.occurredAt, activity.tzOffsetMin, tag)}{" "}
        {t.categories[activity.category]}
      </span>
    </Link>
  );
}

export function Timeline({
  petId,
  days,
  onShift,
}: {
  petId: string;
  days: DayKey[];
  onShift: (delta: number) => void;
}) {
  const tag = useLocaleTag();
  const { from, to } = rangeMs(days);
  const activities = useActivitiesRange(petId, from, to);
  const swipe = useSwipe({ onLeft: () => onShift(1), onRight: () => onShift(-1) });
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = todayKey();
  const daysKey = days.join(",");

  // start the viewport at 07:00 when the range changes
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 7 * HOUR_PX });
  }, [daysKey]);

  const byDay = useMemo(() => {
    type Item = { minute: number; activity: ActivityResponse };
    const map = new Map<DayKey, Placed<Item>[]>();
    for (const day of days) map.set(day, []);
    const grouped = new Map<DayKey, Item[]>();
    for (const activity of activities.data ?? []) {
      const key = dayKeyOf(activity.occurredAt, activity.tzOffsetMin);
      if (!map.has(key)) continue; // outside the visible household days
      const bucket = grouped.get(key) ?? [];
      bucket.push({
        minute: minutesIntoDay(activity.occurredAt, activity.tzOffsetMin),
        activity,
      });
      grouped.set(key, bucket);
    }
    for (const [key, bucket] of grouped) map.set(key, placeItems(bucket));
    return map;
  }, [activities.data, daysKey]);

  return (
    <div {...swipe} className="overflow-hidden rounded-card bg-paper shadow-card">
      {/* day headers */}
      <div className="flex border-b border-cream-200">
        <div className="w-12 shrink-0" />
        {days.map((day) => (
          <div
            key={day}
            className={cn(
              "flex-1 border-l border-cream-100 py-2 text-center text-sm font-semibold",
              day === today ? "text-clay-600" : "text-ink-soft",
            )}
          >
            {formatDayShort(day, tag)}
          </div>
        ))}
      </div>

      {activities.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="relative h-[min(60dvh,560px)] overflow-y-auto"
        >
          <div className="relative flex" style={{ height: DAY_HEIGHT }}>
            {/* hour axis */}
            <div className="relative w-12 shrink-0">
              {Array.from({ length: 24 }, (_, hour) => (
                <span
                  key={hour}
                  className="absolute right-1.5 -translate-y-1/2 text-[10px] font-semibold tabular-nums text-ink-faint"
                  style={{ top: hour * HOUR_PX }}
                >
                  {hour === 0 ? "" : `${String(hour).padStart(2, "0")}:00`}
                </span>
              ))}
            </div>
            {/* day columns */}
            {days.map((day) => (
              <div
                key={day}
                className="relative flex-1 border-l border-cream-100"
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <span
                    key={hour}
                    aria-hidden="true"
                    className="absolute inset-x-0 border-t border-cream-100"
                    style={{ top: hour * HOUR_PX }}
                  />
                ))}
                {(byDay.get(day) ?? []).map((placed) => (
                  <Chip
                    key={placed.activity.id}
                    activity={placed.activity}
                    minute={placed.minute}
                    lane={placed.lane}
                    laneCount={placed.laneCount}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Swap the interim branch in `app/src/routes/CalendarTab.tsx`**

Add the import:

```ts
import { Timeline } from "../features/calendar/Timeline";
```

Replace:

```tsx
      ) : (
        <EmptyState title={t.calendar.views[view]} />
      )}
```

with:

```tsx
      ) : (
        <Timeline
          petId={pet.id}
          days={viewDays(view, date)}
          onShift={(delta) => setParams(view, shiftAnchor(view, date, delta))}
        />
      )}
```

Remove the now-unused `EmptyState` import from CalendarTab.

- [ ] **Step 7: Verify**

Run: `npm run test -w app && npm run typecheck -w app && npm run build -w app`
Expected: all green. Manual smoke: Week shows 7 columns with chips at their household times (overlapping entries split into lanes), 3-Day/Day narrow accordingly, swipe + chevrons shift by the view width, the viewport opens at 07:00, chips link toward the detail route.

- [ ] **Step 8: Commit**

```bash
git add app/
git commit -m "feat: add week, 3-day, and day timeline views with swipe"
```

---

### Task 12: Log tab — infinite scroll, category filter chips, memo search

**Files:**
- Modify: `app/src/routes/LogTab.tsx` (full replacement)
- Modify: `app/src/i18n/messages.ts`, `en.ts`, `ja.ts`

`useInfiniteQuery` + the API's keyset cursor; sticky day headers (Today/Yesterday localized, then full dates); multi-select category chips; 300 ms-debounced memo search (`q`).

- [ ] **Step 1: Replace `app/src/routes/LogTab.tsx`**

```tsx
import { CATEGORIES, type Category } from "@pawlog/shared";
import { useEffect, useRef, useState } from "react";
import { useLogActivities } from "../api/activities";
import { ActivityRow } from "../components/ActivityRow";
import { CategoryIcon, categoryTone } from "../components/CategoryIcon";
import { Chip } from "../components/Chip";
import { EmptyState } from "../components/EmptyState";
import { TextInput } from "../components/form";
import { PawIcon, SearchIcon } from "../components/icons";
import { Spinner } from "../components/Spinner";
import { useLocaleTag, useT } from "../i18n";
import {
  dayKeyOf,
  formatDayHeading,
  relativeDayKind,
  todayKey,
  type DayKey,
} from "../lib/dates";
import { useRequiredPet } from "../state/pets";

export function LogTab() {
  const t = useT();
  const tag = useLocaleTag();
  const pet = useRequiredPet();
  const [selectedCats, setSelectedCats] = useState<Category[]>([]);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);

  // debounce the search input
  useEffect(() => {
    const id = window.setTimeout(() => setQ(qInput.trim()), 300);
    return () => window.clearTimeout(id);
  }, [qInput]);

  const log = useLogActivities(pet.id, { categories: selectedCats, q });
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = log;

  // infinite scroll sentinel
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const toggleCat = (category: Category) =>
    setSelectedCats((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category],
    );

  const items = log.data?.pages.flatMap((page) => page.items) ?? [];
  // group consecutive items (already sorted desc by the API) by household day
  const groups: { key: DayKey; items: typeof items }[] = [];
  for (const activity of items) {
    const key = dayKeyOf(activity.occurredAt, activity.tzOffsetMin);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(activity);
    else groups.push({ key, items: [activity] });
  }
  const today = todayKey();

  const dayLabel = (key: DayKey): string => {
    const kind = relativeDayKind(key, today);
    if (kind === "today") return t.common.today;
    if (kind === "yesterday") return t.common.yesterday;
    return formatDayHeading(key, tag);
  };

  return (
    <div className="animate-pop flex flex-col gap-3">
      {/* search */}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
        <TextInput
          type="search"
          value={qInput}
          placeholder={t.log.searchPlaceholder}
          aria-label={t.log.searchPlaceholder}
          className="pl-10"
          onChange={(e) => setQInput(e.target.value)}
        />
      </div>

      {/* category filter chips (multi-select) */}
      <div
        role="group"
        aria-label={t.log.filterLabel}
        className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1"
      >
        {CATEGORIES.map((category) => (
          <Chip
            key={category}
            selected={selectedCats.includes(category)}
            tone={categoryTone[category]}
            onClick={() => toggleCat(category)}
          >
            <CategoryIcon category={category} className="h-4 w-4" />
            {t.categories[category]}
          </Chip>
        ))}
      </div>

      {log.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={t.log.emptyTitle} hint={t.log.emptyHint} />
      ) : (
        <div className="overflow-hidden rounded-card bg-paper shadow-card">
          {groups.map((group) => (
            <section key={group.key}>
              <h2 className="sticky top-0 z-10 border-b border-cream-200 bg-cream-50/95 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-ink-soft backdrop-blur">
                {dayLabel(group.key)}
              </h2>
              <div className="divide-y divide-cream-100">
                {group.items.map((activity) => (
                  <ActivityRow key={activity.id} activity={activity} />
                ))}
              </div>
            </section>
          ))}
          <div ref={sentinelRef} className="flex justify-center py-4">
            {isFetchingNextPage ? (
              <Spinner className="h-5 w-5" />
            ) : !hasNextPage ? (
              <PawIcon
                aria-hidden="true"
                className="h-5 w-5 rotate-12 text-cream-300"
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the i18n keys**

Append inside the `Messages` interface:

```ts
  log: {
    searchPlaceholder: string;
    filterLabel: string;
    emptyTitle: string;
    emptyHint: string;
  };
```

Append inside `en`:

```ts
  log: {
    searchPlaceholder: "Search memos…",
    filterLabel: "Filter by category",
    emptyTitle: "Nothing here yet",
    emptyHint: "Try clearing filters, or log something with the paw button.",
  },
```

Append inside `ja`:

```ts
  log: {
    searchPlaceholder: "メモを検索…",
    filterLabel: "カテゴリで絞り込み",
    emptyTitle: "まだ記録がありません",
    emptyHint: "フィルタを解除するか、肉球ボタンから記録してみましょう。",
  },
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck -w app && npm run build -w app`
Expected: clean. Manual smoke: log 60+ entries (or loop the dev-login curl + POST), scroll loads more pages; "Today"/"Yesterday" headers stick while scrolling; selecting Food + Water chips narrows; typing in search filters by memo after the debounce; the end-of-list paw appears on the last page.

- [ ] **Step 4: Commit**

```bash
git add app/
git commit -m "feat: add log tab with infinite scroll, filters, and search"
```

---

### Task 13: Activity detail — full record, photo gallery, edit, delete

**Files:**
- Create: `app/src/routes/ActivityDetail.tsx`
- Modify: `app/src/App.tsx` (register the route)
- Modify: `app/src/i18n/messages.ts`, `en.ts`, `ja.ts`

The detail screen renders the category banner in the category's accent, a definition list of details (driven by the same `CATEGORY_FIELDS` config), the memo, a photo gallery with a tap-to-zoom lightbox, and edit (Sheet + the Task-7 form, pre-filled) / delete (confirm Sheet). Edit/delete hide for viewers.

- [ ] **Step 1: Create `app/src/routes/ActivityDetail.tsx`**

```tsx
import type { ActivityResponse } from "@pawlog/shared";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router";
import { useActivity, useDeleteActivity } from "../api/activities";
import { photoUrl } from "../api/photos";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { CategoryIcon, categoryTone } from "../components/CategoryIcon";
import { EmptyState } from "../components/EmptyState";
import { IconButton } from "../components/IconButton";
import { ArrowLeftIcon, PencilIcon, TrashIcon, XIcon } from "../components/icons";
import { Sheet } from "../components/Sheet";
import { Spinner } from "../components/Spinner";
import { useToast } from "../components/Toast";
import { ActivityForm } from "../features/add/ActivityForm";
import { CATEGORY_FIELDS } from "../features/add/categoryFields";
import { useLocaleTag, useT } from "../i18n";
import type { Messages } from "../i18n/messages";
import { cn } from "../lib/cn";
import { formatDateTime } from "../lib/dates";
import { usePets } from "../state/pets";

function detailRows(
  activity: ActivityResponse,
  t: Messages,
): { label: string; value: string }[] {
  const details = (activity.details ?? {}) as Record<string, unknown>;
  const rows: { label: string; value: string }[] = [];
  for (const spec of CATEGORY_FIELDS[activity.category]) {
    const raw = details[spec.key];
    if (raw === undefined || raw === null || raw === "") continue;
    const value =
      spec.control === "select" && spec.optionGroup
        ? ((t.options[spec.optionGroup] as Record<string, string>)[
            String(raw)
          ] ?? String(raw))
        : String(raw);
    rows.push({ label: t.fields[spec.label], value });
  }
  return rows;
}

function Lightbox({
  photoId,
  onClose,
  closeLabel,
}: {
  photoId: string;
  onClose: () => void;
  closeLabel: string;
}) {
  return createPortal(
    <div
      className="animate-fade fixed inset-0 z-[70] flex items-center justify-center bg-ink/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={closeLabel}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <IconButton
        label={closeLabel}
        className="absolute right-3 top-3 bg-paper"
        onClick={onClose}
      >
        <XIcon className="h-5 w-5" />
      </IconButton>
      <img
        src={photoUrl(photoId, "full")}
        alt=""
        className="max-h-full max-w-full rounded-card object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}

export function ActivityDetail() {
  const t = useT();
  const tag = useLocaleTag();
  const toast = useToast();
  const navigate = useNavigate();
  const { roleFor } = usePets();
  const params = useParams<{ petId: string; id: string }>();
  const petId = params.petId ?? "";
  const id = params.id ?? "";

  const activityQuery = useActivity(petId, id);
  const deleteActivity = useDeleteActivity(petId);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  if (activityQuery.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  const activity = activityQuery.data;
  if (!activity) {
    return (
      <EmptyState
        title={t.errors.notFound}
        action={
          <Button variant="soft" size="sm" onClick={() => navigate(-1)}>
            {t.common.back}
          </Button>
        }
      />
    );
  }

  const tone = categoryTone[activity.category];
  const rows = detailRows(activity, t);
  const canEdit = roleFor(petId) !== "viewer";

  const onDelete = () =>
    deleteActivity.mutate(activity.id, {
      onSuccess: () => {
        toast.show(t.detail.deleted);
        navigate(-1);
      },
      onError: () => toast.show(t.errors.title, { tone: "danger" }),
    });

  return (
    <div className="animate-pop flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <IconButton label={t.common.back} onClick={() => navigate(-1)}>
          <ArrowLeftIcon className="h-5 w-5" />
        </IconButton>
        {canEdit && (
          <div className="flex gap-1">
            <IconButton label={t.common.edit} onClick={() => setEditOpen(true)}>
              <PencilIcon className="h-5 w-5" />
            </IconButton>
            <IconButton
              label={t.common.delete}
              className="text-berry-600 hover:bg-berry-100"
              onClick={() => setConfirmOpen(true)}
            >
              <TrashIcon className="h-5 w-5" />
            </IconButton>
          </div>
        )}
      </div>

      {/* category banner */}
      <Card className={cn("flex items-center gap-4 border-l-8 p-5", tone.soft, tone.border)}>
        <span
          className={cn(
            "blob flex h-14 w-14 shrink-0 items-center justify-center bg-paper",
            tone.text,
          )}
        >
          <CategoryIcon category={activity.category} className="h-7 w-7" />
        </span>
        <div>
          <h1 className="text-2xl text-ink">
            {t.categories[activity.category]}
          </h1>
          <p className="text-sm text-ink-soft">
            {formatDateTime(activity.occurredAt, activity.tzOffsetMin, tag)}
          </p>
        </div>
      </Card>

      {rows.length > 0 && (
        <Card className="p-0">
          <dl className="divide-y divide-cream-100">
            {rows.map((row) => (
              <div
                key={row.label}
                className="flex items-baseline justify-between gap-4 px-4 py-2.5"
              >
                <dt className="text-sm font-semibold text-ink-faint">
                  {row.label}
                </dt>
                <dd className="text-right font-semibold text-ink">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      {activity.memo && (
        <Card>
          <h2 className="mb-1 text-sm font-semibold text-ink-faint">
            {t.add.memo}
          </h2>
          <p className="whitespace-pre-wrap text-ink">{activity.memo}</p>
        </Card>
      )}

      {activity.photos.length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-ink-faint">
            {t.add.photos}
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {activity.photos.map((photo) => (
              <button
                key={photo.id}
                type="button"
                aria-label={t.detail.viewPhoto}
                onClick={() => setLightboxId(photo.id)}
                className="overflow-hidden rounded-2xl transition active:scale-95"
              >
                <img
                  src={photoUrl(photo.id, "thumb")}
                  alt=""
                  className="aspect-square w-full object-cover"
                />
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* edit sheet: same form, pre-filled */}
      <Sheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={t.categories[activity.category]}
      >
        <ActivityForm
          petId={petId}
          category={activity.category}
          existing={activity}
          onSaved={() => {
            toast.show(t.detail.updated);
            setEditOpen(false);
          }}
        />
      </Sheet>

      {/* delete confirmation */}
      <Sheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t.detail.deleteTitle}
      >
        <p className="mb-4 text-ink-soft">{t.detail.deleteBody}</p>
        <div className="flex gap-2">
          <Button
            variant="danger"
            className="flex-1"
            disabled={deleteActivity.isPending}
            onClick={onDelete}
          >
            {t.common.delete}
          </Button>
          <Button
            variant="soft"
            className="flex-1"
            onClick={() => setConfirmOpen(false)}
          >
            {t.common.cancel}
          </Button>
        </div>
      </Sheet>

      {lightboxId && (
        <Lightbox
          photoId={lightboxId}
          closeLabel={t.common.close}
          onClose={() => setLightboxId(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register the route in `app/src/App.tsx`**

Add the import:

```ts
import { ActivityDetail } from "./routes/ActivityDetail";
```

and inside the `<Route element={<Shell />}>` block (before the wildcard):

```tsx
                <Route
                  path="/pets/:petId/activities/:id"
                  element={<ActivityDetail />}
                />
```

- [ ] **Step 3: Add the i18n keys**

Append inside the `Messages` interface:

```ts
  detail: {
    updated: string;
    deleted: string;
    deleteTitle: string;
    deleteBody: string;
    viewPhoto: string;
  };
```

Append inside `en`:

```ts
  detail: {
    updated: "Updated!",
    deleted: "Entry deleted",
    deleteTitle: "Delete this entry?",
    deleteBody:
      "It will disappear from every view. You can't undo this from the app.",
    viewPhoto: "View photo",
  },
```

Append inside `ja`:

```ts
  detail: {
    updated: "更新しました！",
    deleted: "記録を削除しました",
    deleteTitle: "この記録を削除しますか？",
    deleteBody: "すべての画面から消えます。アプリ上では元に戻せません。",
    viewPhoto: "写真を表示",
  },
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck -w app && npm run build -w app`
Expected: clean. Manual smoke: tap a row anywhere (Home/day sheet/log/timeline) → detail with the accent banner; edit pre-fills and saves; photos zoom in the lightbox; delete confirms, toasts, and navigates back with the entry gone everywhere.

- [ ] **Step 5: Commit**

```bash
git add app/
git commit -m "feat: add activity detail with gallery, edit, and delete"
```

---

### Task 14: Settings — hub + profile, presets management, export, account deletion

**Files:**
- Create: `app/src/routes/settings/SettingsHome.tsx`
- Create: `app/src/routes/settings/PresetsSettings.tsx`
- Create: `app/src/routes/settings/AccountSettings.tsx`
- Modify: `app/src/App.tsx` (register the routes)
- Modify: `app/src/i18n/messages.ts`, `en.ts`, `ja.ts`

Spec §3 "Other screens → Settings": account (profile, logout), pets (Task 5, linked here), language, Quick Add preset management, data export, account deletion. Sharing management arrives post-v1.

- [ ] **Step 1: Create `app/src/routes/settings/SettingsHome.tsx`**

```tsx
import type { Locale } from "@pawlog/shared";
import { useState } from "react";
import { Link } from "react-router";
import { myExportUrl, petExportUrl } from "../../api/export";
import { useLogout, useMe, useUpdateMe } from "../../api/me";
import { UserAvatar } from "../../components/Avatar";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Field, Select, TextInput } from "../../components/form";
import { ChevronRightIcon, DownloadIcon } from "../../components/icons";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";
import { useRequiredPet } from "../../state/pets";
import { SettingsPage } from "./SettingsPage";

export function SettingsHome() {
  const t = useT();
  const toast = useToast();
  const me = useMe();
  const updateMe = useUpdateMe();
  const logout = useLogout();
  const pet = useRequiredPet();
  const user = me.data?.user;
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [locale, setLocale] = useState<Locale>(user?.locale ?? "system");

  const saveProfile = () => {
    if (displayName.trim() === "") return;
    updateMe.mutate(
      { displayName: displayName.trim(), locale },
      { onSuccess: () => toast.show(t.settings.saved) },
    );
  };

  return (
    <SettingsPage title={t.nav.settings} backTo="/">
      {/* profile */}
      {user && (
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex items-center gap-3">
            <UserAvatar name={user.displayName} avatarUrl={user.avatarUrl} size="lg" />
            <div className="min-w-0">
              <p className="font-display text-lg text-ink">{user.displayName}</p>
              <p className="truncate text-sm text-ink-faint">{user.email}</p>
            </div>
          </div>
          <Field label={t.settings.displayName}>
            <TextInput
              value={displayName}
              maxLength={100}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
          <Field label={t.settings.language}>
            <Select
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
            >
              <option value="system">{t.settings.languageSystem}</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </Select>
          </Field>
          <Button
            size="sm"
            className="self-start"
            disabled={updateMe.isPending || displayName.trim() === ""}
            onClick={saveProfile}
          >
            {t.common.save}
          </Button>
        </Card>
      )}

      {/* sections */}
      <Card className="divide-y divide-cream-200 p-0">
        {(
          [
            { to: "/settings/pets", label: t.pets.yourPets },
            { to: "/settings/presets", label: t.settings.presets },
            { to: "/settings/account", label: t.settings.account },
          ] as const
        ).map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex items-center justify-between px-4 py-3.5 font-semibold text-ink transition hover:bg-cream-50"
          >
            {item.label}
            <ChevronRightIcon className="h-4 w-4 text-ink-faint" />
          </Link>
        ))}
      </Card>

      {/* data export */}
      <Card className="flex flex-col gap-1 p-2">
        <h2 className="px-2 pt-2 font-display text-lg text-ink">
          {t.settings.exportTitle}
        </h2>
        {(
          [
            { href: myExportUrl(), label: t.settings.exportAll },
            { href: petExportUrl(pet.id, "json"), label: t.settings.exportPetJson(pet.name) },
            { href: petExportUrl(pet.id, "csv"), label: t.settings.exportPetCsv(pet.name) },
          ] as const
        ).map((item) => (
          <a
            key={item.href}
            href={item.href}
            download
            className="flex items-center gap-2.5 rounded-2xl px-2 py-2 font-semibold text-clay-700 transition hover:bg-cream-50"
          >
            <DownloadIcon className="h-4 w-4" />
            {item.label}
          </a>
        ))}
      </Card>

      <Button
        variant="ghost"
        size="sm"
        className="self-start text-ink-faint"
        onClick={() => void logout()}
      >
        {t.logout}
      </Button>
    </SettingsPage>
  );
}
```

- [ ] **Step 2: Create `app/src/routes/settings/PresetsSettings.tsx`**

CRUD + reorder (up/down swaps re-number `sortOrder` to `index * 10`). The editor reuses the Task-7 category grid and config-driven fields — presets must store **complete** schema-valid details, enforced by the same `buildDetails`.

```tsx
import type { Category, PresetResponse } from "@pawlog/shared";
import { useEffect, useState } from "react";
import {
  useCreatePreset,
  useDeletePreset,
  usePresets,
  useUpdatePreset,
} from "../../api/presets";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { CategoryIcon, categoryTone } from "../../components/CategoryIcon";
import { EmptyState } from "../../components/EmptyState";
import { Field, TextInput } from "../../components/form";
import { IconButton } from "../../components/IconButton";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  PlusIcon,
  TrashIcon,
} from "../../components/icons";
import { Sheet } from "../../components/Sheet";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/Toast";
import { CategoryGrid } from "../../features/add/CategoryGrid";
import {
  buildDetails,
  initialValues,
  type FormValues,
} from "../../features/add/categoryFields";
import { DetailsFields } from "../../features/add/DetailsFields";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { useRequiredPet } from "../../state/pets";
import { SettingsPage } from "./SettingsPage";

function PresetEditorSheet({
  petId,
  open,
  nextSortOrder,
  onClose,
}: {
  petId: string;
  open: boolean;
  nextSortOrder: number;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const create = useCreatePreset(petId);
  const [category, setCategory] = useState<Category | null>(null);
  const [label, setLabel] = useState("");
  const [values, setValues] = useState<FormValues>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCategory(null);
      setLabel("");
      setValues({});
      setError(null);
    }
  }, [open]);

  const pick = (c: Category) => {
    setCategory(c);
    setValues(initialValues(c));
  };

  const save = () => {
    if (!category) return;
    if (label.trim() === "") {
      setError(t.add.requiredField(t.settings.presetLabel));
      return;
    }
    const built = buildDetails(category, values, t);
    if ("error" in built) {
      setError(built.error);
      return;
    }
    setError(null);
    create.mutate(
      {
        category,
        label: label.trim(),
        details: built.details,
        sortOrder: nextSortOrder,
      },
      {
        onSuccess: () => {
          toast.show(t.settings.presetCreated);
          onClose();
        },
        onError: () => toast.show(t.errors.title, { tone: "danger" }),
      },
    );
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t.settings.newPreset}
      wide={category === null}
    >
      {category === null ? (
        <CategoryGrid onPick={pick} />
      ) : (
        <div className="flex flex-col gap-4">
          <IconButton
            label={t.common.back}
            className="-mt-1 self-start"
            onClick={() => setCategory(null)}
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </IconButton>
          <Field label={t.settings.presetLabel}>
            <TextInput
              value={label}
              maxLength={30}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <DetailsFields
            category={category}
            values={values}
            onChange={setValues}
          />
          {error && (
            <p role="alert" className="text-sm font-semibold text-berry-600">
              {error}
            </p>
          )}
          <Button disabled={create.isPending} onClick={save}>
            {t.common.save}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

export function PresetsSettings() {
  const t = useT();
  const pet = useRequiredPet();
  const presets = usePresets(pet.id);
  const update = useUpdatePreset(pet.id);
  const remove = useDeletePreset(pet.id);
  const [editorOpen, setEditorOpen] = useState(false);
  const items = presets.data ?? [];

  /** Swap with a neighbor, then re-number every drifted sortOrder to idx*10. */
  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next: PresetResponse[] = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    for (let i = 0; i < next.length; i++) {
      const preset = next[i]!;
      if (preset.sortOrder !== i * 10) {
        await update.mutateAsync({
          id: preset.id,
          input: { sortOrder: i * 10 },
        });
      }
    }
  };

  return (
    <SettingsPage title={t.settings.presets} backTo="/settings">
      {presets.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={t.quickAdd.emptyTitle} hint={t.quickAdd.emptyHint} />
      ) : (
        <Card className="divide-y divide-cream-200 p-0">
          {items.map((preset, index) => {
            const tone = categoryTone[preset.category];
            return (
              <div key={preset.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                    tone.soft,
                    tone.text,
                  )}
                >
                  <CategoryIcon category={preset.category} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">
                    {preset.label}
                  </span>
                  <span className="block text-xs text-ink-faint">
                    {t.categories[preset.category]}
                  </span>
                </span>
                <IconButton
                  label={t.settings.moveUp}
                  disabled={index === 0 || update.isPending}
                  onClick={() => void move(index, -1)}
                >
                  <ArrowUpIcon className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label={t.settings.moveDown}
                  disabled={index === items.length - 1 || update.isPending}
                  onClick={() => void move(index, 1)}
                >
                  <ArrowDownIcon className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label={t.common.delete}
                  className="text-berry-600 hover:bg-berry-100"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(preset.id)}
                >
                  <TrashIcon className="h-4 w-4" />
                </IconButton>
              </div>
            );
          })}
        </Card>
      )}

      <Button variant="soft" size="sm" className="self-start" onClick={() => setEditorOpen(true)}>
        <PlusIcon className="h-4 w-4" />
        {t.settings.newPreset}
      </Button>

      <PresetEditorSheet
        petId={pet.id}
        open={editorOpen}
        nextSortOrder={items.length * 10}
        onClose={() => setEditorOpen(false)}
      />
    </SettingsPage>
  );
}
```

- [ ] **Step 3: Create `app/src/routes/settings/AccountSettings.tsx`**

Typed-email confirmation gates deletion (the server independently verifies the exact, case-sensitive match and rate-limits to 3/hour).

```tsx
import { useState } from "react";
import { useDeleteAccount, useLogout, useMe } from "../../api/me";
import { ApiError } from "../../api/client";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Field, TextInput } from "../../components/form";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";
import { SettingsPage } from "./SettingsPage";

export function AccountSettings() {
  const t = useT();
  const toast = useToast();
  const me = useMe();
  const logout = useLogout();
  const deleteAccount = useDeleteAccount();
  const [confirmEmail, setConfirmEmail] = useState("");
  const email = me.data?.user.email ?? "";
  const armed = confirmEmail === email && email !== "";

  const onDelete = () =>
    deleteAccount.mutate(confirmEmail, {
      onSuccess: () => {
        localStorage.removeItem("pawlog:selectedPetId");
        window.location.assign("/");
      },
      onError: (error) =>
        toast.show(
          error instanceof ApiError ? error.message : t.errors.title,
          { tone: "danger" },
        ),
    });

  return (
    <SettingsPage title={t.settings.account} backTo="/settings">
      <Card className="flex items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="text-sm text-ink-faint">{t.settings.signedInAs}</p>
          <p className="truncate font-semibold text-ink">{email}</p>
        </div>
        <Button variant="soft" size="sm" onClick={() => void logout()}>
          {t.logout}
        </Button>
      </Card>

      <Card className="border border-berry-100 p-5">
        <h2 className="mb-1 font-display text-lg text-berry-700">
          {t.settings.dangerTitle}
        </h2>
        <p className="mb-4 text-sm text-ink-soft">{t.settings.dangerBody}</p>
        <Field label={t.settings.confirmEmailLabel(email)}>
          <TextInput
            value={confirmEmail}
            autoComplete="off"
            onChange={(e) => setConfirmEmail(e.target.value)}
          />
        </Field>
        <Button
          variant="danger"
          className="mt-4"
          disabled={!armed || deleteAccount.isPending}
          onClick={onDelete}
        >
          {t.settings.deleteAccount}
        </Button>
      </Card>
    </SettingsPage>
  );
}
```

- [ ] **Step 4: Register the routes in `app/src/App.tsx`**

Add the imports:

```ts
import { AccountSettings } from "./routes/settings/AccountSettings";
import { PresetsSettings } from "./routes/settings/PresetsSettings";
import { SettingsHome } from "./routes/settings/SettingsHome";
```

and inside the `<Route element={<Shell />}>` block (before the wildcard):

```tsx
                <Route path="/settings" element={<SettingsHome />} />
                <Route path="/settings/presets" element={<PresetsSettings />} />
                <Route path="/settings/account" element={<AccountSettings />} />
```

(The final route table now covers: `/`, `/calendar`, `/log`, `/health`, `/pets/:petId/activities/:id`, `/settings`, `/settings/pets`, `/settings/pets/new`, `/settings/pets/:petId`, `/settings/presets`, `/settings/account`, wildcard → `/`.)

- [ ] **Step 5: Add the i18n keys**

Append inside the `Messages` interface:

```ts
  settings: {
    displayName: string;
    language: string;
    languageSystem: string;
    saved: string;
    presets: string;
    account: string;
    exportTitle: string;
    exportAll: string;
    exportPetJson: (petName: string) => string;
    exportPetCsv: (petName: string) => string;
    newPreset: string;
    presetLabel: string;
    presetCreated: string;
    moveUp: string;
    moveDown: string;
    signedInAs: string;
    dangerTitle: string;
    dangerBody: string;
    confirmEmailLabel: (email: string) => string;
    deleteAccount: string;
  };
```

Append inside `en`:

```ts
  settings: {
    displayName: "Display name",
    language: "Language",
    languageSystem: "Match device",
    saved: "Profile saved",
    presets: "Quick Add shortcuts",
    account: "Account",
    exportTitle: "Your data",
    exportAll: "Download everything (JSON)",
    exportPetJson: (petName) => `${petName}'s journal (JSON)`,
    exportPetCsv: (petName) => `${petName}'s journal (CSV)`,
    newPreset: "New shortcut",
    presetLabel: "Label",
    presetCreated: "Shortcut created",
    moveUp: "Move up",
    moveDown: "Move down",
    signedInAs: "Signed in as",
    dangerTitle: "Delete account",
    dangerBody:
      "Deletes your account, sessions, and every pet only you own — including photos. Pets shared with other owners survive. This cannot be undone.",
    confirmEmailLabel: (email) => `Type ${email} to confirm`,
    deleteAccount: "Delete my account forever",
  },
```

Append inside `ja`:

```ts
  settings: {
    displayName: "表示名",
    language: "言語",
    languageSystem: "端末に合わせる",
    saved: "プロフィールを保存しました",
    presets: "クイック追加ショートカット",
    account: "アカウント",
    exportTitle: "データ",
    exportAll: "すべてダウンロード（JSON）",
    exportPetJson: (petName) => `${petName}の日記（JSON）`,
    exportPetCsv: (petName) => `${petName}の日記（CSV）`,
    newPreset: "新しいショートカット",
    presetLabel: "ラベル",
    presetCreated: "ショートカットを作成しました",
    moveUp: "上へ移動",
    moveDown: "下へ移動",
    signedInAs: "サインイン中",
    dangerTitle: "アカウント削除",
    dangerBody:
      "アカウント、セッション、あなただけがオーナーのペット（写真を含む）をすべて削除します。ほかのオーナーがいる共有ペットは残ります。この操作は取り消せません。",
    confirmEmailLabel: (email) => `確認のため ${email} と入力してください`,
    deleteAccount: "アカウントを完全に削除する",
  },
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck -w app && npm run build -w app`
Expected: clean. Manual smoke: gear → settings hub; switching language to 日本語 re-renders every screen in Japanese (persisted via PATCH); presets create/reorder/delete reflect in Quick Add; the export links download; account deletion stays disabled until the exact email is typed; logout returns to the warm Login.

- [ ] **Step 7: Commit**

```bash
git add app/
git commit -m "feat: add settings screens for profile, presets, export, and account"
```

---

### Task 15: Final wire-check + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Full-stack verification**

Run: `npm run typecheck`
Expected: shared, worker, and app all clean.

Run: `npm run test`
Expected: app builds, all worker tests pass (~126 incl. the Task-4 oauth redirect test), all app unit tests pass (dates + timeline).

Run: `npm run build`
Expected: `app/dist/` produced without warnings that indicate missing chunks.

- [ ] **Step 2: End-to-end manual checklist (`npm run dev`, mobile viewport first)**

- [ ] Login (warm hero) → dev sign-in → Onboarding → create pet → Home.
- [ ] FAB → Food (3 essentials above the fold) + memo + 2 photos → appears in "Today so far".
- [ ] Long-press FAB → Quick Add (after creating a preset in Settings) → Undo removes it.
- [ ] Calendar: month dots match logged categories; tap day → sheet; Week/3-Day/Day chips at correct household times; swipe shifts each view by its width.
- [ ] Log: filters, search, infinite scroll, sticky Today header.
- [ ] Detail: edit pre-filled, photo lightbox, delete w/ confirm.
- [ ] Settings: profile + language (EN↔JA full-app switch), pets (avatar upload, archive), presets reorder, export downloads, typed-email delete-account gate.
- [ ] Desktop ≥md: sidebar replaces tab bar, header Add button replaces the FAB, sheets render as centered modals.
- [ ] Health tab shows the warm coming-soon state; Home shows the care slot card.

- [ ] **Step 3: Append a Frontend section to `README.md`**

Add after the "API" section:

```markdown
## Frontend

Mobile-first React SPA (`app/`): bottom tab bar (Home / Calendar / Log / Health)
with a center paw FAB; desktop gets a sidebar. All views are scoped to the pet
selected in the header switcher. Warm design system in `app/src/index.css`
(Tailwind 4 tokens) + `app/src/components/`; typed EN/JA catalogs in
`app/src/i18n/` (missing keys fail `typecheck`). Date/grid math in
`app/src/lib/dates.ts` and timeline lanes in `app/src/lib/timeline.ts` are
unit-tested (`npm run test -w app`). Health charts and care schedules land in
Plan 4; PWA polish in Plan 5.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "chore: wire-check frontend core and document features"
```

---

## Done criteria for Plan 3

- Root `npm run typecheck` and `npm run test` green (worker suite + app unit tests for calendar grid math and timeline lanes).
- Every spec §3 screen in scope exists and is wired: shell (tabs/FAB/sidebar/pet switcher/settings entry), Home (today-so-far + Quick Add + Plan-4 slots), Calendar (Month/Week/3-Day/Day with swipe), Log (infinite + filters + search), Add flow (11 config-driven category forms, photos, edit mode), activity detail, onboarding, pet management, full Settings, warm Login.
- Every UI string flows through the typed catalog in both EN and JA; switching the language setting re-renders the whole app.
- The visual language is cohesive and distinctive: cream/clay palette, Fredoka/Nunito, blob avatars, per-category accent identity, illustrated empty states, springy motion that collapses under `prefers-reduced-motion`.
- The worker diff for the whole plan is exactly the Task-4 OAuth error redirect (+ its test); `shared/` gained only `UpdateMeResponse`.

## Spec deviations encoded in this plan (intentional)

1. **Health tab is a styled placeholder** — charts, period selector, and the care-schedule list are Plan 4 (per the roadmap). Home ships real, styled slot components (`data-slot="anomaly-banners"`, `data-slot="care-items"`) for Plan 4 to fill.
2. **Sharing UI absent** — post-v1 per spec §1; roles still gate the UI (viewers see no edit/delete/add controls on pets they can't write to).
3. **OAuth error redirect** — spec §5 implies JSON errors for `/api/auth/*`; user-denied consent now redirects to `/?auth_error=…` (deferred Plan-1 review item; one sanctioned worker change).
4. **Weeks start Monday** in the month grid and week view (spec doesn't specify; JA convention chosen and unit-tested).
5. **Query ranges use device-local day boundaries** while display/bucketing uses stored household offsets — exact for the summary endpoint, approximate only for households logging across timezones (accepted; documented in `dates.ts`).
6. **Photo lightbox is single-image** (no swipe-between-photos carousel) — spec §3 asks for a gallery + view, not a carousel.
7. **Day view ranges >200 activities per fetch are truncated** (`limit=200`, the API max) — beyond plausible daily volume for a household journal.

## Next plans

4. **Care & Analyzer** — schedules CRUD + complete + care-status, insights endpoint + anomaly rules, Health tab charts, Home care/anomaly slots go live.
5. **PWA & Polish** — manifest + service worker caching, iOS install hint, offline read indicator, final polish pass.
