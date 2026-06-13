# Calendar UI Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the Calendar tab — 3-day view with today-on-right + infinite day-by-day horizontal scroll, a distinct Today button, optional weekend coloring, a configurable timeline start hour, and a household-wide configurable timezone.

**Architecture:** A new `localStorage`-backed preferences module (`calendarPrefs.ts`) holds `{ weekendColor, startHour, timeZone }`, exposed both as plain accessors (for module-level API code) and a React hook (for UI). `dates.ts` stays dependency-free and gains a DST-correct `tzOffsetMinFor`, `isWeekend`, a reordered 3-day `viewDays`, and optional household-offset args on the range/today helpers. `calendarPrefs.ts` imports `tzOffsetMinFor` and exports `householdTzOffsetMin`, which replaces `deviceTzOffsetMin()` everywhere "today/now" is derived (one-way dependency: `calendarPrefs` → `dates`, never the reverse). Shared timeline rendering pieces are extracted to `timelineShared.tsx`; the 3-day view becomes a new `ThreeDayTimeline.tsx` 2D-scroll container with an internally-managed, edge-extending day window.

**Tech Stack:** React 19, react-router 7, TanStack Query 5, Tailwind v4, Vitest 3 (node env), native `Date`/`Intl`.

**Reference spec:** `docs/superpowers/specs/2026-06-13-calendar-ui-update-design.md`

---

## File Structure

- `app/src/lib/dates.ts` — **modify**: add `tzOffsetMinFor`, `isWeekend`; reorder 3-day `viewDays`; add optional offset args to `todayKey`/`dayStartMs`/`dayEndMs`/`rangeMs`. (No import of `calendarPrefs`.)
- `app/src/lib/calendarPrefs.ts` — **create**: prefs accessors + `useCalendarPrefs` hook + `householdTimeZone` + `householdTzOffsetMin` (imports `tzOffsetMinFor` from `dates`).
- `app/test/dates.test.ts` — **create**: unit tests for the new `dates.ts` logic.
- `app/test/calendarPrefs.test.ts` — **create**: unit tests for the prefs accessors.
- `app/src/features/calendar/timelineShared.tsx` — **create**: `HOUR_PX`/`CHIP_PX`/`DAY_HEIGHT`, `Chip`, `HourAxis`, `DayColumn`, `useHourLabel`, `usePlacedByDay`.
- `app/src/features/calendar/Timeline.tsx` — **modify**: week/day only; consume shared pieces; `startHour`/`weekendColor`/`today` props.
- `app/src/features/calendar/ThreeDayTimeline.tsx` — **create**: infinite horizontal 3-day scroller.
- `app/src/features/calendar/MonthGrid.tsx` — **modify**: household `today`, weekend tint.
- `app/src/routes/CalendarTab.tsx` — **modify**: Today button, household offset, prefs wiring, view dispatch.
- `app/src/routes/settings/SettingsHome.tsx` — **modify**: Calendar settings section.
- `app/src/i18n/messages.ts` / `en.ts` / `ja.ts` — **modify**: new calendar/settings strings.
- Household-tz rollout (mechanical `deviceTzOffsetMin()` → `householdTzOffsetMin()`): `app/src/features/add/ActivityForm.tsx`, `app/src/features/quickadd/QuickAddGrid.tsx`, `app/src/features/health/useCompleteWithUndo.ts`, `app/src/features/health/CareScheduleList.tsx`, `app/src/api/schedules.ts`, `app/src/api/insights.ts`, `app/src/api/advisor.ts`, `app/src/routes/Advisor.tsx`, `app/src/routes/settings/AuditHistory.tsx`, `app/src/features/pwa/NotificationsCard.tsx`.

---

## Task 1: Date helpers — timezone, weekend, 3-day order

**Files:**
- Modify: `app/src/lib/dates.ts`
- Test: `app/test/dates.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `app/test/dates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  dayEndMs,
  dayStartMs,
  isWeekend,
  tzOffsetMinFor,
  viewDays,
} from "../src/lib/dates";

describe("viewDays 3-day order", () => {
  it("puts the anchor last (today on the right)", () => {
    expect(viewDays("3day", "2026-06-13")).toEqual([
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
    ]);
  });
});

describe("isWeekend", () => {
  it("is true for Saturday and Sunday", () => {
    expect(isWeekend("2026-06-13")).toBe(true); // Sat
    expect(isWeekend("2026-06-14")).toBe(true); // Sun
  });
  it("is false on weekdays", () => {
    expect(isWeekend("2026-06-12")).toBe(false); // Fri
    expect(isWeekend("2026-06-15")).toBe(false); // Mon
  });
});

describe("tzOffsetMinFor", () => {
  it("returns 0 for UTC", () => {
    expect(tzOffsetMinFor("UTC", Date.UTC(2026, 5, 13))).toBe(0);
  });
  it("returns +540 for Asia/Tokyo (no DST)", () => {
    expect(tzOffsetMinFor("Asia/Tokyo", Date.UTC(2026, 0, 1))).toBe(540);
    expect(tzOffsetMinFor("Asia/Tokyo", Date.UTC(2026, 6, 1))).toBe(540);
  });
  it("tracks DST for America/New_York", () => {
    // 2026-01-01 = EST (-300), 2026-07-01 = EDT (-240)
    expect(tzOffsetMinFor("America/New_York", Date.UTC(2026, 0, 1, 12))).toBe(-300);
    expect(tzOffsetMinFor("America/New_York", Date.UTC(2026, 6, 1, 12))).toBe(-240);
  });
});

describe("day range with explicit household offset", () => {
  it("brackets a UTC+540 day in epoch ms", () => {
    // Household midnight 2026-06-13 in JST = 2026-06-12T15:00:00Z
    const start = Date.UTC(2026, 5, 12, 15, 0, 0);
    expect(dayStartMs("2026-06-13", 540)).toBe(start);
    expect(dayEndMs("2026-06-13", 540)).toBe(start + 86_400_000 - 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w app -- dates`
Expected: FAIL — `tzOffsetMinFor`/`isWeekend` not exported, and `viewDays("3day")` returns the old `[anchor,+1,+2]` order.

- [ ] **Step 3: Implement in `dates.ts`**

Add the offset helper near `deviceTzOffsetMin` (after line 27):

```ts
/** Minutes east of UTC for an IANA zone at a given instant (DST-correct). */
export function tzOffsetMinFor(timeZone: string, atMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(new Date(atMs)).map((x) => [x.type, x.value]),
  );
  // The wall-clock the zone shows for `atMs`, read back as if it were UTC.
  const asUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour === "24" ? "0" : p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((asUTC - atMs) / MIN_MS);
}
```

`householdTzOffsetMin` is **not** added here — it lives in `calendarPrefs.ts` (Task 2) so `dates.ts` stays dependency-free. `dates.ts` adds no imports in this task.

Add `isWeekend` near `mondayIndex` (after line 99):

```ts
/** True when a day-key falls on Saturday or Sunday. */
export function isWeekend(key: DayKey): boolean {
  const { year, month, day } = dayKeyToParts(key);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dow === 0 || dow === 6;
}
```

Reorder 3-day in `viewDays` (line 128):

```ts
  if (view === "3day") return [addDays(anchor, -2), addDays(anchor, -1), anchor];
```

Add optional offset args. Replace `todayKey` (lines 42-44):

```ts
/** Today's day-key. Pass a household offset to bucket in a chosen zone. */
export function todayKey(
  now: number = Date.now(),
  tzOffsetMin: number = deviceTzOffsetMin(),
): DayKey {
  return dayKeyOf(now, tzOffsetMin);
}
```

Replace `dayStartMs`/`dayEndMs` (lines 76-86) to accept an optional household offset:

```ts
/** Start of a day in epoch ms. With a household offset, brackets that zone's day. */
export function dayStartMs(key: DayKey, tzOffsetMin?: number): number {
  if (tzOffsetMin !== undefined) {
    const { year, month, day } = dayKeyToParts(key);
    return Date.UTC(year, month - 1, day) - tzOffsetMin * MIN_MS;
  }
  const { year, month, day } = dayKeyToParts(key);
  return new Date(year, month - 1, day).getTime();
}

/** Inclusive end of a day (the API's `to` is `lte`). */
export function dayEndMs(key: DayKey, tzOffsetMin?: number): number {
  if (tzOffsetMin !== undefined) {
    return dayStartMs(key, tzOffsetMin) + 86_400_000 - 1;
  }
  const { year, month, day } = dayKeyToParts(key);
  return new Date(year, month - 1, day + 1).getTime() - 1;
}
```

Thread the offset through `rangeMs` (lines 88-93):

```ts
/** Inclusive epoch-ms range covering a consecutive day-key span. */
export function rangeMs(
  days: DayKey[],
  tzOffsetMin?: number,
): { from: number; to: number } {
  const first = days[0] ?? todayKey();
  const last = days[days.length - 1] ?? first;
  return { from: dayStartMs(first, tzOffsetMin), to: dayEndMs(last, tzOffsetMin) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w app -- dates`
Expected: PASS (all cases). `dates.ts` has no new imports, so this suite is green on its own.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/dates.ts app/test/dates.test.ts
git commit -m "feat: tz-aware date helpers, weekend check, 3-day order"
```

---

## Task 2: Preferences module

**Files:**
- Create: `app/src/lib/calendarPrefs.ts`
- Test: `app/test/calendarPrefs.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `app/test/calendarPrefs.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  readCalendarPrefs,
  writeCalendarPrefs,
  householdTimeZone,
} from "../src/lib/calendarPrefs";

// Minimal in-memory localStorage for the node test env.
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

describe("calendarPrefs", () => {
  it("returns defaults when nothing is stored", () => {
    const p = readCalendarPrefs();
    expect(p.weekendColor).toBe(false);
    expect(p.startHour).toBe(7);
    expect(typeof p.timeZone).toBe("string");
    expect(p.timeZone.length).toBeGreaterThan(0);
  });

  it("round-trips a partial write", () => {
    writeCalendarPrefs({ weekendColor: true, startHour: 9 });
    const p = readCalendarPrefs();
    expect(p.weekendColor).toBe(true);
    expect(p.startHour).toBe(9);
  });

  it("clamps an out-of-range startHour to the default", () => {
    writeCalendarPrefs({ startHour: 99 });
    expect(readCalendarPrefs().startHour).toBe(7);
  });

  it("householdTimeZone reflects a stored zone", () => {
    writeCalendarPrefs({ timeZone: "Asia/Tokyo" });
    expect(householdTimeZone()).toBe("Asia/Tokyo");
  });

  it("survives corrupt JSON", () => {
    globalThis.localStorage.setItem("pawary.calendarPrefs", "{not json");
    expect(readCalendarPrefs().startHour).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w app -- calendarPrefs`
Expected: FAIL — module `calendarPrefs` does not exist.

- [ ] **Step 3: Implement `app/src/lib/calendarPrefs.ts`**

```ts
import { useCallback, useEffect, useState } from "react";
import { tzOffsetMinFor } from "./dates";

export type CalendarPrefs = {
  /** Tint Saturday/Sunday in calendar views. */
  weekendColor: boolean;
  /** Hour (0..23) the timeline scrolls to on open. */
  startHour: number;
  /** IANA timezone name for household day-bucketing and new-activity stamping. */
  timeZone: string;
};

const STORAGE_KEY = "pawary.calendarPrefs";

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function defaults(): CalendarPrefs {
  return { weekendColor: false, startHour: 7, timeZone: deviceTimeZone() };
}

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** Read prefs from localStorage, falling back to per-field defaults. */
export function readCalendarPrefs(): CalendarPrefs {
  const base = defaults();
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as Partial<CalendarPrefs>;
    return {
      weekendColor:
        typeof parsed.weekendColor === "boolean"
          ? parsed.weekendColor
          : base.weekendColor,
      startHour:
        typeof parsed.startHour === "number" &&
        Number.isInteger(parsed.startHour) &&
        parsed.startHour >= 0 &&
        parsed.startHour <= 23
          ? parsed.startHour
          : base.startHour,
      timeZone:
        typeof parsed.timeZone === "string" && parsed.timeZone.length > 0
          ? parsed.timeZone
          : base.timeZone,
    };
  } catch {
    return base;
  }
}

/** Merge a partial update into stored prefs. Best-effort (ignores write errors). */
export function writeCalendarPrefs(patch: Partial<CalendarPrefs>): void {
  const next = { ...readCalendarPrefs(), ...patch };
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(next));
    // Notify same-tab listeners (the `storage` event only fires cross-tab).
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("pawary:calendarPrefs"));
    }
  } catch {
    /* private mode / quota — ignore */
  }
}

/** The chosen household timezone (IANA), defaulting to the device zone. */
export function householdTimeZone(): string {
  return readCalendarPrefs().timeZone;
}

/** Offset (min east of UTC) for the household zone at an instant; default = device. */
export function householdTzOffsetMin(atMs: number = Date.now()): number {
  return tzOffsetMinFor(householdTimeZone(), atMs);
}

/** React hook: reactive prefs + a setter that re-renders on change. */
export function useCalendarPrefs(): {
  prefs: CalendarPrefs;
  setPref: <K extends keyof CalendarPrefs>(key: K, value: CalendarPrefs[K]) => void;
} {
  const [prefs, setPrefs] = useState<CalendarPrefs>(readCalendarPrefs);

  useEffect(() => {
    const sync = () => setPrefs(readCalendarPrefs());
    window.addEventListener("storage", sync);
    window.addEventListener("pawary:calendarPrefs", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("pawary:calendarPrefs", sync);
    };
  }, []);

  const setPref = useCallback(
    <K extends keyof CalendarPrefs>(key: K, value: CalendarPrefs[K]) => {
      writeCalendarPrefs({ [key]: value } as Partial<CalendarPrefs>);
      setPrefs(readCalendarPrefs());
    },
    [],
  );

  return { prefs, setPref };
}
```

- [ ] **Step 4: Run both test suites**

Run: `npm run test -w app`
Expected: PASS — `dates` (Task 1) and `calendarPrefs` suites green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w app`
Expected: no errors (confirms `calendarPrefs.ts` → `dates.ts` one-way import resolves; `dates.ts` does not import `calendarPrefs`).

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/calendarPrefs.ts app/test/calendarPrefs.test.ts
git commit -m "feat: localStorage-backed calendar preferences"
```

---

## Task 3: Household-wide timezone rollout

Mechanically replace `deviceTzOffsetMin()` with `householdTzOffsetMin()` at every "household now/today" site. Behavior is unchanged until the user picks a non-device zone (the default resolves to the device zone). No tests (pure substitution); verified by typecheck + build.

**Files:** the ten files listed in File Structure.

- [ ] **Step 1: Replace each call site**

`householdTzOffsetMin` now lives in `calendarPrefs.ts`, **not** `dates.ts`. So in each file: (a) remove `deviceTzOffsetMin` from the existing `dates` import (keep the other names on that line), and (b) add a new import of `householdTzOffsetMin` from `calendarPrefs` at the correct relative path, then (c) swap the call. Relative paths: files under `features/**` and `routes/settings/**` use `../../lib/calendarPrefs`; files under `api/**` and `routes/*.tsx` use `../lib/calendarPrefs`.

`app/src/features/add/ActivityForm.tsx` — import `../../lib/calendarPrefs`; lines 119 & 127 `tzOffsetMin: deviceTzOffsetMin(),` → `tzOffsetMin: householdTzOffsetMin(occurredAtMs),` (the local `occurredAtMs` epoch-ms is in scope at both call sites — pass it so the stamped offset is DST-correct for the activity's instant).

`app/src/features/quickadd/QuickAddGrid.tsx` — import `../../lib/calendarPrefs`; line 58 `tzOffsetMin: deviceTzOffsetMin(),` → `tzOffsetMin: householdTzOffsetMin(),`.

`app/src/features/health/useCompleteWithUndo.ts` — import `../../lib/calendarPrefs`; line 28 `deviceTzOffsetMin()` → `householdTzOffsetMin()`.

`app/src/features/health/CareScheduleList.tsx` — import `../../lib/calendarPrefs`; line 40 `const tz = deviceTzOffsetMin();` → `const tz = householdTzOffsetMin();`.

`app/src/api/schedules.ts` — import `../lib/calendarPrefs`; line 25 `?tz=${deviceTzOffsetMin()}` → `?tz=${householdTzOffsetMin()}`.

`app/src/api/insights.ts` — import `../lib/calendarPrefs`; lines 12 & 23 `${deviceTzOffsetMin()}` → `${householdTzOffsetMin()}`.

`app/src/api/advisor.ts` — import `../lib/calendarPrefs`; line 109 `tz: deviceTzOffsetMin(),` → `tz: householdTzOffsetMin(),`.

`app/src/routes/Advisor.tsx` — import `../lib/calendarPrefs`; line 332 `dayKeyOf(conv.updatedAt, deviceTzOffsetMin())` → `dayKeyOf(conv.updatedAt, householdTzOffsetMin(conv.updatedAt))` (remove `deviceTzOffsetMin` from the `dates` import on line 22, keep `relativeDayKind, dayKeyOf, todayKey`).

`app/src/routes/settings/AuditHistory.tsx` — import `../../lib/calendarPrefs`; line 21 `dayKeyOf(ms, deviceTzOffsetMin())` → `dayKeyOf(ms, householdTzOffsetMin(ms))`.

`app/src/features/pwa/NotificationsCard.tsx` — import `../../lib/calendarPrefs`; line 64 `enablePush(deviceTzOffsetMin())` → `enablePush(householdTzOffsetMin())`.

> `deviceTzOffsetMin` stays exported in `dates.ts` (it's the default fallback inside `todayKey`). After this task, no app code outside `dates.ts` (definition + `todayKey` default) and `calendarPrefs.ts` (which calls `tzOffsetMinFor`, not `deviceTzOffsetMin`) should reference `deviceTzOffsetMin` — verify with the grep in Step 2.

- [ ] **Step 2: Verify no stray references + typecheck**

Run: `grep -rn "deviceTzOffsetMin" app/src` — expected: only `app/src/lib/dates.ts` (definition + `todayKey` default).
Run: `npm run typecheck -w app`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src
git commit -m "refactor: route timezone offset through household preference"
```

---

## Task 4: Extract shared timeline pieces

Pull the reusable timeline primitives out of `Timeline.tsx` into a shared module so the new 3-day component can reuse them without duplication. No behavior change.

**Files:**
- Create: `app/src/features/calendar/timelineShared.tsx`
- Modify: `app/src/features/calendar/Timeline.tsx`

- [ ] **Step 1: Create `app/src/features/calendar/timelineShared.tsx`**

```tsx
import type { ActivityResponse } from "@pawary/shared";
import { useMemo } from "react";
import { Link } from "react-router";
import { CategoryIcon, categoryTone } from "../../components/CategoryIcon";
import { useLocaleTag, useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { dayKeyOf, formatTime, minutesIntoDay, type DayKey } from "../../lib/dates";
import { placeItems, type Placed } from "../../lib/timeline";

export const HOUR_PX = 44;
export const CHIP_PX = 38;
export const DAY_HEIGHT = 24 * HOUR_PX;

export type TimedItem = { minute: number; activity: ActivityResponse };

export function Chip({
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

/** Locale-aware hour-axis label factory (UTC so device TZ can't shift it). */
export function useHourLabel(): (hour: number) => string {
  const tag = useLocaleTag();
  return useMemo(() => {
    const formatter = new Intl.DateTimeFormat(tag, {
      hour: "numeric",
      timeZone: "UTC",
    });
    return (hour: number) =>
      formatter.format(new Date(Date.UTC(2026, 0, 1, hour)));
  }, [tag]);
}

/** Left hour-axis gutter (24 labels). */
export function HourAxis({
  hourLabel,
  className,
}: {
  hourLabel: (hour: number) => string;
  className?: string;
}) {
  return (
    <div className={cn("relative w-12 shrink-0", className)}>
      {Array.from({ length: 24 }, (_, hour) => (
        <span
          key={hour}
          className="absolute right-1.5 -translate-y-1/2 text-[10px] font-semibold tabular-nums text-ink-faint"
          style={{ top: hour * HOUR_PX }}
        >
          {hour === 0 ? "" : hourLabel(hour)}
        </span>
      ))}
    </div>
  );
}

/** Hour gridlines + positioned chips for one day's worth of placed items. */
export function DayColumnBody({ items }: { items: Placed<TimedItem>[] }) {
  return (
    <>
      {Array.from({ length: 24 }, (_, hour) => (
        <span
          key={hour}
          aria-hidden="true"
          className="absolute inset-x-0 border-t border-cream-100"
          style={{ top: hour * HOUR_PX }}
        />
      ))}
      {items.map((placed) => (
        <Chip
          key={placed.activity.id}
          activity={placed.activity}
          minute={placed.minute}
          lane={placed.lane}
          laneCount={placed.laneCount}
        />
      ))}
    </>
  );
}

/** Group + lane-place activities by household day-key for the given days. */
export function usePlacedByDay(
  activities: ActivityResponse[] | undefined,
  days: DayKey[],
): Map<DayKey, Placed<TimedItem>[]> {
  const daysKey = days.join(",");
  return useMemo(() => {
    const map = new Map<DayKey, Placed<TimedItem>[]>();
    for (const day of days) map.set(day, []);
    const grouped = new Map<DayKey, TimedItem[]>();
    for (const activity of activities ?? []) {
      const key = dayKeyOf(activity.occurredAt, activity.tzOffsetMin);
      if (!map.has(key)) continue;
      const bucket = grouped.get(key) ?? [];
      bucket.push({
        minute: minutesIntoDay(activity.occurredAt, activity.tzOffsetMin),
        activity,
      });
      grouped.set(key, bucket);
    }
    for (const [key, bucket] of grouped) map.set(key, placeItems(bucket));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities, daysKey]);
}
```

- [ ] **Step 2: Rewrite `app/src/features/calendar/Timeline.tsx` to use the shared pieces**

```tsx
import { useEffect, useRef } from "react";
import { useActivitiesRange } from "../../api/activities";
import { Spinner } from "../../components/Spinner";
import { useLocaleTag } from "../../i18n";
import { cn } from "../../lib/cn";
import { formatDayShort, isWeekend, rangeMs, type DayKey } from "../../lib/dates";
import { useSwipe } from "../../lib/useSwipe";
import {
  DAY_HEIGHT,
  DayColumnBody,
  HOUR_PX,
  HourAxis,
  useHourLabel,
  usePlacedByDay,
} from "./timelineShared";

export function Timeline({
  petId,
  days,
  today,
  startHour,
  weekendColor,
  hhOffset,
  onShift,
}: {
  petId: string;
  days: DayKey[];
  today: DayKey;
  startHour: number;
  weekendColor: boolean;
  hhOffset: number;
  onShift: (delta: number) => void;
}) {
  const tag = useLocaleTag();
  const { from, to } = rangeMs(days, hhOffset);
  const activities = useActivitiesRange(petId, from, to);
  const swipe = useSwipe({ onLeft: () => onShift(1), onRight: () => onShift(-1) });
  const scrollRef = useRef<HTMLDivElement>(null);
  const daysKey = days.join(",");
  const hourLabel = useHourLabel();
  const byDay = usePlacedByDay(activities.data, days);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: startHour * HOUR_PX });
  }, [daysKey, startHour]);

  return (
    <div {...swipe} className="overflow-hidden rounded-card bg-paper shadow-card">
      <div className="flex border-b border-cream-200">
        <div className="w-12 shrink-0" />
        {days.map((day) => (
          <div
            key={day}
            className={cn(
              "flex-1 border-l border-cream-100 py-2 text-center text-sm font-semibold",
              day === today ? "text-clay-600" : "text-ink-soft",
              weekendColor && isWeekend(day) && "bg-clay-50",
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
        <div ref={scrollRef} className="relative h-[min(60dvh,560px)] overflow-y-auto">
          <div className="relative flex" style={{ height: DAY_HEIGHT }}>
            <HourAxis hourLabel={hourLabel} />
            {days.map((day) => (
              <div
                key={day}
                className={cn(
                  "relative flex-1 border-l border-cream-100",
                  weekendColor && isWeekend(day) && "bg-clay-50/40",
                )}
              >
                <DayColumnBody items={byDay.get(day) ?? []} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w app`
Expected: errors only in `CalendarTab.tsx` (it still calls `Timeline` with the old prop set). That's expected — Task 6 updates the caller. To keep this commit self-consistent, proceed to Step 4 which also covers the caller in Task 6; **commit Tasks 4–6 together** if the typecheck gate blocks you, or temporarily satisfy the caller. Recommended: continue to Task 5 and Task 6, then run a single typecheck before committing the timeline group.

- [ ] **Step 4: Commit**

```bash
git add app/src/features/calendar/timelineShared.tsx app/src/features/calendar/Timeline.tsx
git commit -m "refactor: extract shared timeline primitives"
```

---

## Task 5: 3-day infinite horizontal timeline

A 2D-scroll container: vertical = hours, horizontal = days with one-day scroll-snap and an internally-managed window that extends at the edges. Today starts on the right.

**Files:**
- Create: `app/src/features/calendar/ThreeDayTimeline.tsx`

- [ ] **Step 1: Create `app/src/features/calendar/ThreeDayTimeline.tsx`**

```tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useActivitiesRange } from "../../api/activities";
import { Spinner } from "../../components/Spinner";
import { useLocaleTag } from "../../i18n";
import { cn } from "../../lib/cn";
import { addDays, formatDayShort, isWeekend, rangeMs, type DayKey } from "../../lib/dates";
import {
  DAY_HEIGHT,
  DayColumnBody,
  HOUR_PX,
  HourAxis,
  useHourLabel,
  usePlacedByDay,
} from "./timelineShared";

const PAST = 21; // days rendered before the anchor
const FUTURE = 7; // days rendered after the anchor
const EXTEND_BY = 14; // days added when nearing an edge
const EDGE_COLS = 4; // trigger extend within this many columns of an edge
const MAX_DAYS = 84; // cap window size; trim the far edge beyond this

/** Imperative controls the parent's arrow buttons / Today button drive. */
export type ThreeDayControls = {
  step: (delta: number) => void;
  toToday: (today: DayKey) => void;
};

function makeWindow(anchor: DayKey): DayKey[] {
  const start = addDays(anchor, -PAST);
  return Array.from({ length: PAST + FUTURE + 1 }, (_, i) => addDays(start, i));
}

export function ThreeDayTimeline({
  petId,
  anchor,
  today,
  startHour,
  weekendColor,
  hhOffset,
  controlsRef,
  onVisibleChange,
}: {
  petId: string;
  anchor: DayKey;
  today: DayKey;
  startHour: number;
  weekendColor: boolean;
  hhOffset: number;
  controlsRef: { current: ThreeDayControls | null };
  onVisibleChange: (leftmost: DayKey) => void;
}) {
  const tag = useLocaleTag();
  const hourLabel = useHourLabel();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [windowDays, setWindowDays] = useState<DayKey[]>(() => makeWindow(anchor));
  const [colWidth, setColWidth] = useState(0);

  const { from, to } = rangeMs(windowDays, hhOffset);
  const activities = useActivitiesRange(petId, from, to);
  const byDay = usePlacedByDay(activities.data, windowDays);

  // Measure a column = 1/3 of the scroll viewport.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setColWidth(el.clientWidth / 3);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scroll the anchor to the rightmost of the 3 visible columns.
  const scrollAnchorRight = useCallback(
    (days: DayKey[], targetAnchor: DayKey, smooth: boolean) => {
      const el = scrollRef.current;
      if (!el || colWidth === 0) return;
      const idx = days.indexOf(targetAnchor);
      if (idx < 0) return;
      el.scrollTo({
        left: (idx - 2) * colWidth,
        top: startHour * HOUR_PX,
        behavior: smooth ? "smooth" : "auto",
      });
    },
    [colWidth, startHour],
  );

  // Initial / external-anchor positioning (mount, colWidth ready, anchor change).
  useEffect(() => {
    const next = makeWindow(anchor);
    setWindowDays(next);
    // Defer until the new window has painted so indexes/scrollWidth are valid.
    requestAnimationFrame(() => scrollAnchorRight(next, anchor, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, colWidth]);

  // Expose imperative controls to the parent.
  useEffect(() => {
    controlsRef.current = {
      step: (delta: number) => {
        if (colWidth === 0) return;
        scrollRef.current?.scrollBy({ left: delta * colWidth, behavior: "smooth" });
      },
      toToday: (t: DayKey) => {
        const next = makeWindow(t);
        setWindowDays(next);
        requestAnimationFrame(() => scrollAnchorRight(next, t, false));
      },
    };
    return () => {
      controlsRef.current = null;
    };
  }, [colWidth, scrollAnchorRight]);

  // Horizontal scroll: report visible day + extend/trim at the edges.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || colWidth === 0) return;
    const leftIdx = Math.round(el.scrollLeft / colWidth);
    const leftmost = windowDays[Math.max(0, Math.min(leftIdx, windowDays.length - 1))];
    if (leftmost) onVisibleChange(leftmost);

    // Near left edge → prepend, preserving scroll position.
    if (leftIdx <= EDGE_COLS) {
      setWindowDays((prev) => {
        const head = prev[0];
        if (!head) return prev;
        const added = Array.from({ length: EXTEND_BY }, (_, i) =>
          addDays(head, -(EXTEND_BY - i)),
        );
        let next = [...added, ...prev];
        let dropped = 0;
        if (next.length > MAX_DAYS) {
          dropped = next.length - MAX_DAYS;
          next = next.slice(0, MAX_DAYS);
        }
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollLeft += (EXTEND_BY - dropped) * colWidth;
          }
        });
        return next;
      });
      return;
    }

    // Near right edge → append, trimming the far-left if needed.
    if (leftIdx >= windowDays.length - 3 - EDGE_COLS) {
      setWindowDays((prev) => {
        const tail = prev[prev.length - 1];
        if (!tail) return prev;
        const added = Array.from({ length: EXTEND_BY }, (_, i) =>
          addDays(tail, i + 1),
        );
        let next = [...prev, ...added];
        if (next.length > MAX_DAYS) {
          const trim = next.length - MAX_DAYS;
          next = next.slice(trim);
          requestAnimationFrame(() => {
            if (scrollRef.current) {
              scrollRef.current.scrollLeft -= trim * colWidth;
            }
          });
        }
        return next;
      });
    }
  }, [colWidth, windowDays, onVisibleChange]);

  return (
    <div className="overflow-hidden rounded-card bg-paper shadow-card">
      {activities.isLoading && windowDays.length === 0 ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="relative max-h-[min(60dvh,560px)] overflow-auto"
          style={{ scrollSnapType: "x mandatory" }}
        >
          {/* sticky header row */}
          <div className="sticky top-0 z-20 flex bg-paper">
            <div className="sticky left-0 z-10 w-12 shrink-0 bg-paper" />
            {windowDays.map((day) => (
              <div
                key={day}
                style={{ width: colWidth || undefined, scrollSnapAlign: "start" }}
                className={cn(
                  "shrink-0 border-l border-cream-100 py-2 text-center text-sm font-semibold",
                  day === today ? "text-clay-600" : "text-ink-soft",
                  weekendColor && isWeekend(day) && "bg-clay-50",
                )}
              >
                {formatDayShort(day, tag)}
              </div>
            ))}
          </div>
          {/* hour grid + day columns */}
          <div className="relative flex" style={{ height: DAY_HEIGHT }}>
            <HourAxis hourLabel={hourLabel} className="sticky left-0 z-10 bg-paper" />
            {windowDays.map((day) => (
              <div
                key={day}
                style={{ width: colWidth || undefined, scrollSnapAlign: "start" }}
                className={cn(
                  "relative shrink-0 border-l border-cream-100",
                  weekendColor && isWeekend(day) && "bg-clay-50/40",
                )}
              >
                <DayColumnBody items={byDay.get(day) ?? []} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck (group with Task 6)**

Run: `npm run typecheck -w app`
Expected: remaining errors only in `CalendarTab.tsx` until Task 6 wires the new components. Proceed to Task 6, then typecheck clean.

- [ ] **Step 3: Commit**

```bash
git add app/src/features/calendar/ThreeDayTimeline.tsx
git commit -m "feat: infinite horizontal 3-day timeline"
```

---

## Task 6: CalendarTab — Today button, prefs wiring, view dispatch

**Files:**
- Modify: `app/src/routes/CalendarTab.tsx`

- [ ] **Step 1: Rewrite `CalendarTab.tsx`**

```tsx
import { useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useDaySummary } from "../api/activities";
import { Button } from "../components/Button";
import { IconButton } from "../components/IconButton";
import { ChevronLeftIcon, ChevronRightIcon } from "../components/icons";
import { DaySheet } from "../features/calendar/DaySheet";
import { MonthGrid } from "../features/calendar/MonthGrid";
import { Timeline } from "../features/calendar/Timeline";
import {
  ThreeDayTimeline,
  type ThreeDayControls,
} from "../features/calendar/ThreeDayTimeline";
import { useLocaleTag, useT } from "../i18n";
import { householdTzOffsetMin, useCalendarPrefs } from "../lib/calendarPrefs";
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
  const { prefs } = useCalendarPrefs();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sheetDay, setSheetDay] = useState<DayKey | null>(null);

  const hhOffset = householdTzOffsetMin();
  const today = todayKey(Date.now(), hhOffset);

  const viewParam = searchParams.get("view");
  const view: CalendarView = VIEWS.includes(viewParam as CalendarView)
    ? (viewParam as CalendarView)
    : "month";
  const dateParam = searchParams.get("date");
  const date: DayKey = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? "")
    ? (dateParam as DayKey)
    : today;

  const setParams = (nextView: CalendarView, nextDate: DayKey) =>
    setSearchParams({ view: nextView, date: nextDate }, { replace: true });

  const monthKey = monthKeyOf(date);
  const summary = useDaySummary(pet.id, monthKey);

  // 3-day view tracks its visible leftmost day locally (for the title) without
  // rewriting the URL on every scroll (which would reset the scroll window).
  const threeDayControls = useRef<ThreeDayControls | null>(null);
  const [threeDayLeft, setThreeDayLeft] = useState<DayKey>(date);

  const shift = (delta: number) => {
    if (view === "month") {
      setParams(view, `${shiftMonth(monthKey, delta)}-01`);
    } else if (view === "3day") {
      threeDayControls.current?.step(delta);
    } else {
      setParams(view, shiftAnchor(view, date, delta));
    }
  };
  const goToday = () => {
    if (view === "3day") {
      threeDayControls.current?.toToday(today);
      setThreeDayLeft(today);
    } else {
      setParams(view, today);
    }
  };
  const swipe = useSwipe({ onLeft: () => shift(1), onRight: () => shift(-1) });

  const threeDayTitle = (() => {
    const last = threeDayLeft;
    const first = viewDays("3day", last)[0] ?? last;
    return `${formatDayShort(first, tag)} – ${formatDayShort(last, tag)}`;
  })();

  const title =
    view === "month"
      ? formatMonthTitle(monthKey, tag)
      : view === "day"
        ? formatDayHeading(date, tag)
        : view === "3day"
          ? threeDayTitle
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
      <div className="flex items-center justify-between gap-2">
        <IconButton label={t.calendar.previous} onClick={() => shift(-1)}>
          <ChevronLeftIcon className="h-5 w-5" />
        </IconButton>
        <span className="min-w-0 flex-1 truncate text-center font-display text-lg text-ink">
          {title}
        </span>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={goToday}>
          {t.common.today}
        </Button>
        <IconButton label={t.calendar.next} onClick={() => shift(1)}>
          <ChevronRightIcon className="h-5 w-5" />
        </IconButton>
      </div>

      {view === "month" ? (
        <div {...swipe}>
          <MonthGrid
            monthKey={monthKey}
            days={summary.data?.days}
            today={today}
            weekendColor={prefs.weekendColor}
            onSelectDay={setSheetDay}
          />
        </div>
      ) : view === "3day" ? (
        <ThreeDayTimeline
          petId={pet.id}
          anchor={date}
          today={today}
          startHour={prefs.startHour}
          weekendColor={prefs.weekendColor}
          hhOffset={hhOffset}
          controlsRef={threeDayControls}
          onVisibleChange={setThreeDayLeft}
        />
      ) : (
        <Timeline
          petId={pet.id}
          days={viewDays(view, date)}
          today={today}
          startHour={prefs.startHour}
          weekendColor={prefs.weekendColor}
          hhOffset={hhOffset}
          onShift={(delta) => setParams(view, shiftAnchor(view, date, delta))}
        />
      )}

      <DaySheet petId={pet.id} day={sheetDay} onClose={() => setSheetDay(null)} />
    </div>
  );
}
```

> The header title is now a non-interactive `<span>` (the old tap-to-today behavior moved to the dedicated Today button). `Button` is imported from `../components/Button` (already used elsewhere in the app, e.g. `SettingsHome.tsx`).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w app`
Expected: no errors (Tasks 4–6 now consistent). If `MonthGrid` errors on the new `today`/`weekendColor` props, that's fixed in Task 7 — do Task 7, then typecheck.

- [ ] **Step 3: Commit**

```bash
git add app/src/routes/CalendarTab.tsx
git commit -m "feat: calendar Today button, prefs wiring, 3-day dispatch"
```

---

## Task 7: MonthGrid weekend tint + household today

**Files:**
- Modify: `app/src/features/calendar/MonthGrid.tsx`

- [ ] **Step 1: Accept `today` + `weekendColor` props and tint weekends**

Change the imports (lines 5-11) to add `isWeekend` and drop `todayKey`:

```tsx
import {
  dayKeyToParts,
  isWeekend,
  monthGrid,
  type DayKey,
  type MonthKey,
} from "../../lib/dates";
```

Change the signature (lines 23-31) to accept the new props:

```tsx
export function MonthGrid({
  monthKey,
  days,
  today,
  weekendColor,
  onSelectDay,
}: {
  monthKey: MonthKey;
  days: DaySummaryResponse["days"] | undefined;
  today: DayKey;
  weekendColor: boolean;
  onSelectDay: (key: DayKey) => void;
}) {
```

Remove the local `const today = todayKey();` line (old line 34).

Add the weekend tint to the day-cell button (the `className` on the `<button>`, old lines 64-67):

```tsx
              className={cn(
                "flex min-h-16 flex-col items-center gap-1 border-b border-r border-cream-100 py-1.5 transition hover:bg-cream-50 active:bg-cream-100",
                !cell.inMonth && "opacity-35",
                weekendColor && isWeekend(cell.key) && "bg-clay-50",
              )}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w app`
Expected: no errors across the app.

- [ ] **Step 3: Build (catches Tailwind/JSX issues)**

Run: `npm run build -w app`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/src/features/calendar/MonthGrid.tsx
git commit -m "feat: weekend tint and household today in month grid"
```

---

## Task 8: Settings — Calendar section + i18n

**Files:**
- Modify: `app/src/i18n/messages.ts`, `app/src/i18n/en.ts`, `app/src/i18n/ja.ts`
- Modify: `app/src/routes/settings/SettingsHome.tsx`

- [ ] **Step 1: Extend the i18n type**

In `app/src/i18n/messages.ts`, extend the `calendar` interface block (currently `views/previous/next/dayEmpty`) by adding a `settings` sub-object:

```ts
  calendar: {
    views: Record<"month" | "week" | "3day" | "day", string>;
    previous: string;
    next: string;
    dayEmpty: string;
    settings: {
      title: string;
      weekendColor: string;
      startHour: string;
      timezone: string;
      timezoneSystem: string;
    };
  };
```

- [ ] **Step 2: Add English strings**

In `app/src/i18n/en.ts`, inside the `calendar` object (after `dayEmpty`):

```ts
    settings: {
      title: "Calendar",
      weekendColor: "Highlight weekends",
      startHour: "Day start hour",
      timezone: "Timezone",
      timezoneSystem: "Match device",
    },
```

- [ ] **Step 3: Add Japanese strings**

In `app/src/i18n/ja.ts`, inside the `calendar` object (after `dayEmpty`):

```ts
    settings: {
      title: "カレンダー",
      weekendColor: "週末を色分け",
      startHour: "1日の開始時刻",
      timezone: "タイムゾーン",
      timezoneSystem: "端末に合わせる",
    },
```

- [ ] **Step 4: Add the Calendar settings card to `SettingsHome.tsx`**

Add imports at the top (with the existing imports):

```tsx
import { useCalendarPrefs } from "../../lib/calendarPrefs";
```

Inside `SettingsHome`, after the existing `const ... = useState(...)` lines (around line 26), add:

```tsx
  const { prefs, setPref } = useCalendarPrefs();
  const timeZones: string[] = (() => {
    const sv = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf;
    const all = sv ? sv("timeZone") : [];
    // Ensure the current value is selectable even on older engines.
    return all.includes(prefs.timeZone) ? all : [prefs.timeZone, ...all];
  })();
```

Add a new `Card` right after the profile `Card` (after its closing `)}` near old line 74), before the "sections" card:

```tsx
      {/* calendar preferences */}
      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-display text-lg text-ink">{t.calendar.settings.title}</h2>
        <label className="flex items-center justify-between gap-3">
          <span className="font-semibold text-ink">
            {t.calendar.settings.weekendColor}
          </span>
          <input
            type="checkbox"
            className="h-5 w-5 accent-clay-500"
            checked={prefs.weekendColor}
            onChange={(e) => setPref("weekendColor", e.target.checked)}
          />
        </label>
        <Field label={t.calendar.settings.startHour}>
          <Select
            value={String(prefs.startHour)}
            onChange={(e) => setPref("startHour", Number(e.target.value))}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.calendar.settings.timezone}>
          <Select
            value={prefs.timeZone}
            onChange={(e) => setPref("timeZone", e.target.value)}
          >
            {timeZones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>
      </Card>
```

(`Field` and `Select` are already imported in `SettingsHome.tsx` line 9.)

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck -w app && npm run build -w app`
Expected: both succeed (a missing `calendar.settings` key in either locale would fail typecheck against `Messages`).

- [ ] **Step 6: Commit**

```bash
git add app/src/i18n/messages.ts app/src/i18n/en.ts app/src/i18n/ja.ts app/src/routes/settings/SettingsHome.tsx
git commit -m "feat: calendar preferences settings section"
```

---

## Task 9: Full verification

- [ ] **Step 1: Run the full app test + typecheck**

Run: `npm run typecheck -w app && npm run test -w app`
Expected: typecheck clean; `dates` and `calendarPrefs` suites PASS.

- [ ] **Step 2: Manual smoke test**

Run: `npm run dev` (from repo root) and in the browser:
- Calendar → **3 days**: today is the rightmost of the 3 columns on open; horizontal swipe/scroll moves **one day at a time** (no 3-day jump); scrolling far in either direction keeps working (window extends, no snap-back); the title updates to the visible range.
- **Today** button returns the 3-day view to today-on-right, and jumps month/week/day views to today.
- Vertical scroll opens at the configured start hour (default 7am). Change **Day start hour** in Settings → reopen a timeline view → it opens at the new hour.
- Settings → toggle **Highlight weekends** → Sat/Sun get a tint in month + timeline views; toggle off → tint gone.
- Settings → change **Timezone** to a different zone → calendar day-bucketing/headers shift accordingly; add a new activity → its stored `tzOffsetMin` matches the chosen zone (existing activities unchanged).

- [ ] **Step 3: Final commit (if any manual-fix tweaks were needed)**

```bash
git add -A
git commit -m "fix: calendar UI manual-test adjustments"
```

(Skip if nothing changed.)

---

## Notes for the implementer

- **localStorage only** — no worker/shared/DB changes. Don't touch `shared/src/index.ts` or `worker/`.
- **Going-forward timezone** — never rewrite existing activities' `tzOffsetMin`.
- The infinite-scroll window (`ThreeDayTimeline`) is the riskiest piece; if edge-extension feels janky, the tunable constants are `PAST/FUTURE/EXTEND_BY/EDGE_COLS/MAX_DAYS` at the top of the file.
- `clay-50` (`#fdf1e8`) is defined in `app/src/index.css` — the weekend tint uses it directly, no fallback needed.
