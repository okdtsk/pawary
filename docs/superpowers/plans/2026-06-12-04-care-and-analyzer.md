# Pawlog Plan 4: Care & Analyzer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The complete proactive-care layer of v1: care schedules CRUD with simple recurrence, the atomic complete-a-care-item flow (insert activity + advance `next_due_at`), the overdue / today / upcoming-7d care-status endpoint, the Health Analyzer insights endpoint (4 chart datasets bucketed in household time) with 4 fixed anomaly heuristics, the Health tab (period selector + four hand-rolled SVG charts + schedule management), and the Home care card + anomaly banners that replace Plan 3's placeholder slots — all TDD'd on the worker side and fully i18n'd (EN + JA).

**Architecture:** Everything builds on the merged Plans 1–3. Worker: two new route files (`schedules.ts`, `insights.ts`) registered with absolute paths and mounted via `app.route("/", ...)`, plus three pure domain modules (`recurrence.ts`, `insights.ts`, `anomalies.ts`) that are unit-TDD'd in isolation and called by thin handlers. The `care_schedules` and `pet_targets` tables already exist in the frozen schema — **this plan adds NO migrations**. Frontend: typed hooks per resource (`api/schedules.ts`, `api/insights.ts`), four pure-SVG chart components in `app/src/features/health/` (no chart library), and the Health tab / Home slots assembled from them. ISO-week math lives in `shared/` so the worker's bucketing and the app's axis labels share one implementation.

**Tech Stack:** No new dependencies. TypeScript, Hono 4, Drizzle ORM 0.44+ (incl. D1 `db.batch`), D1, Zod, Vitest + @cloudflare/vitest-pool-workers; React 19, TanStack Query 5, Tailwind CSS 4, hand-rolled SVG charts.

**Spec:** `docs/superpowers/specs/2026-06-11-pawlog-design.md` (read sections 1, 3, 4 "Proactive care", 5, and 7 before starting).

**Roadmap context:** This is plan 4 of 5. Plans 1–3 are merged on `main`: the full API (auth, pets, activities, photos, presets, export) and the full frontend core (shell, add flow, calendar, log, settings) are complete and green. The D1 schema is complete and FROZEN: no migration files may be added or modified. The ONLY sanctioned touch to `worker/src/db/schema.ts` is one **type-only** export (`CareSchedule`, Task 2) — zero SQL changes. If you believe a schema change is needed, STOP and report instead of improvising. Plan 5 (PWA & Polish) follows.

**Conventions used throughout (carried from Plans 1–3):**
- IDs are ULIDs via `newId()`; timestamps are epoch milliseconds (`Date.now()`).
- API responses: success `{ data }`, failure `{ error: { code, message } }` via `err()`.
- Validation: Zod schemas in `shared/src/index.ts`, all `.strict()`; first issue message surfaced with code `validation`.
- Middleware order on mutating pet routes: `requireSession` → `requireCsrf` → `requirePetRole(...)`. GET = viewer, writes = editor. Non-member/missing pet = 404 `not_found` (anti-probing); member with insufficient role = 403 `forbidden`.
- Every mutating pet-scoped handler calls `writeAudit()`; tests assert the audit rows.
- Household time = `occurred_at + tz_offset_min * 60000` read as UTC — the exact expression `/summary` uses. Day keys are `"YYYY-MM-DD"`.
- Worker tasks are TDD: write the failing test, see it fail, implement, see it pass. Each worker task ends with `npm run test -w worker && npm run typecheck -w worker` green.
- Frontend tasks verify with `npm run typecheck -w app && npm run build -w app`; tasks adding pure math also run `npm run test -w app`. Every UI string extends the typed `Messages` interface AND both catalogs (`en.ts`, `ja.ts`) **in the same task**.
- Each task ends with a commit using the exact message given. Version numbers are minimums; never pin downward.

**Locked decisions for this plan (do not relitigate):**

| Decision | Choice | Why / spec note |
|---|---|---|
| Charts | **Hand-rolled SVG components** — the spec §2 mention of Recharts is overridden (recorded deviation) | Bundle cost + full design control on the warm palette; four small charts don't justify a charting dependency. |
| Anomaly payloads | **Structured** `{ rule, severity, params }`, never prose | The frontend i18n catalog renders the localized advisory copy (spec §7's "consider asking your vet" tone lives in the catalog, both languages). |
| Anomaly endpoints | `GET /insights` includes anomalies (Health tab) **and** a separate cheap `GET /api/pets/:petId/anomalies?tz=` runs only the 4 rules on minimal queries (Home banner) | Home must not pay for four chart datasets. Rule functions + input loader are shared between both handlers. |
| Anomaly severities | `quiet_day` = `info`; `weight_drift`, `toilet_trouble`, `symptom_streak` = `warning` | Quiet day is usually "nobody logged", not "pet is unwell". |
| Anomaly thresholds | Weight: \|Δ\| ≥ 5%, latest-7d mean vs the mean of a 14-day window centered 30 days ago (≥1 weighing in each window ⇒ ≥2 total). Toilet: diarrhea/bloody ≥2 in rolling 72 h. Quiet: no food AND no water today by 18:00 household. Symptom: same name ≥3 consecutive household days, run ending today or yesterday | Spec §7 table, made precise enough to unit-test. |
| Anomaly dismissal | Client-side `localStorage`, key = pet + rule (+ symptom name for `symptom_streak`) + household day | Spec §7 "dismissible client-side; reappear only on new triggering data" — a new day re-evaluates. |
| Recurrence advance | Anchored: new `nextDueAt` = old `nextDueAt` + interval, **never** completion-time-based; `once` deactivates; next > `endAt` deactivates (`endAt` itself inclusive). `advanceSchedule(schedule)` takes no completion timestamp | Keeps cadence fixed (8:00 pill stays 8:00); a very late completion leaves the next occurrence already overdue — deliberate, missed cadence stays visible. |
| Schedule immutability | `type` and `categoryLink` cannot be PATCHed (strict schema rejects them); `detailsTemplate` is re-validated against the STORED `categoryLink` | Same rationale as the immutable activity `category` (Plan 2). |
| `categoryLink` choice | Free choice of all 11 categories (Select), with a sensible per-type default pre-selected | Spec doesn't restrict it; "custom" type needs the full range anyway. |
| Complete semantics | Inserts an activity from `detailsTemplate` (category = `categoryLink`); `occurredAt` defaults to now, request-provided value allowed within **[now − 7 d, now + 1 h]**; `tzOffsetMin` from the request (default 0); optional memo; `scheduleId` injected into details **only** for the `medication` category (the shared medication schema has the optional field); returns `{ activity, schedule }` 201 | Spec §4 "atomically inserts an activity from details_template and advances next_due_at". |
| Complete atomicity | Activity insert + schedule update in **one `db.batch([...])`** (D1 batches are transactional); audit rows (activity create + schedule update) follow | Both-or-neither for the data rows; audit-after matches existing handlers. |
| Completing an inactive schedule | **409 `schedule_inactive`** | Not a 404 (it exists) and not a validation error (the body is fine). |
| Undo a completion (frontend) | Exactly: `DELETE` the created activity (soft delete) + `PATCH` the schedule back to its pre-complete `{ nextDueAt, active }` | No server undo endpoint; the client already holds both before-values. Encoded once in `useCompleteWithUndo`. |
| Schedule delete | **Hard delete** + audit row | Schedule history lives in the activities it logged and in `audit_log`; soft-deleting schedules would complicate the active/due index for nothing. |
| `tz` query param | `care-status`, `insights`, and `anomalies` take `tz` = the client's device offset in minutes (positive east of UTC, like `tzOffsetMin`), default `0`, validated −840..840 | "Today"/18:00 anchoring needs the household clock; the client passes `deviceTzOffsetMin()`. |
| care-status buckets | `overdue`: `nextDueAt < now`; `today`: `now ≤ nextDueAt <` next household midnight; `upcoming`: the 7 household days after today. Active schedules only, one select on `idx_schedules_pet_active_due`, bucketed in JS | Spec §7 "Care status". Buckets are disjoint. |
| Insights bucketing | Bucket = household **day** for 4w (28) / 3m (91), **ISO week** (`"YYYY-Www"`) for 1y (365 days). Per-row `tz_offset_min` buckets the data (same SQL expression as `/summary`); the request `tz` anchors "today" / the window. ISO-week fold happens in JS (no `%G/%V` dependence on the D1 SQLite version) | Spec §7 "bucket = day for 4w/3m, week for 1y … in household time". |
| ISO week math | One implementation in `shared/src/index.ts` (`isoWeekKey`, `isoWeekStartDay`), used by worker bucketing and app axis labels, unit-tested on both sides | Two implementations would drift. |
| Intake "food" | Sum of `details.amount` **only where `details.unit = 'g'`** (ml/pieces excluded from a grams chart); the UI shows a hint. Absent bucket key = "not logged" (hollow marker), distinct from zero | Mixed units can't be summed honestly. Spec §7: "not logged" visually distinct. |
| Intake week buckets | Values are bucket sums; the dashed target line is `daily target × 7` for week buckets | Only honest way to compare a weekly sum against a daily target. |
| Toilet severity order | `normal < soft < hard < diarrhea < bloody` (exported as `TOILET_SEVERITY`, index = rank) | Worst-condition cell coloring + the anomaly rule share it. |
| Toilet matrix rows | Follow the period bucket: day rows for 4w/3m, ISO-week rows for 1y (cells aggregate the week: summed count, worst condition) | 365 day-rows would be unusable; spec's "day-rows" reading kept for the day-bucketed periods (recorded deviation for 1y). |
| Timeline axis space | Span/marker times are **household-naive epoch ms** (`occurred_at + tz_offset_min*60000`), same space as the response's `windowStart`/`windowEnd` | One linear x-scale on the client, no per-point tz handling. |
| Query keys / caching | `["schedules", petId]`, `["care-status", petId]`, `["insights", petId, period]`, `["anomalies", petId]`. Insights staleTime 5 min; care-status & anomalies 60 s. Complete invalidates schedules + care-status + activitiesRoot + summaryRoot + insights + anomalies; activity mutations additionally invalidate insights + anomalies | New activity data must resurface anomalies (spec §7). |
| Rate limiting | **None added** | All new endpoints are reads or editor-gated writes; Plan 2's auth/upload limits stand. |
| Schema file touch | One type-only line: `export type CareSchedule = typeof careSchedules.$inferSelect;` | Not a schema change — no SQL, no migration. |

---

### Task 1: Shared schemas & types (schedules, care status, insights, anomalies, ISO weeks)

**Files:**
- Modify: `shared/src/index.ts`

Pure additions — nothing existing in the file changes. The Zod schemas are exercised by integration tests from Task 3 onward; `isoWeekKey`/`isoWeekStartDay` get unit tests in Task 6 (worker) and Task 9 (app). Verification here is typecheck.

- [ ] **Step 1: Append to `shared/src/index.ts`**

```ts
// ---------------------------------------------------------------------------
// Plan 4: care schedules, care status, insights, anomalies
// ---------------------------------------------------------------------------

export const SCHEDULE_TYPES = [
  "medication",
  "vaccination",
  "vet_visit",
  "deworming",
  "grooming",
  "custom",
] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export const RECURRENCE_UNITS = ["once", "hour", "day", "week", "month"] as const;
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];

function refineScheduleTemplate(
  categoryLink: Category,
  detailsTemplate: unknown,
  ctx: z.RefinementCtx,
): void {
  const parsed = activityDetailsSchemas[categoryLink].safeParse(detailsTemplate ?? {});
  if (!parsed.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["detailsTemplate"],
      message: parsed.error.issues[0]?.message ?? "Invalid details template",
    });
  }
}

export const createScheduleSchema = z
  .object({
    type: z.enum(SCHEDULE_TYPES),
    name: z.string().trim().min(1).max(100),
    categoryLink: z.enum(CATEGORIES),
    detailsTemplate: z.unknown().optional(), // omitted ⇒ {}
    recurrenceUnit: z.enum(RECURRENCE_UNITS),
    recurrenceN: z.number().int().positive().max(1000).optional(),
    nextDueAt: z.number().int().positive(),
    endAt: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    refineScheduleTemplate(val.categoryLink, val.detailsTemplate, ctx);
    if (val.recurrenceUnit !== "once" && val.recurrenceN === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recurrenceN"],
        message: "recurrenceN is required unless recurrence is once",
      });
    }
    if (val.endAt !== undefined && val.endAt <= val.nextDueAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endAt"],
        message: "endAt must be after nextDueAt",
      });
    }
  });
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

// `type` and `categoryLink` are immutable after creation (the template is
// typed by categoryLink, like activity details). `detailsTemplate`, when
// present, is re-validated in the handler against the STORED categoryLink;
// the recurrenceN/endAt cross-field rules are re-checked on the merged record.
export const updateScheduleSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    detailsTemplate: z.unknown().optional(),
    recurrenceUnit: z.enum(RECURRENCE_UNITS).optional(),
    recurrenceN: z.number().int().positive().max(1000).nullable().optional(),
    nextDueAt: z.number().int().positive().optional(),
    endAt: z.number().int().positive().nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;

// POST .../schedules/:id/complete body. `occurredAt` must additionally be
// within [now − 7 days, now + 1 hour] — sanity bounds checked in the handler.
export const completeScheduleSchema = z
  .object({
    occurredAt: z.number().int().positive().optional(), // default: now
    tzOffsetMin: z.number().int().min(-840).max(840).optional(), // default: 0
    memo: z.string().trim().max(2000).optional(),
  })
  .strict();
export type CompleteScheduleInput = z.infer<typeof completeScheduleSchema>;

export type ScheduleResponse = {
  id: string;
  petId: string;
  type: ScheduleType;
  name: string;
  categoryLink: Category;
  detailsTemplate: unknown;
  recurrenceUnit: RecurrenceUnit;
  recurrenceN: number | null;
  nextDueAt: number;
  endAt: number | null;
  active: boolean;
  createdAt: number;
};

/** Disjoint buckets; active schedules only (spec §7 "Care status"). */
export type CareStatusResponse = {
  overdue: ScheduleResponse[]; // nextDueAt < now
  today: ScheduleResponse[]; // now ≤ nextDueAt < next household midnight
  upcoming: ScheduleResponse[]; // the 7 household days after today
};

export type CompleteScheduleResponse = {
  activity: ActivityResponse;
  schedule: ScheduleResponse;
};

// --- Analyzer ---

export const INSIGHTS_PERIODS = ["4w", "3m", "1y"] as const;
export type InsightsPeriod = (typeof INSIGHTS_PERIODS)[number];

/**
 * Chart buckets are day keys "YYYY-MM-DD" for 4w/3m and ISO-week keys
 * "YYYY-Www" for 1y. Sparse by design: a bucket with no data is simply
 * absent (charts render gaps / hollow markers, never fake zeros — spec §7).
 */
export type WeightPoint = { bucket: string; kg: number; avg7: number };
export type WeightSeries = {
  /** sorted by bucket; latest weighing per bucket; avg7 = trailing mean of up to 7 points */
  points: WeightPoint[];
  min: number | null;
  max: number | null;
  /** last point vs first point, percent, 1 decimal; null with <2 points */
  pctChange: number | null;
};

/** Worst-last severity order; index = rank (matrix coloring + anomaly rule). */
export const TOILET_SEVERITY = ["normal", "soft", "hard", "diarrhea", "bloody"] as const;
export type ToiletSeverity = (typeof TOILET_SEVERITY)[number];

export type ToiletCell = { count: number; worst: ToiletSeverity };
export type ToiletMatrixRow = {
  bucket: string;
  pee: ToiletCell | null;
  poop: ToiletCell | null;
};

export type CareSpan = {
  name: string;
  /** household-naive epoch ms — same axis space as windowStart/windowEnd */
  firstAt: number;
  lastAt: number;
  count: number;
};
export type SymptomSpan = CareSpan & {
  maxSeverity: "mild" | "moderate" | "severe";
};
export type VetMarker = { at: number; clinic: string | null };

export type AnomalySeverity = "info" | "warning";
/**
 * Anomalies are STRUCTURED (rule id + params), never prose — the frontend
 * catalog renders localized advisory copy (spec §7 tone lives client-side).
 */
export type Anomaly =
  | { rule: "weight_drift"; severity: "warning"; params: { pctChange: number } }
  | { rule: "toilet_trouble"; severity: "warning"; params: { count: number } }
  | { rule: "quiet_day"; severity: "info"; params: Record<string, never> }
  | { rule: "symptom_streak"; severity: "warning"; params: { name: string; days: number } };
export type AnomalyRule = Anomaly["rule"];

export type InsightsResponse = {
  period: InsightsPeriod;
  bucket: "day" | "week";
  /** every bucket key in the window, oldest → the bucket containing today */
  buckets: string[];
  /** household-naive epoch ms window (the timeline x-axis space) */
  windowStart: number;
  windowEnd: number;
  weight: WeightSeries;
  intake: {
    /** bucket → grams (food entries with unit='g' only); absent = not logged */
    food: Record<string, number>;
    /** bucket → ml; absent = not logged */
    water: Record<string, number>;
    targets: PetTargets | null;
  };
  toilet: ToiletMatrixRow[];
  timeline: {
    medications: CareSpan[];
    symptoms: SymptomSpan[];
    vetVisits: VetMarker[];
  };
  anomalies: Anomaly[];
};

export type AnomaliesResponse = { anomalies: Anomaly[] };

// --- ISO week math (shared by worker bucketing and app axis labels) ---

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

function isoWeek1Monday(isoYear: number): number {
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  return jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY_MS;
}

/** ISO-8601 week key ("2026-W24") of a "YYYY-MM-DD" day key. */
export function isoWeekKey(dayKey: string): string {
  const date = new Date(
    Date.UTC(
      Number(dayKey.slice(0, 4)),
      Number(dayKey.slice(5, 7)) - 1,
      Number(dayKey.slice(8, 10)),
    ),
  );
  const mondayIndex = (date.getUTCDay() + 6) % 7; // 0 = Monday
  // The Thursday of the week decides the ISO year (ISO-8601).
  const thursday = date.getTime() + (3 - mondayIndex) * DAY_MS;
  const isoYear = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - isoWeek1Monday(isoYear)) / WEEK_MS) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** Monday of an ISO week key, as a "YYYY-MM-DD" day key. */
export function isoWeekStartDay(weekKey: string): string {
  const isoYear = Number(weekKey.slice(0, 4));
  const week = Number(weekKey.slice(6, 8));
  const monday = new Date(isoWeek1Monday(isoYear) + (week - 1) * WEEK_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w shared && npm run typecheck -w worker && npm run typecheck -w app`
Expected: no errors (pure additions).

- [ ] **Step 3: Commit**

```bash
git add shared/src/index.ts
git commit -m "feat: add plan 4 shared schemas and types for care schedules and insights"
```

---

### Task 2: Recurrence domain — anchored advancement (TDD)

**Files:**
- Modify: `worker/src/db/schema.ts` (ONE type-only line — no SQL, no migration)
- Create: `worker/src/domain/recurrence.ts`
- Test: `worker/test/recurrence.test.ts`

- [ ] **Step 1: Add the inferred type to `worker/src/db/schema.ts`**

Append after the existing `export type Activity = ...` line:

```ts
export type CareSchedule = typeof careSchedules.$inferSelect;
```

- [ ] **Step 2: Write the failing test `worker/test/recurrence.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { advanceSchedule } from "../src/domain/recurrence";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T = Date.UTC(2026, 5, 1, 8, 0); // 2026-06-01 08:00 UTC

function sched(
  overrides: Partial<{
    recurrenceUnit: "once" | "hour" | "day" | "week" | "month";
    recurrenceN: number | null;
    nextDueAt: number;
    endAt: number | null;
  }> = {},
) {
  return {
    recurrenceUnit: "day" as const,
    recurrenceN: 1,
    nextDueAt: T,
    endAt: null,
    ...overrides,
  };
}

describe("advanceSchedule", () => {
  it("deactivates once-schedules without moving nextDueAt", () => {
    expect(advanceSchedule(sched({ recurrenceUnit: "once", recurrenceN: null }))).toEqual({
      nextDueAt: T,
      active: false,
    });
  });

  it("advances hour/day/week by n × unit, anchored to the previous due time", () => {
    expect(advanceSchedule(sched({ recurrenceUnit: "hour", recurrenceN: 12 }))).toEqual({
      nextDueAt: T + 12 * HOUR,
      active: true,
    });
    expect(advanceSchedule(sched({ recurrenceUnit: "day", recurrenceN: 2 }))).toEqual({
      nextDueAt: T + 2 * DAY,
      active: true,
    });
    expect(advanceSchedule(sched({ recurrenceUnit: "week", recurrenceN: 1 }))).toEqual({
      nextDueAt: T + 7 * DAY,
      active: true,
    });
  });

  it("defaults a null recurrenceN to 1", () => {
    expect(advanceSchedule(sched({ recurrenceN: null }))).toEqual({
      nextDueAt: T + DAY,
      active: true,
    });
  });

  it("advances months on the calendar, clamping to the target month's length", () => {
    // Jan 31 + 1 month → Feb 28 (2026 is not a leap year); time of day kept
    const jan31 = Date.UTC(2026, 0, 31, 9, 30);
    expect(advanceSchedule(sched({ recurrenceUnit: "month", recurrenceN: 1, nextDueAt: jan31 }))).toEqual({
      nextDueAt: Date.UTC(2026, 1, 28, 9, 30),
      active: true,
    });
    // Jan 31 2024 + 1 month → Feb 29 (leap year)
    const jan31leap = Date.UTC(2024, 0, 31, 9, 30);
    expect(
      advanceSchedule(sched({ recurrenceUnit: "month", recurrenceN: 1, nextDueAt: jan31leap })).nextDueAt,
    ).toBe(Date.UTC(2024, 1, 29, 9, 30));
    // n=3 crosses a year boundary
    const nov15 = Date.UTC(2026, 10, 15, 9, 30);
    expect(
      advanceSchedule(sched({ recurrenceUnit: "month", recurrenceN: 3, nextDueAt: nov15 })).nextDueAt,
    ).toBe(Date.UTC(2027, 1, 15, 9, 30));
  });

  it("endAt is inclusive: a next occurrence exactly at endAt stays active, past it deactivates", () => {
    expect(advanceSchedule(sched({ endAt: T + DAY }))).toEqual({ nextDueAt: T + DAY, active: true });
    expect(advanceSchedule(sched({ endAt: T + DAY - 1 }))).toEqual({ nextDueAt: T + DAY, active: false });
  });

  it('spec §4 example — "antibiotics 2×/day for 7 days" yields exactly 14 doses', () => {
    // unit=hour, n=12, first dose due at T, endAt just under +7d
    let current = sched({ recurrenceUnit: "hour", recurrenceN: 12, endAt: T + 7 * DAY - 1 });
    let doses = 0;
    let active = true;
    while (active) {
      doses++; // completing the currently-due dose…
      const adv = advanceSchedule(current);
      current = { ...current, nextDueAt: adv.nextDueAt };
      active = adv.active;
    }
    expect(doses).toBe(14);
    expect(current.nextDueAt).toBe(T + 14 * 12 * HOUR); // first slot past endAt
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -w worker -- recurrence`
Expected: FAIL — cannot resolve `../src/domain/recurrence`.

- [ ] **Step 4: Create `worker/src/domain/recurrence.ts`**

```ts
import type { CareSchedule } from "../db/schema";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const FIXED_UNIT_MS = { hour: HOUR_MS, day: DAY_MS, week: WEEK_MS } as const;

export type ScheduleAdvance = { nextDueAt: number; active: boolean };

/** Calendar month addition that keeps the time of day and clamps the
 *  day-of-month to the target month's length (Jan 31 + 1mo → Feb 28/29). */
function addMonthsClamped(ms: number, months: number): number {
  const d = new Date(ms);
  const day = d.getUTCDate();
  const target = new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() + months,
      1,
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
  const daysInTarget = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, daysInTarget));
  return target.getTime();
}

/**
 * Pure advancement after a completion. The next due time is anchored to the
 * PREVIOUS due time (nextDueAt + interval), never to the completion moment —
 * completing late doesn't drift the cadence, and a very late completion can
 * leave the new nextDueAt already in the past (deliberate: missed cadence
 * stays visible as overdue). Deactivates `once` schedules and any schedule
 * whose next occurrence would land after endAt (endAt itself is inclusive).
 */
export function advanceSchedule(
  schedule: Pick<CareSchedule, "recurrenceUnit" | "recurrenceN" | "nextDueAt" | "endAt">,
): ScheduleAdvance {
  if (schedule.recurrenceUnit === "once") {
    return { nextDueAt: schedule.nextDueAt, active: false };
  }
  const n = schedule.recurrenceN ?? 1;
  const next =
    schedule.recurrenceUnit === "month"
      ? addMonthsClamped(schedule.nextDueAt, n)
      : schedule.nextDueAt + n * FIXED_UNIT_MS[schedule.recurrenceUnit];
  const active = schedule.endAt === null || next <= schedule.endAt;
  return { nextDueAt: next, active };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all suites; 6 new tests).

- [ ] **Step 6: Commit**

```bash
git add worker/src/db/schema.ts worker/src/domain/recurrence.ts worker/test/recurrence.test.ts
git commit -m "feat: add recurrence advancement domain logic"
```

---

### Task 3: Care schedules CRUD routes (TDD)

**Files:**
- Create: `worker/src/routes/schedules.ts`
- Modify: `worker/src/index.ts`
- Modify: `worker/test/helpers.ts`
- Test: `worker/test/schedules.test.ts`

- [ ] **Step 1: Extend `worker/test/helpers.ts`**

Add `careSchedules` to the existing schema import (`import { activities, careSchedules, petMembers, pets, users } from "../src/db/schema";`), then append:

```ts
export async function seedSchedule(
  petId: string,
  overrides: Partial<{
    type: "medication" | "vaccination" | "vet_visit" | "deworming" | "grooming" | "custom";
    name: string;
    categoryLink: Category;
    detailsTemplate: unknown;
    recurrenceUnit: "once" | "hour" | "day" | "week" | "month";
    recurrenceN: number | null;
    nextDueAt: number;
    endAt: number | null;
    active: boolean;
  }> = {},
): Promise<{ scheduleId: string }> {
  const db = drizzle(env.DB);
  const scheduleId = newId();
  await db.insert(careSchedules).values({
    id: scheduleId,
    petId,
    type: overrides.type ?? "medication",
    name: overrides.name ?? "Heart pills",
    categoryLink: overrides.categoryLink ?? "medication",
    detailsTemplate: overrides.detailsTemplate ?? { name: "Heart pills" },
    recurrenceUnit: overrides.recurrenceUnit ?? "day",
    recurrenceN: overrides.recurrenceN === undefined ? 1 : overrides.recurrenceN,
    nextDueAt: overrides.nextDueAt ?? Date.now(),
    endAt: overrides.endAt ?? null,
    active: overrides.active ?? true,
    createdAt: Date.now(),
  });
  return { scheduleId };
}
```

- [ ] **Step 2: Write the failing test `worker/test/schedules.test.ts`**

```ts
import { SELF, env } from "cloudflare:test";
import type { ScheduleResponse } from "@pawlog/shared";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { auditLog, careSchedules } from "../src/db/schema";
import { authHeaders, seedPet, seedSchedule, seedUserWithSession, withMember } from "./helpers";

const base = (petId: string) => `https://app.local/api/pets/${petId}/schedules`;

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    type: "medication",
    name: "Heart pills",
    categoryLink: "medication",
    detailsTemplate: { name: "Heart pills", dose: 5, doseUnit: "mg" },
    recurrenceUnit: "day",
    recurrenceN: 1,
    nextDueAt: Date.now() + 3_600_000,
    ...overrides,
  };
}

async function scheduleAudits(petId: string) {
  const db = drizzle(env.DB);
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.petId, petId), eq(auditLog.entity, "schedule")))
    .all();
}

describe("POST /api/pets/:petId/schedules", () => {
  it("creates a schedule, audits it, and returns 201", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const res = await SELF.fetch(base(petId), {
      method: "POST",
      headers: authHeaders(cookie, csrfToken),
      body: JSON.stringify(validBody()),
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: ScheduleResponse };
    expect(data.type).toBe("medication");
    expect(data.categoryLink).toBe("medication");
    expect(data.detailsTemplate).toEqual({ name: "Heart pills", dose: 5, doseUnit: "mg" });
    expect(data.recurrenceUnit).toBe("day");
    expect(data.recurrenceN).toBe(1);
    expect(data.active).toBe(true);
    expect(data.endAt).toBeNull();
    const audits = await scheduleAudits(petId);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe("create");
    expect(audits[0]?.entityId).toBe(data.id);
  });

  it("normalizes recurrenceN to null for once-schedules", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const res = await SELF.fetch(base(petId), {
      method: "POST",
      headers: authHeaders(cookie, csrfToken),
      body: JSON.stringify(validBody({ recurrenceUnit: "once", recurrenceN: 5 })),
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: ScheduleResponse };
    expect(data.recurrenceN).toBeNull();
  });

  it("rejects invalid payloads with 400", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const cases: Record<string, unknown>[] = [
      validBody({ recurrenceN: undefined }), // required unless once
      validBody({ endAt: validBody().nextDueAt }), // endAt must be after nextDueAt
      validBody({ categoryLink: "water", detailsTemplate: { kg: 5 } }), // template vs category
      validBody({ name: "" }),
      validBody({ type: "haircut" }), // unknown enum value
      validBody({ surprise: 1 }), // strict: unknown key
    ];
    for (const body of cases) {
      const res = await SELF.fetch(base(petId), {
        method: "POST",
        headers: authHeaders(cookie, csrfToken),
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });
});

describe("GET /api/pets/:petId/schedules", () => {
  it("lists active schedules first, each group ordered by nextDueAt", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    const late = await seedSchedule(petId, { name: "Later", nextDueAt: now + 2_000_000 });
    const done = await seedSchedule(petId, { name: "Done", nextDueAt: now, active: false });
    const soon = await seedSchedule(petId, { name: "Soon", nextDueAt: now + 1_000_000 });
    const res = await SELF.fetch(base(petId), { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: ScheduleResponse[] };
    expect(data.map((s) => s.id)).toEqual([soon.scheduleId, late.scheduleId, done.scheduleId]);
  });

  it("enforces the authz matrix", async () => {
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    const viewer = await seedUserWithSession({ email: "v@example.com" });
    await withMember(petId, viewer.userId, "viewer");
    const outsider = await seedUserWithSession({ email: "x@example.com" });

    // viewer can read
    const read = await SELF.fetch(base(petId), { headers: { Cookie: viewer.cookie } });
    expect(read.status).toBe(200);
    // viewer cannot write
    const write = await SELF.fetch(base(petId), {
      method: "POST",
      headers: authHeaders(viewer.cookie, viewer.csrfToken),
      body: JSON.stringify(validBody()),
    });
    expect(write.status).toBe(403);
    // outsider sees 404 (anti-probing)
    const probe = await SELF.fetch(base(petId), { headers: { Cookie: outsider.cookie } });
    expect(probe.status).toBe(404);
    // no session
    const anon = await SELF.fetch(base(petId));
    expect(anon.status).toBe(401);
  });
});

describe("PATCH /api/pets/:petId/schedules/:id", () => {
  it("updates fields and audits a before/after diff", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const { scheduleId } = await seedSchedule(petId, { name: "Old name" });
    const nextDueAt = Date.now() + 9_000_000;
    const res = await SELF.fetch(`${base(petId)}/${scheduleId}`, {
      method: "PATCH",
      headers: authHeaders(cookie, csrfToken),
      body: JSON.stringify({ name: "New name", nextDueAt }),
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: ScheduleResponse };
    expect(data.name).toBe("New name");
    expect(data.nextDueAt).toBe(nextDueAt);
    const audits = await scheduleAudits(petId);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe("update");
    expect(audits[0]?.diff).toEqual({
      before: { name: "Old name", nextDueAt: expect.any(Number) },
      after: { name: "New name", nextDueAt },
    });
  });

  it("rejects immutable/invalid updates with 400", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const { scheduleId } = await seedSchedule(petId, { nextDueAt: Date.now() + 3_600_000 });
    const cases: Record<string, unknown>[] = [
      {}, // nothing to update
      { type: "grooming" }, // immutable (strict: unknown key)
      { categoryLink: "water" }, // immutable
      { detailsTemplate: { kg: 5 } }, // doesn't fit stored category (medication)
      { recurrenceN: null }, // unit stays "day" → N required
      { endAt: Date.now() }, // ≤ stored nextDueAt
    ];
    for (const body of cases) {
      const res = await SELF.fetch(`${base(petId)}/${scheduleId}`, {
        method: "PATCH",
        headers: authHeaders(cookie, csrfToken),
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });

  it("allows switching to once with recurrenceN null, and restoring active", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const { scheduleId } = await seedSchedule(petId, { active: false });
    const res = await SELF.fetch(`${base(petId)}/${scheduleId}`, {
      method: "PATCH",
      headers: authHeaders(cookie, csrfToken),
      body: JSON.stringify({ recurrenceUnit: "once", recurrenceN: null, active: true }),
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: ScheduleResponse };
    expect(data.recurrenceUnit).toBe("once");
    expect(data.recurrenceN).toBeNull();
    expect(data.active).toBe(true);
  });

  it("is 404 for another pet's schedule id", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const { petId: otherPet } = await seedPet(userId, "owner", { name: "Hana" });
    const { scheduleId } = await seedSchedule(otherPet);
    const res = await SELF.fetch(`${base(petId)}/${scheduleId}`, {
      method: "PATCH",
      headers: authHeaders(cookie, csrfToken),
      body: JSON.stringify({ name: "Stolen" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/pets/:petId/schedules/:id", () => {
  it("hard-deletes, audits, and 404s on repeat", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const { scheduleId } = await seedSchedule(petId);
    const res = await SELF.fetch(`${base(petId)}/${scheduleId}`, {
      method: "DELETE",
      headers: authHeaders(cookie, csrfToken),
    });
    expect(res.status).toBe(200);
    const db = drizzle(env.DB);
    const rows = await db.select().from(careSchedules).where(eq(careSchedules.id, scheduleId)).all();
    expect(rows).toHaveLength(0);
    const audits = await scheduleAudits(petId);
    expect(audits[0]?.action).toBe("delete");
    const again = await SELF.fetch(`${base(petId)}/${scheduleId}`, {
      method: "DELETE",
      headers: authHeaders(cookie, csrfToken),
    });
    expect(again.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -w worker -- schedules`
Expected: FAIL — every request 404s (routes not registered yet).

- [ ] **Step 4: Create `worker/src/routes/schedules.ts`**

```ts
import type { ScheduleResponse } from "@pawlog/shared";
import { activityDetailsSchemas, createScheduleSchema, updateScheduleSchema } from "@pawlog/shared";
import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { Hono } from "hono";
import { careSchedules, type CareSchedule } from "../db/schema";
import { writeAudit } from "../domain/audit";
import type { AppEnv } from "../env";
import { newId } from "../lib/id";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requirePetRole } from "../middleware/pet-access";
import { requireSession } from "../middleware/session";

export const scheduleRoutes = new Hono<AppEnv>();

export function scheduleToResponse(s: CareSchedule): ScheduleResponse {
  return {
    id: s.id,
    petId: s.petId,
    type: s.type,
    name: s.name,
    categoryLink: s.categoryLink,
    detailsTemplate: s.detailsTemplate,
    recurrenceUnit: s.recurrenceUnit,
    recurrenceN: s.recurrenceN,
    nextDueAt: s.nextDueAt,
    endAt: s.endAt,
    active: s.active,
    createdAt: s.createdAt,
  };
}

/** Scoped to the pet — a schedule id from another pet is a 404. */
export async function getSchedule(
  db: DrizzleD1Database,
  petId: string,
  id: string | undefined,
): Promise<CareSchedule | undefined> {
  if (!id) return undefined;
  return db
    .select()
    .from(careSchedules)
    .where(and(eq(careSchedules.id, id), eq(careSchedules.petId, petId)))
    .get();
}

scheduleRoutes.get(
  "/api/pets/:petId/schedules",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(careSchedules)
      .where(eq(careSchedules.petId, c.get("petId")))
      .orderBy(desc(careSchedules.active), asc(careSchedules.nextDueAt))
      .all();
    return c.json({ data: rows.map(scheduleToResponse) });
  },
);

scheduleRoutes.post(
  "/api/pets/:petId/schedules",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createScheduleSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const petId = c.get("petId");
    const user = c.get("user");
    const db = drizzle(c.env.DB);
    const schedule: CareSchedule = {
      id: newId(),
      petId,
      type: parsed.data.type,
      name: parsed.data.name,
      categoryLink: parsed.data.categoryLink,
      detailsTemplate: parsed.data.detailsTemplate ?? {},
      recurrenceUnit: parsed.data.recurrenceUnit,
      // normalized: once-schedules never carry an interval count
      recurrenceN: parsed.data.recurrenceUnit === "once" ? null : parsed.data.recurrenceN!,
      nextDueAt: parsed.data.nextDueAt,
      endAt: parsed.data.endAt ?? null,
      active: true,
      createdAt: Date.now(),
    };
    await db.insert(careSchedules).values(schedule);
    await writeAudit(db, {
      petId,
      userId: user.id,
      action: "create",
      entity: "schedule",
      entityId: schedule.id,
      diff: { type: schedule.type, name: schedule.name },
    });
    return c.json({ data: scheduleToResponse(schedule) }, 201);
  },
);

scheduleRoutes.patch(
  "/api/pets/:petId/schedules/:id",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateScheduleSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    if (Object.keys(parsed.data).length === 0) {
      return err(c, 400, "validation", "No fields to update");
    }
    const db = drizzle(c.env.DB);
    const schedule = await getSchedule(db, c.get("petId"), c.req.param("id"));
    if (!schedule) return err(c, 404, "not_found", "Not found");

    if (parsed.data.detailsTemplate !== undefined) {
      // categoryLink is immutable, so the template must fit the STORED category
      const check = activityDetailsSchemas[schedule.categoryLink].safeParse(
        parsed.data.detailsTemplate,
      );
      if (!check.success) {
        return err(c, 400, "validation", check.error.issues[0]?.message ?? "Invalid details template");
      }
    }

    const changes: Partial<CareSchedule> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of [
      "name",
      "detailsTemplate",
      "recurrenceUnit",
      "recurrenceN",
      "nextDueAt",
      "endAt",
      "active",
    ] as const) {
      const value = parsed.data[key];
      if (value !== undefined) {
        changes[key] = value as never;
        before[key] = schedule[key];
        after[key] = value;
      }
    }
    // cross-field rules re-checked on the MERGED record
    const merged: CareSchedule = { ...schedule, ...changes };
    if (merged.recurrenceUnit !== "once" && merged.recurrenceN === null) {
      return err(c, 400, "validation", "recurrenceN is required unless recurrence is once");
    }
    if (merged.endAt !== null && merged.endAt <= merged.nextDueAt) {
      return err(c, 400, "validation", "endAt must be after nextDueAt");
    }
    await db.update(careSchedules).set(changes).where(eq(careSchedules.id, schedule.id));
    await writeAudit(db, {
      petId: schedule.petId,
      userId: c.get("user").id,
      action: "update",
      entity: "schedule",
      entityId: schedule.id,
      diff: { before, after },
    });
    return c.json({ data: scheduleToResponse(merged) });
  },
);

scheduleRoutes.delete(
  "/api/pets/:petId/schedules/:id",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const schedule = await getSchedule(db, c.get("petId"), c.req.param("id"));
    if (!schedule) return err(c, 404, "not_found", "Not found");
    // Hard delete (locked decision): history lives in logged activities + audit_log.
    await db.delete(careSchedules).where(eq(careSchedules.id, schedule.id));
    await writeAudit(db, {
      petId: schedule.petId,
      userId: c.get("user").id,
      action: "delete",
      entity: "schedule",
      entityId: schedule.id,
    });
    return c.json({ data: { ok: true } });
  },
);
```

- [ ] **Step 5: Mount in `worker/src/index.ts`**

Add the import and mount (after the preset routes):

```ts
import { scheduleRoutes } from "./routes/schedules";
```

```ts
app.route("/", scheduleRoutes);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all suites; 9 new tests).

- [ ] **Step 7: Commit**

```bash
git add worker/src/routes/schedules.ts worker/src/index.ts worker/test/helpers.ts worker/test/schedules.test.ts
git commit -m "feat: add care schedule crud routes"
```

---

### Task 4: Complete endpoint — atomic activity insert + advancement (TDD)

**Files:**
- Modify: `worker/src/routes/activities.ts` (export the existing response helper — one keyword)
- Modify: `worker/src/routes/schedules.ts`
- Test: `worker/test/schedule-complete.test.ts`

- [ ] **Step 1: Export the response helper in `worker/src/routes/activities.ts`**

Change the existing private declaration

```ts
function activityToResponse(
```

to

```ts
export function activityToResponse(
```

(no other change — one shared implementation instead of a duplicate).

- [ ] **Step 2: Write the failing test `worker/test/schedule-complete.test.ts`**

```ts
import { SELF, env } from "cloudflare:test";
import type { CompleteScheduleResponse } from "@pawlog/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { activities, auditLog, careSchedules } from "../src/db/schema";
import { authHeaders, seedPet, seedSchedule, seedUserWithSession, withMember } from "./helpers";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function complete(
  petId: string,
  scheduleId: string,
  cookie: string,
  csrfToken: string,
  body: Record<string, unknown> = {},
) {
  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/schedules/${scheduleId}/complete`,
    { method: "POST", headers: authHeaders(cookie, csrfToken), body: JSON.stringify(body) },
  );
  return { status: res.status, body: (await res.json()) as { data: CompleteScheduleResponse } };
}

describe("POST /api/pets/:petId/schedules/:id/complete", () => {
  it("inserts the activity from the template (medication gets scheduleId), advances, audits both", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const due = Date.now() - HOUR; // overdue daily pill
    const { scheduleId } = await seedSchedule(petId, {
      detailsTemplate: { name: "Heart pills", dose: 5, doseUnit: "mg" },
      recurrenceUnit: "day",
      recurrenceN: 1,
      nextDueAt: due,
    });

    const before = Date.now();
    const { status, body } = await complete(petId, scheduleId, cookie, csrfToken, {
      tzOffsetMin: 540,
      memo: "with breakfast",
    });
    expect(status).toBe(201);

    // activity: template + injected scheduleId (medication only)
    expect(body.data.activity.category).toBe("medication");
    expect(body.data.activity.details).toEqual({
      name: "Heart pills",
      dose: 5,
      doseUnit: "mg",
      scheduleId,
    });
    expect(body.data.activity.tzOffsetMin).toBe(540);
    expect(body.data.activity.memo).toBe("with breakfast");
    expect(body.data.activity.occurredAt).toBeGreaterThanOrEqual(before);
    expect(body.data.activity.photos).toEqual([]);

    // schedule: anchored advance (old due + 1 day), still active
    expect(body.data.schedule.nextDueAt).toBe(due + DAY);
    expect(body.data.schedule.active).toBe(true);

    // persisted rows
    const db = drizzle(env.DB);
    const acts = await db.select().from(activities).where(eq(activities.petId, petId)).all();
    expect(acts).toHaveLength(1);
    const sched = await db.select().from(careSchedules).where(eq(careSchedules.id, scheduleId)).get();
    expect(sched?.nextDueAt).toBe(due + DAY);

    // audit: one activity create + one schedule update
    const audits = await db.select().from(auditLog).where(eq(auditLog.petId, petId)).all();
    const activityAudit = audits.find((a) => a.entity === "activity");
    const scheduleAudit = audits.find((a) => a.entity === "schedule");
    expect(activityAudit?.action).toBe("create");
    expect(activityAudit?.diff).toEqual({ category: "medication", scheduleId });
    expect(scheduleAudit?.action).toBe("update");
    expect(scheduleAudit?.diff).toEqual({
      before: { nextDueAt: due, active: true },
      after: { nextDueAt: due + DAY, active: true },
    });
  });

  it("does not inject scheduleId for non-medication categories", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const { scheduleId } = await seedSchedule(petId, {
      type: "grooming",
      name: "Nail trim",
      categoryLink: "grooming",
      detailsTemplate: { kind: "nails" },
      recurrenceUnit: "week",
      recurrenceN: 2,
    });
    const { status, body } = await complete(petId, scheduleId, cookie, csrfToken);
    expect(status).toBe(201);
    expect(body.data.activity.category).toBe("grooming");
    expect(body.data.activity.details).toEqual({ kind: "nails" });
    expect(body.data.activity.tzOffsetMin).toBe(0); // default
  });

  it("deactivates once-schedules and 409s a second completion", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const { scheduleId } = await seedSchedule(petId, {
      type: "vaccination",
      categoryLink: "vaccination",
      detailsTemplate: { vaccineName: "Rabies" },
      recurrenceUnit: "once",
      recurrenceN: null,
    });
    const first = await complete(petId, scheduleId, cookie, csrfToken);
    expect(first.status).toBe(201);
    expect(first.body.data.schedule.active).toBe(false);
    const second = await complete(petId, scheduleId, cookie, csrfToken);
    expect(second.status).toBe(409);
  });

  it("deactivates when the next occurrence would pass endAt", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    const { scheduleId } = await seedSchedule(petId, {
      recurrenceUnit: "hour",
      recurrenceN: 12,
      nextDueAt: now,
      endAt: now + 11 * HOUR, // next slot (+12 h) lands past endAt
    });
    const { status, body } = await complete(petId, scheduleId, cookie, csrfToken);
    expect(status).toBe(201);
    expect(body.data.schedule.active).toBe(false);
  });

  it("accepts occurredAt within [now − 7 d, now + 1 h] and rejects outside", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const { scheduleId } = await seedSchedule(petId);
    const now = Date.now();

    const past = await complete(petId, scheduleId, cookie, csrfToken, {
      occurredAt: now - 8 * DAY,
    });
    expect(past.status).toBe(400);
    const future = await complete(petId, scheduleId, cookie, csrfToken, {
      occurredAt: now + 2 * HOUR,
    });
    expect(future.status).toBe(400);

    const okAt = now - 2 * HOUR;
    const ok = await complete(petId, scheduleId, cookie, csrfToken, { occurredAt: okAt });
    expect(ok.status).toBe(201);
    expect(ok.body.data.activity.occurredAt).toBe(okAt);
  });

  it("enforces the authz matrix and CSRF", async () => {
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    const { scheduleId } = await seedSchedule(petId);
    const viewer = await seedUserWithSession({ email: "v@example.com" });
    await withMember(petId, viewer.userId, "viewer");
    const outsider = await seedUserWithSession({ email: "x@example.com" });

    const asViewer = await complete(petId, scheduleId, viewer.cookie, viewer.csrfToken);
    expect(asViewer.status).toBe(403);
    const asOutsider = await complete(petId, scheduleId, outsider.cookie, outsider.csrfToken);
    expect(asOutsider.status).toBe(404);
    const noCsrf = await SELF.fetch(
      `https://app.local/api/pets/${petId}/schedules/${scheduleId}/complete`,
      { method: "POST", headers: authHeaders(owner.cookie), body: "{}" },
    );
    expect(noCsrf.status).toBe(403);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -w worker -- schedule-complete`
Expected: FAIL — 404 on the complete route.

- [ ] **Step 4: Add the complete handler to `worker/src/routes/schedules.ts`**

Extend the imports at the top of the file:

```ts
import type { CompleteScheduleResponse, ScheduleResponse } from "@pawlog/shared";
import {
  activityDetailsSchemas,
  completeScheduleSchema,
  createScheduleSchema,
  updateScheduleSchema,
} from "@pawlog/shared";
import { activities, careSchedules, type Activity, type CareSchedule } from "../db/schema";
import { advanceSchedule } from "../domain/recurrence";
import { activityToResponse } from "./activities";
```

(merge with the existing import lines; everything else stays). Then append the handler:

```ts
const COMPLETE_PAST_MS = 7 * 24 * 3_600_000;
const COMPLETE_FUTURE_MS = 3_600_000;

scheduleRoutes.post(
  "/api/pets/:petId/schedules/:id/complete",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const body = await c.req.json().catch(() => ({})); // empty body allowed
    const parsed = completeScheduleSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const now = Date.now();
    const occurredAt = parsed.data.occurredAt ?? now;
    if (occurredAt < now - COMPLETE_PAST_MS || occurredAt > now + COMPLETE_FUTURE_MS) {
      return err(c, 400, "validation", "occurredAt must be within the last 7 days");
    }
    const db = drizzle(c.env.DB);
    const schedule = await getSchedule(db, c.get("petId"), c.req.param("id"));
    if (!schedule) return err(c, 404, "not_found", "Not found");
    if (!schedule.active) {
      return err(c, 409, "schedule_inactive", "Schedule is no longer active");
    }

    // Build the activity from the template; medication gets the scheduleId
    // back-reference (the shared medication schema has the optional field).
    const template = (schedule.detailsTemplate ?? {}) as Record<string, unknown>;
    const details =
      schedule.categoryLink === "medication"
        ? { ...template, scheduleId: schedule.id }
        : template;
    const check = activityDetailsSchemas[schedule.categoryLink].safeParse(details);
    if (!check.success) {
      // can only happen if a stored template predates a schema change
      return err(c, 500, "internal", "Stored details template is invalid");
    }

    const user = c.get("user");
    const adv = advanceSchedule(schedule);
    const activity: Activity = {
      id: newId(),
      petId: schedule.petId,
      category: schedule.categoryLink,
      occurredAt,
      tzOffsetMin: parsed.data.tzOffsetMin ?? 0,
      memo: parsed.data.memo ?? null,
      details: check.data,
      createdBy: user.id,
      updatedBy: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    // both-or-neither: D1 batches are transactional (spec §4 "atomically")
    await db.batch([
      db.insert(activities).values(activity),
      db
        .update(careSchedules)
        .set({ nextDueAt: adv.nextDueAt, active: adv.active })
        .where(eq(careSchedules.id, schedule.id)),
    ]);
    await writeAudit(db, {
      petId: schedule.petId,
      userId: user.id,
      action: "create",
      entity: "activity",
      entityId: activity.id,
      diff: { category: activity.category, scheduleId: schedule.id },
    });
    await writeAudit(db, {
      petId: schedule.petId,
      userId: user.id,
      action: "update",
      entity: "schedule",
      entityId: schedule.id,
      diff: {
        before: { nextDueAt: schedule.nextDueAt, active: schedule.active },
        after: { nextDueAt: adv.nextDueAt, active: adv.active },
      },
    });

    const updated: CareSchedule = { ...schedule, nextDueAt: adv.nextDueAt, active: adv.active };
    const data: CompleteScheduleResponse = {
      activity: activityToResponse(activity, []),
      schedule: scheduleToResponse(updated),
    };
    return c.json({ data }, 201);
  },
);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all suites; 6 new tests).

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/activities.ts worker/src/routes/schedules.ts worker/test/schedule-complete.test.ts
git commit -m "feat: add schedule complete endpoint with activity insertion and advancement"
```

---

### Task 5: Care-status endpoint — overdue / today / upcoming (TDD)

**Files:**
- Create: `worker/src/lib/tz.ts`
- Modify: `worker/src/routes/schedules.ts`
- Test: `worker/test/care-status.test.ts`

The household-day boundary: with `tzMs = tz * 60000`, the next household midnight (as a UTC instant) is `Math.floor((now + tzMs) / DAY) * DAY + DAY - tzMs`. Both the handler and the test compute it with the same formula, so the test is deterministic at any time of day.

- [ ] **Step 1: Write the failing test `worker/test/care-status.test.ts`**

```ts
import { SELF } from "cloudflare:test";
import type { CareStatusResponse } from "@pawlog/shared";
import { describe, expect, it } from "vitest";
import { seedPet, seedSchedule, seedUserWithSession } from "./helpers";

const DAY = 86_400_000;
const TZ = 540; // JST

function nextHouseholdMidnight(now: number, tz: number): number {
  const tzMs = tz * 60_000;
  return Math.floor((now + tzMs) / DAY) * DAY + DAY - tzMs;
}

async function careStatus(petId: string, cookie: string, tz?: string) {
  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/care-status${tz === undefined ? "" : `?tz=${tz}`}`,
    { headers: { Cookie: cookie } },
  );
  return { status: res.status, body: (await res.json()) as { data: CareStatusResponse } };
}

describe("GET /api/pets/:petId/care-status", () => {
  it("buckets active schedules into overdue / today / upcoming-7d, sorted by due time", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    const todayEnd = nextHouseholdMidnight(now, TZ);

    const overdue = await seedSchedule(petId, { name: "Overdue", nextDueAt: now - 60_000 });
    const today = await seedSchedule(petId, { name: "Today", nextDueAt: todayEnd - 1 });
    const upcoming = await seedSchedule(petId, { name: "Upcoming", nextDueAt: todayEnd + 3_600_000 });
    await seedSchedule(petId, { name: "Far", nextDueAt: todayEnd + 8 * DAY }); // beyond horizon
    await seedSchedule(petId, { name: "Done", nextDueAt: now - 60_000, active: false }); // inactive

    const { status, body } = await careStatus(petId, cookie, String(TZ));
    expect(status).toBe(200);
    expect(body.data.overdue.map((s) => s.id)).toEqual([overdue.scheduleId]);
    expect(body.data.today.map((s) => s.id)).toEqual([today.scheduleId]);
    expect(body.data.upcoming.map((s) => s.id)).toEqual([upcoming.scheduleId]);
  });

  it("defaults tz to 0 and rejects invalid tz values", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    await seedSchedule(petId, { nextDueAt: Date.now() - 60_000 });

    const ok = await careStatus(petId, cookie); // no tz param
    expect(ok.status).toBe(200);
    expect(ok.body.data.overdue).toHaveLength(1);

    for (const bad of ["abc", "900", "-900", "1.5"]) {
      const res = await careStatus(petId, cookie, bad);
      expect(res.status).toBe(400);
    }
  });

  it("is 404 for non-members", async () => {
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    const outsider = await seedUserWithSession({ email: "x@example.com" });
    const { status } = await careStatus(petId, outsider.cookie, "0");
    expect(status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w worker -- care-status`
Expected: FAIL — 404 on the care-status route.

- [ ] **Step 3: Create `worker/src/lib/tz.ts`**

```ts
/**
 * Parses the `tz` query param (household offset in minutes, positive east of
 * UTC — same convention as activities' tzOffsetMin). Absent ⇒ 0.
 */
export function parseTzQuery(raw: string | undefined): number | "invalid" {
  if (raw === undefined) return 0;
  const n = Number(raw);
  return Number.isInteger(n) && n >= -840 && n <= 840 ? n : "invalid";
}
```

- [ ] **Step 4: Add the care-status handler to `worker/src/routes/schedules.ts`**

Add the imports (`lt` joins the existing drizzle-orm import; `CareStatusResponse` joins the shared type import):

```ts
import { and, asc, desc, eq, lt } from "drizzle-orm";
import type { CareStatusResponse, CompleteScheduleResponse, ScheduleResponse } from "@pawlog/shared";
import { parseTzQuery } from "../lib/tz";
```

Then append the handler:

```ts
const DAY_MS = 86_400_000;

scheduleRoutes.get(
  "/api/pets/:petId/care-status",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const tz = parseTzQuery(c.req.query("tz"));
    if (tz === "invalid") {
      return err(c, 400, "validation", "tz must be an integer -840..840");
    }
    const now = Date.now();
    const tzMs = tz * 60_000;
    // next household midnight, as a UTC instant
    const todayEnd = Math.floor((now + tzMs) / DAY_MS) * DAY_MS + DAY_MS - tzMs;
    const horizon = todayEnd + 7 * DAY_MS;

    const db = drizzle(c.env.DB);
    // single range scan on idx_schedules_pet_active_due
    const rows = await db
      .select()
      .from(careSchedules)
      .where(
        and(
          eq(careSchedules.petId, c.get("petId")),
          eq(careSchedules.active, true),
          lt(careSchedules.nextDueAt, horizon),
        ),
      )
      .orderBy(asc(careSchedules.nextDueAt))
      .all();

    const data: CareStatusResponse = { overdue: [], today: [], upcoming: [] };
    for (const row of rows) {
      const bucket =
        row.nextDueAt < now ? data.overdue : row.nextDueAt < todayEnd ? data.today : data.upcoming;
      bucket.push(scheduleToResponse(row));
    }
    return c.json({ data });
  },
);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all suites; 3 new tests).

- [ ] **Step 6: Commit**

```bash
git add worker/src/lib/tz.ts worker/src/routes/schedules.ts worker/test/care-status.test.ts
git commit -m "feat: add care-status endpoint with household-day buckets"
```

---

### Task 6: Insights domain — window, ISO weeks, weight & intake bucketing (TDD)

**Files:**
- Create: `worker/src/domain/insights.ts`
- Test: `worker/test/insights-domain.test.ts`

Pure functions only — the SQL arrives in Task 7. The fold from household days to ISO weeks happens here in JS (one pass over ≤366 day-rows) rather than with SQLite `%G/%V`, which the deployed D1 SQLite version may not support.

- [ ] **Step 1: Write the failing test `worker/test/insights-domain.test.ts`**

```ts
import { isoWeekKey, isoWeekStartDay } from "@pawlog/shared";
import { describe, expect, it } from "vitest";
import {
  addDaysKey,
  buildIntakeMap,
  buildWeightSeries,
  dayKeyOfHousehold,
  periodWindow,
} from "../src/domain/insights";

// 2026-06-11 20:00 UTC = 2026-06-12 05:00 JST — household day differs from UTC day
const NOW = Date.UTC(2026, 5, 11, 20, 0);

describe("ISO week math (shared)", () => {
  it("computes ISO-8601 week keys across year boundaries", () => {
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01"); // Thursday
    expect(isoWeekKey("2025-12-29")).toBe("2026-W01"); // Monday of the same ISO week
    expect(isoWeekKey("2024-12-31")).toBe("2025-W01");
    expect(isoWeekKey("2026-06-08")).toBe("2026-W24"); // Monday
    expect(isoWeekKey("2026-06-12")).toBe("2026-W24"); // Friday, same week
  });

  it("round-trips through isoWeekStartDay", () => {
    expect(isoWeekStartDay("2026-W24")).toBe("2026-06-08");
    expect(isoWeekStartDay("2026-W01")).toBe("2025-12-29");
    expect(isoWeekKey(isoWeekStartDay("2025-W30"))).toBe("2025-W30");
  });
});

describe("dayKeyOfHousehold / addDaysKey", () => {
  it("uses the household clock, not UTC", () => {
    expect(dayKeyOfHousehold(NOW, 540)).toBe("2026-06-12");
    expect(dayKeyOfHousehold(NOW, 0)).toBe("2026-06-11");
    expect(dayKeyOfHousehold(NOW, -300)).toBe("2026-06-11");
  });

  it("does day arithmetic across month boundaries", () => {
    expect(addDaysKey("2026-06-01", -1)).toBe("2026-05-31");
    expect(addDaysKey("2026-05-16", 27)).toBe("2026-06-12");
  });
});

describe("periodWindow", () => {
  it("4w: 28 day buckets ending on the household today", () => {
    const win = periodWindow("4w", 540, NOW);
    expect(win.bucket).toBe("day");
    expect(win.buckets).toHaveLength(28);
    expect(win.buckets[0]).toBe("2026-05-16");
    expect(win.buckets[27]).toBe("2026-06-12");
    expect(win.todayKey).toBe("2026-06-12");
    expect(win.startMs).toBe(Date.UTC(2026, 4, 16));
    expect(win.endMs).toBe(Date.UTC(2026, 5, 13)); // exclusive
  });

  it("3m: 91 day buckets", () => {
    const win = periodWindow("3m", 540, NOW);
    expect(win.bucket).toBe("day");
    expect(win.buckets).toHaveLength(91);
    expect(win.buckets[90]).toBe("2026-06-12");
  });

  it("1y: consecutive ISO week buckets ending in the current week", () => {
    const win = periodWindow("1y", 540, NOW);
    expect(win.bucket).toBe("week");
    expect(win.buckets[win.buckets.length - 1]).toBe("2026-W24");
    expect(win.buckets.length).toBeGreaterThanOrEqual(52);
    expect(win.buckets.length).toBeLessThanOrEqual(54);
    expect(new Set(win.buckets).size).toBe(win.buckets.length); // no duplicates
  });
});

describe("buildWeightSeries", () => {
  it("day buckets: trailing 7-point average, min/max, pctChange", () => {
    const series = buildWeightSeries(
      [
        { day: "2026-06-01", kg: 4.0 },
        { day: "2026-06-03", kg: 4.2 },
        { day: "2026-06-05", kg: 4.4 },
      ],
      "day",
    );
    expect(series.points).toEqual([
      { bucket: "2026-06-01", kg: 4.0, avg7: 4.0 },
      { bucket: "2026-06-03", kg: 4.2, avg7: 4.1 },
      { bucket: "2026-06-05", kg: 4.4, avg7: 4.2 },
    ]);
    expect(series.min).toBe(4.0);
    expect(series.max).toBe(4.4);
    expect(series.pctChange).toBe(10); // (4.4 − 4.0) / 4.0
  });

  it("week buckets: keeps the latest weighing per ISO week", () => {
    const series = buildWeightSeries(
      [
        { day: "2026-06-08", kg: 4.0 }, // W24 …
        { day: "2026-06-10", kg: 4.3 }, // … superseded within W24
        { day: "2026-06-15", kg: 4.5 }, // W25
      ],
      "week",
    );
    expect(series.points.map((p) => [p.bucket, p.kg])).toEqual([
      ["2026-W24", 4.3],
      ["2026-W25", 4.5],
    ]);
  });

  it("single point ⇒ pctChange null; empty ⇒ all null", () => {
    expect(buildWeightSeries([{ day: "2026-06-01", kg: 4 }], "day").pctChange).toBeNull();
    expect(buildWeightSeries([], "day")).toEqual({
      points: [],
      min: null,
      max: null,
      pctChange: null,
    });
  });
});

describe("buildIntakeMap", () => {
  it("keys day sums by day, and folds into week sums for week buckets", () => {
    const rows = [
      { day: "2026-06-08", total: 60 },
      { day: "2026-06-10", total: 40 },
      { day: "2026-06-15", total: 55 },
    ];
    expect(buildIntakeMap(rows, "day")).toEqual({
      "2026-06-08": 60,
      "2026-06-10": 40,
      "2026-06-15": 55,
    });
    expect(buildIntakeMap(rows, "week")).toEqual({
      "2026-W24": 100,
      "2026-W25": 55,
    });
  });

  it("is sparse: an empty input stays an empty record (no fake zeros)", () => {
    expect(buildIntakeMap([], "day")).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w worker -- insights-domain`
Expected: FAIL — cannot resolve `../src/domain/insights`.

- [ ] **Step 3: Create `worker/src/domain/insights.ts`**

```ts
import type {
  InsightsPeriod,
  ToiletMatrixRow,
  WeightPoint,
  WeightSeries,
} from "@pawlog/shared";
import { TOILET_SEVERITY, isoWeekKey } from "@pawlog/shared";

const DAY_MS = 86_400_000;

export type BucketKind = "day" | "week";

export type InsightsWindow = {
  period: InsightsPeriod;
  bucket: BucketKind;
  /** every bucket key, oldest → the bucket containing today */
  buckets: string[];
  startKey: string;
  todayKey: string;
  /** household-naive epoch ms — compare against occurred_at + tz_offset_min*60000 */
  startMs: number;
  endMs: number; // exclusive
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Household calendar day ("YYYY-MM-DD") of an absolute instant. */
export function dayKeyOfHousehold(ms: number, tzOffsetMin: number): string {
  const d = new Date(ms + tzOffsetMin * 60_000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function dayKeyToMs(key: string): number {
  return Date.UTC(
    Number(key.slice(0, 4)),
    Number(key.slice(5, 7)) - 1,
    Number(key.slice(8, 10)),
  );
}

/** Day-key arithmetic in UTC space (no DST surprises). */
export function addDaysKey(key: string, n: number): string {
  const d = new Date(dayKeyToMs(key) + n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

const PERIOD_DAYS: Record<InsightsPeriod, number> = { "4w": 28, "3m": 91, "1y": 365 };

/** The analysis window for a period: day buckets for 4w/3m, ISO weeks for 1y
 *  (spec §7). The request tz anchors "today"; per-row tz buckets the data. */
export function periodWindow(
  period: InsightsPeriod,
  tzOffsetMin: number,
  now: number = Date.now(),
): InsightsWindow {
  const todayKey = dayKeyOfHousehold(now, tzOffsetMin);
  const days = PERIOD_DAYS[period];
  const startKey = addDaysKey(todayKey, -(days - 1));
  const bucket: BucketKind = period === "1y" ? "week" : "day";
  const buckets: string[] = [];
  let cursor = startKey;
  let lastWeek = "";
  for (let i = 0; i < days; i++) {
    if (bucket === "day") {
      buckets.push(cursor);
    } else {
      const wk = isoWeekKey(cursor);
      if (wk !== lastWeek) {
        buckets.push(wk);
        lastWeek = wk;
      }
    }
    cursor = addDaysKey(cursor, 1);
  }
  return {
    period,
    bucket,
    buckets,
    startKey,
    todayKey,
    startMs: dayKeyToMs(startKey),
    endMs: dayKeyToMs(todayKey) + DAY_MS,
  };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** rows: ≤1 per day (latest weighing), sorted ascending — the SQL guarantees
 *  both. Week buckets keep the week's latest weighing; avg7 is the trailing
 *  mean over up to the last 7 points (emitted from the first point). */
export function buildWeightSeries(
  rows: Array<{ day: string; kg: number }>,
  bucket: BucketKind,
): WeightSeries {
  const byBucket = new Map<string, number>();
  for (const row of rows) {
    // Map.set keeps first-insertion order; rows are ascending, so the last
    // write per bucket is the latest weighing and order stays chronological.
    byBucket.set(bucket === "day" ? row.day : isoWeekKey(row.day), row.kg);
  }
  const points: WeightPoint[] = [];
  const trailing: number[] = [];
  for (const [key, kg] of byBucket) {
    trailing.push(kg);
    if (trailing.length > 7) trailing.shift();
    points.push({
      bucket: key,
      kg,
      avg7: round2(trailing.reduce((a, b) => a + b, 0) / trailing.length),
    });
  }
  if (points.length === 0) return { points, min: null, max: null, pctChange: null };
  const kgs = points.map((p) => p.kg);
  const first = points[0]!.kg;
  const last = points[points.length - 1]!.kg;
  return {
    points,
    min: Math.min(...kgs),
    max: Math.max(...kgs),
    pctChange: points.length < 2 ? null : round1(((last - first) / first) * 100),
  };
}

/** Sparse map bucket → sum. An absent key means "not logged" — never 0
 *  (spec §7: hollow markers, not fake zeros). */
export function buildIntakeMap(
  rows: Array<{ day: string; total: number }>,
  bucket: BucketKind,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = bucket === "day" ? row.day : isoWeekKey(row.day);
    out[key] = round1((out[key] ?? 0) + row.total);
  }
  return out;
}

/** rows from the toilet GROUP BY (day, kind); `worst` is the severity rank
 *  0..4 (TOILET_SEVERITY index). Week buckets sum counts and keep the worst. */
export function buildToiletMatrix(
  rows: Array<{ day: string; kind: string; count: number; worst: number }>,
  bucket: BucketKind,
): ToiletMatrixRow[] {
  const map = new Map<string, ToiletMatrixRow>();
  for (const row of rows) {
    const key = bucket === "day" ? row.day : isoWeekKey(row.day);
    let entry = map.get(key);
    if (!entry) {
      entry = { bucket: key, pee: null, poop: null };
      map.set(key, entry);
    }
    const side = row.kind === "pee" ? "pee" : "poop";
    const prev = entry[side];
    const worstRank = Math.max(prev ? TOILET_SEVERITY.indexOf(prev.worst) : 0, row.worst);
    entry[side] = {
      count: (prev?.count ?? 0) + row.count,
      worst: TOILET_SEVERITY[worstRank] ?? "normal",
    };
  }
  return [...map.values()]; // ascending: rows arrive sorted by day
}
```

(`buildToiletMatrix` is implemented now because it shares the file; its tests arrive with the route in Task 7.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all suites; 11 new tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/domain/insights.ts worker/test/insights-domain.test.ts
git commit -m "feat: add insights domain bucketing for weight and intake"
```

---

### Task 7: Insights route — four datasets in one call (TDD)

**Files:**
- Create: `worker/src/routes/insights.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/insights.test.ts` (also covers `buildToiletMatrix` end-to-end)

`anomalies` is returned as `[]` in this task and wired up in Task 8 (which owns the rules) — the response type already carries the field, so nothing else changes shape later.

- [ ] **Step 1: Write the failing test `worker/test/insights.test.ts`**

```ts
import { SELF } from "cloudflare:test";
import type { InsightsResponse } from "@pawlog/shared";
import { describe, expect, it } from "vitest";
import { seedActivity, seedPet, seedUserWithSession } from "./helpers";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TZ = 540; // JST

/** Same day-key math the server uses — for computing expected bucket keys. */
function dayKey(ms: number, tz: number): string {
  const d = new Date(ms + tz * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

async function insights(petId: string, cookie: string, query = `period=4w&tz=${TZ}`) {
  const res = await SELF.fetch(`https://app.local/api/pets/${petId}/insights?${query}`, {
    headers: { Cookie: cookie },
  });
  return { status: res.status, body: (await res.json()) as { data: InsightsResponse } };
}

describe("GET /api/pets/:petId/insights", () => {
  it("returns the weight series with latest-per-day points and pct change", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    await seedActivity(petId, userId, { category: "weight", occurredAt: now - 10 * DAY, tzOffsetMin: TZ, details: { kg: 4.0 } });
    // two weighings on the same household day — only the later one counts
    await seedActivity(petId, userId, { category: "weight", occurredAt: now - 2 * DAY, tzOffsetMin: TZ, details: { kg: 9.9 } });
    await seedActivity(petId, userId, { category: "weight", occurredAt: now - 2 * DAY + HOUR, tzOffsetMin: TZ, details: { kg: 4.4 } });

    const { status, body } = await insights(petId, cookie);
    expect(status).toBe(200);
    expect(body.data.period).toBe("4w");
    expect(body.data.bucket).toBe("day");
    expect(body.data.buckets).toHaveLength(28);
    expect(body.data.weight.points.map((p) => [p.bucket, p.kg])).toEqual([
      [dayKey(now - 10 * DAY, TZ), 4.0],
      [dayKey(now - 2 * DAY + HOUR, TZ), 4.4],
    ]);
    expect(body.data.weight.min).toBe(4.0);
    expect(body.data.weight.max).toBe(4.4);
    expect(body.data.weight.pctChange).toBe(10);
  });

  it("intake: sums food grams (g only) and water ml per day; absent ≠ zero", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    const day = dayKey(now - DAY, TZ);
    await seedActivity(petId, userId, { category: "food", occurredAt: now - DAY, tzOffsetMin: TZ, details: { foodType: "dry", unit: "g", amount: 60 } });
    await seedActivity(petId, userId, { category: "food", occurredAt: now - DAY + HOUR, tzOffsetMin: TZ, details: { foodType: "wet", unit: "g", amount: 40 } });
    await seedActivity(petId, userId, { category: "food", occurredAt: now - DAY, tzOffsetMin: TZ, details: { foodType: "wet", unit: "ml", amount: 500 } }); // ml excluded
    await seedActivity(petId, userId, { category: "food", occurredAt: now - DAY, tzOffsetMin: TZ, details: { foodType: "treat", unit: "pieces", amount: 3 } }); // pieces excluded
    await seedActivity(petId, userId, { category: "food", occurredAt: now - DAY, tzOffsetMin: TZ, details: { foodType: "dry", unit: "g" } }); // no amount → excluded
    await seedActivity(petId, userId, { category: "water", occurredAt: now - DAY, tzOffsetMin: TZ, details: { amountMl: 120 } });

    const { body } = await insights(petId, cookie);
    expect(body.data.intake.food).toEqual({ [day]: 100 });
    expect(body.data.intake.water).toEqual({ [day]: 120 });
    expect(body.data.intake.targets).toBeNull(); // none set for this pet
  });

  it("toilet matrix: per-day cells with count and worst condition", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    const day = dayKey(now - DAY, TZ);
    await seedActivity(petId, userId, { category: "toilet", occurredAt: now - DAY, tzOffsetMin: TZ, details: { kind: "poop", condition: "normal" } });
    await seedActivity(petId, userId, { category: "toilet", occurredAt: now - DAY + HOUR, tzOffsetMin: TZ, details: { kind: "poop", condition: "diarrhea" } });
    await seedActivity(petId, userId, { category: "toilet", occurredAt: now - DAY, tzOffsetMin: TZ, details: { kind: "pee", condition: "normal" } });

    const { body } = await insights(petId, cookie);
    const row = body.data.toilet.find((r) => r.bucket === day);
    expect(row?.poop).toEqual({ count: 2, worst: "diarrhea" });
    expect(row?.pee).toEqual({ count: 1, worst: "normal" });
  });

  it("timeline: medication/symptom spans grouped by name, vet visits as markers", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    await seedActivity(petId, userId, { category: "medication", occurredAt: now - 5 * DAY, tzOffsetMin: TZ, details: { name: "Antibiotic" } });
    await seedActivity(petId, userId, { category: "medication", occurredAt: now - 2 * DAY, tzOffsetMin: TZ, details: { name: "Antibiotic" } });
    await seedActivity(petId, userId, { category: "symptom", occurredAt: now - 4 * DAY, tzOffsetMin: TZ, details: { name: "Limping", severity: "mild" } });
    await seedActivity(petId, userId, { category: "symptom", occurredAt: now - 3 * DAY, tzOffsetMin: TZ, details: { name: "Limping", severity: "severe" } });
    await seedActivity(petId, userId, { category: "vet_visit", occurredAt: now - 3 * DAY, tzOffsetMin: TZ, details: { clinic: "Sakura Clinic" } });

    const { body } = await insights(petId, cookie);
    const med = body.data.timeline.medications[0];
    expect(med?.name).toBe("Antibiotic");
    expect(med?.count).toBe(2);
    expect(med?.firstAt).toBe(now - 5 * DAY + TZ * 60_000); // household-naive ms
    expect(med?.lastAt).toBe(now - 2 * DAY + TZ * 60_000);
    const sym = body.data.timeline.symptoms[0];
    expect(sym?.maxSeverity).toBe("severe");
    expect(body.data.timeline.vetVisits).toEqual([
      { at: now - 3 * DAY + TZ * 60_000, clinic: "Sakura Clinic" },
    ]);
    expect(body.data.windowEnd).toBeGreaterThan(body.data.windowStart);
  });

  it("1y uses ISO week buckets", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    await seedActivity(petId, userId, { category: "weight", occurredAt: now - 10 * DAY, tzOffsetMin: TZ, details: { kg: 4.0 } });
    await seedActivity(petId, userId, { category: "weight", occurredAt: now - DAY, tzOffsetMin: TZ, details: { kg: 4.2 } });
    const { body } = await insights(petId, cookie, `period=1y&tz=${TZ}`);
    expect(body.data.bucket).toBe("week");
    for (const p of body.data.weight.points) {
      expect(p.bucket).toMatch(/^\d{4}-W\d{2}$/);
      expect(body.data.buckets).toContain(p.bucket);
    }
  });

  it("returns pet targets when set", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const put = await SELF.fetch(`https://app.local/api/pets/${petId}/targets`, {
      method: "PUT",
      headers: { Cookie: cookie, "X-CSRF-Token": csrfToken, "Content-Type": "application/json" },
      body: JSON.stringify({ foodGPerDay: 60, waterMlPerDay: 250 }),
    });
    expect(put.status).toBe(200);
    const { body } = await insights(petId, cookie);
    expect(body.data.intake.targets).toEqual({ foodGPerDay: 60, waterMlPerDay: 250 });
  });

  it("validates period and tz, and 404s non-members", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    for (const q of ["", "period=2w", "period=4w&tz=abc", "period=4w&tz=900"]) {
      const res = await insights(petId, cookie, q);
      expect(res.status).toBe(400);
    }
    const outsider = await seedUserWithSession({ email: "x@example.com" });
    const probe = await insights(petId, outsider.cookie);
    expect(probe.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w worker -- insights.test`
Expected: FAIL — 404 on the insights route.

- [ ] **Step 3: Create `worker/src/routes/insights.ts`**

```ts
import type {
  Anomaly,
  CareSpan,
  InsightsPeriod,
  InsightsResponse,
  SymptomSpan,
  VetMarker,
} from "@pawlog/shared";
import { INSIGHTS_PERIODS } from "@pawlog/shared";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { petTargets } from "../db/schema";
import {
  buildIntakeMap,
  buildToiletMatrix,
  buildWeightSeries,
  periodWindow,
} from "../domain/insights";
import type { AppEnv } from "../env";
import { err } from "../lib/respond";
import { parseTzQuery } from "../lib/tz";
import { requirePetRole } from "../middleware/pet-access";
import { requireSession } from "../middleware/session";

export const insightRoutes = new Hono<AppEnv>();

const SEVERITY_RANK = ["mild", "moderate", "severe"] as const;

insightRoutes.get(
  "/api/pets/:petId/insights",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const period = c.req.query("period");
    if (!period || !(INSIGHTS_PERIODS as readonly string[]).includes(period)) {
      return err(c, 400, "validation", "period must be 4w|3m|1y");
    }
    const tz = parseTzQuery(c.req.query("tz"));
    if (tz === "invalid") {
      return err(c, 400, "validation", "tz must be an integer -840..840");
    }
    const win = periodWindow(period as InsightsPeriod, tz);
    const petId = c.get("petId");
    const db = drizzle(c.env.DB);

    // All bucketing uses the per-row household expression — identical to /summary.
    // Window bounds are household-naive ms, so they compare against the same expression.

    // latest weighing per household day
    const weightRows = await db.all<{ day: string; kg: number }>(sql`
      SELECT day, kg FROM (
        SELECT date((occurred_at + tz_offset_min * 60000) / 1000, 'unixepoch') AS day,
               CAST(json_extract(details, '$.kg') AS REAL) AS kg,
               ROW_NUMBER() OVER (
                 PARTITION BY date((occurred_at + tz_offset_min * 60000) / 1000, 'unixepoch')
                 ORDER BY occurred_at DESC
               ) AS rn
        FROM activities
        WHERE pet_id = ${petId} AND category = 'weight' AND deleted_at IS NULL
          AND occurred_at + tz_offset_min * 60000 >= ${win.startMs}
          AND occurred_at + tz_offset_min * 60000 < ${win.endMs}
      ) WHERE rn = 1 ORDER BY day
    `);

    // food grams per day — unit='g' only (locked decision; ml/pieces can't sum into grams)
    const foodRows = await db.all<{ day: string; total: number }>(sql`
      SELECT date((occurred_at + tz_offset_min * 60000) / 1000, 'unixepoch') AS day,
             SUM(CAST(json_extract(details, '$.amount') AS REAL)) AS total
      FROM activities
      WHERE pet_id = ${petId} AND category = 'food' AND deleted_at IS NULL
        AND json_extract(details, '$.unit') = 'g'
        AND json_extract(details, '$.amount') IS NOT NULL
        AND occurred_at + tz_offset_min * 60000 >= ${win.startMs}
        AND occurred_at + tz_offset_min * 60000 < ${win.endMs}
      GROUP BY day ORDER BY day
    `);

    const waterRows = await db.all<{ day: string; total: number }>(sql`
      SELECT date((occurred_at + tz_offset_min * 60000) / 1000, 'unixepoch') AS day,
             SUM(CAST(json_extract(details, '$.amountMl') AS REAL)) AS total
      FROM activities
      WHERE pet_id = ${petId} AND category = 'water' AND deleted_at IS NULL
        AND occurred_at + tz_offset_min * 60000 >= ${win.startMs}
        AND occurred_at + tz_offset_min * 60000 < ${win.endMs}
      GROUP BY day ORDER BY day
    `);

    // per (day, kind): count + worst condition rank (TOILET_SEVERITY order)
    const toiletRows = await db.all<{ day: string; kind: string; count: number; worst: number }>(sql`
      SELECT date((occurred_at + tz_offset_min * 60000) / 1000, 'unixepoch') AS day,
             json_extract(details, '$.kind') AS kind,
             COUNT(*) AS count,
             MAX(CASE json_extract(details, '$.condition')
               WHEN 'normal' THEN 0 WHEN 'soft' THEN 1 WHEN 'hard' THEN 2
               WHEN 'diarrhea' THEN 3 WHEN 'bloody' THEN 4 ELSE 0 END) AS worst
      FROM activities
      WHERE pet_id = ${petId} AND category = 'toilet' AND deleted_at IS NULL
        AND occurred_at + tz_offset_min * 60000 >= ${win.startMs}
        AND occurred_at + tz_offset_min * 60000 < ${win.endMs}
      GROUP BY day, kind ORDER BY day
    `);

    // span/marker times are household-naive ms — same axis space as the window
    const medRows = await db.all<{ name: string; firstAt: number; lastAt: number; count: number }>(sql`
      SELECT json_extract(details, '$.name') AS name,
             MIN(occurred_at + tz_offset_min * 60000) AS firstAt,
             MAX(occurred_at + tz_offset_min * 60000) AS lastAt,
             COUNT(*) AS count
      FROM activities
      WHERE pet_id = ${petId} AND category = 'medication' AND deleted_at IS NULL
        AND json_extract(details, '$.name') IS NOT NULL
        AND occurred_at + tz_offset_min * 60000 >= ${win.startMs}
        AND occurred_at + tz_offset_min * 60000 < ${win.endMs}
      GROUP BY name ORDER BY firstAt
    `);

    const symRows = await db.all<{
      name: string;
      firstAt: number;
      lastAt: number;
      count: number;
      sev: number;
    }>(sql`
      SELECT json_extract(details, '$.name') AS name,
             MIN(occurred_at + tz_offset_min * 60000) AS firstAt,
             MAX(occurred_at + tz_offset_min * 60000) AS lastAt,
             COUNT(*) AS count,
             MAX(CASE json_extract(details, '$.severity')
               WHEN 'mild' THEN 0 WHEN 'moderate' THEN 1 WHEN 'severe' THEN 2 ELSE 0 END) AS sev
      FROM activities
      WHERE pet_id = ${petId} AND category = 'symptom' AND deleted_at IS NULL
        AND json_extract(details, '$.name') IS NOT NULL
        AND occurred_at + tz_offset_min * 60000 >= ${win.startMs}
        AND occurred_at + tz_offset_min * 60000 < ${win.endMs}
      GROUP BY name ORDER BY firstAt
    `);

    const vetRows = await db.all<{ at: number; clinic: string | null }>(sql`
      SELECT occurred_at + tz_offset_min * 60000 AS at,
             json_extract(details, '$.clinic') AS clinic
      FROM activities
      WHERE pet_id = ${petId} AND category = 'vet_visit' AND deleted_at IS NULL
        AND occurred_at + tz_offset_min * 60000 >= ${win.startMs}
        AND occurred_at + tz_offset_min * 60000 < ${win.endMs}
      ORDER BY at
    `);

    const targets = await db
      .select()
      .from(petTargets)
      .where(eq(petTargets.petId, petId))
      .get();

    const medications: CareSpan[] = medRows.map((r) => ({
      name: r.name,
      firstAt: r.firstAt,
      lastAt: r.lastAt,
      count: r.count,
    }));
    const symptoms: SymptomSpan[] = symRows.map((r) => ({
      name: r.name,
      firstAt: r.firstAt,
      lastAt: r.lastAt,
      count: r.count,
      maxSeverity: SEVERITY_RANK[r.sev] ?? "mild",
    }));
    const vetVisits: VetMarker[] = vetRows.map((r) => ({ at: r.at, clinic: r.clinic }));

    const anomalies: Anomaly[] = []; // wired up in the anomalies task

    const data: InsightsResponse = {
      period: win.period,
      bucket: win.bucket,
      buckets: win.buckets,
      windowStart: win.startMs,
      windowEnd: win.endMs,
      weight: buildWeightSeries(weightRows, win.bucket),
      intake: {
        food: buildIntakeMap(foodRows, win.bucket),
        water: buildIntakeMap(waterRows, win.bucket),
        targets: targets
          ? { foodGPerDay: targets.foodGPerDay, waterMlPerDay: targets.waterMlPerDay }
          : null,
      },
      toilet: buildToiletMatrix(toiletRows, win.bucket),
      timeline: { medications, symptoms, vetVisits },
      anomalies,
    };
    return c.json({ data });
  },
);
```

- [ ] **Step 4: Mount in `worker/src/index.ts`**

```ts
import { insightRoutes } from "./routes/insights";
```

```ts
app.route("/", insightRoutes);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all suites; 7 new tests).

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/insights.ts worker/src/index.ts worker/test/insights.test.ts
git commit -m "feat: add insights endpoint with toilet matrix and care timeline"
```

---

### Task 8: Anomaly rules + endpoint, wired into insights (TDD)

**Files:**
- Create: `worker/src/domain/anomalies.ts`
- Modify: `worker/src/routes/insights.ts`
- Test: `worker/test/anomalies.test.ts`

The four spec §7 rules as pure functions (table-driven tests) + one input loader running four cheap queries. `GET /api/pets/:petId/anomalies?tz=` serves the Home banner; the insights handler calls the same loader + evaluator so the Health tab gets identical flags.

- [ ] **Step 1: Write the failing test `worker/test/anomalies.test.ts`**

```ts
import { SELF } from "cloudflare:test";
import type { AnomaliesResponse, Anomaly, InsightsResponse } from "@pawlog/shared";
import { describe, expect, it } from "vitest";
import {
  quietDay,
  symptomStreaks,
  toiletTrouble,
  weightDrift,
} from "../src/domain/anomalies";
import { seedActivity, seedPet, seedUserWithSession } from "./helpers";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 5, 11, 12, 0);

describe("weightDrift (rule 1)", () => {
  const w = (daysAgo: number, kg: number) => ({ occurredAt: NOW - daysAgo * DAY, kg });

  it.each([
    // [name, weighings, expected pctChange or null]
    ["−6.1% drop triggers", [w(30, 4.6), w(2, 4.3), w(1, 4.34)], -6.1],
    ["exactly −5.0% triggers (≥ threshold)", [w(30, 4.0), w(1, 3.8)], -5.0],
    ["+5.5% rise triggers too", [w(30, 4.0), w(1, 4.22)], 5.5],
    ["−4.8% stays quiet", [w(30, 4.6), w(2, 4.4), w(1, 4.36)], null],
    ["no baseline weighing → null (needs ≥2 weighings)", [w(2, 4.3)], null],
    ["no recent weighing → null", [w(30, 4.6)], null],
    ["baseline outside the 23–37d window is ignored", [w(40, 5.0), w(1, 4.0)], null],
  ] as Array<[string, Array<{ occurredAt: number; kg: number }>, number | null]>)(
    "%s",
    (_name, weighings, expected) => {
      const result = weightDrift(weighings, NOW);
      if (expected === null) {
        expect(result).toBeNull();
      } else {
        expect(result).toEqual({
          rule: "weight_drift",
          severity: "warning",
          params: { pctChange: expected },
        });
      }
    },
  );

  it("averages multiple weighings inside each window", () => {
    // recent mean (4.3 + 4.5)/2 = 4.4 vs baseline mean (5.0 + 4.6)/2 = 4.8 → −8.3%
    const result = weightDrift(
      [w(30, 5.0), w(28, 4.6), w(3, 4.3), w(1, 4.5)],
      NOW,
    );
    expect(result?.params).toEqual({ pctChange: -8.3 });
  });
});

describe("toiletTrouble (rule 2)", () => {
  it.each([
    [0, null],
    [1, null],
    [2, 2],
    [5, 5],
  ] as Array<[number, number | null]>)("count %i", (count, expected) => {
    const result = toiletTrouble(count);
    if (expected === null) expect(result).toBeNull();
    else
      expect(result).toEqual({
        rule: "toilet_trouble",
        severity: "warning",
        params: { count: expected },
      });
  });
});

describe("quietDay (rule 3)", () => {
  // NOW is 12:00 UTC; tz 540 → 21:00 household, tz 300 → 17:00 household
  it("fires only at/after 18:00 household with zero food AND water", () => {
    expect(quietDay(0, 0, NOW, 540)).toEqual({
      rule: "quiet_day",
      severity: "info",
      params: {},
    });
    expect(quietDay(0, 0, NOW, 300)).toBeNull(); // 17:00 — too early
    expect(quietDay(1, 0, NOW, 540)).toBeNull(); // food was logged
    expect(quietDay(0, 2, NOW, 540)).toBeNull(); // water was logged
  });

  it("handles negative household offsets", () => {
    // 12:00 UTC − 14:00 = 22:00 previous household day → fires
    expect(quietDay(0, 0, NOW, -840)).not.toBeNull();
  });
});

describe("symptomStreaks (rule 4)", () => {
  const today = "2026-06-11";
  const d = (name: string, day: string) => ({ name, day });

  it("fires on ≥3 consecutive days ending today, with the run length", () => {
    const rows = [d("Limping", "2026-06-09"), d("Limping", "2026-06-10"), d("Limping", "2026-06-11")];
    expect(symptomStreaks(rows, today)).toEqual([
      { rule: "symptom_streak", severity: "warning", params: { name: "Limping", days: 3 } },
    ]);
  });

  it("a run ending yesterday still fires; a gap breaks the run", () => {
    const endsYesterday = [
      d("Cough", "2026-06-07"),
      d("Cough", "2026-06-08"),
      d("Cough", "2026-06-09"),
      d("Cough", "2026-06-10"),
    ];
    expect(symptomStreaks(endsYesterday, today)[0]?.params).toEqual({ name: "Cough", days: 4 });

    const gap = [d("Cough", "2026-06-07"), d("Cough", "2026-06-09"), d("Cough", "2026-06-10")];
    expect(symptomStreaks(gap, today)).toEqual([]); // only 2 consecutive reach yesterday
  });

  it("a stale run (ended 3 days ago) and short runs stay quiet; names are independent", () => {
    const stale = [d("Itch", "2026-06-06"), d("Itch", "2026-06-07"), d("Itch", "2026-06-08")];
    expect(symptomStreaks(stale, today)).toEqual([]);
    const short = [d("Itch", "2026-06-10"), d("Itch", "2026-06-11")];
    expect(symptomStreaks(short, today)).toEqual([]);
    const two = [
      d("Itch", "2026-06-09"), d("Itch", "2026-06-10"), d("Itch", "2026-06-11"),
      d("Limp", "2026-06-09"), d("Limp", "2026-06-10"), d("Limp", "2026-06-11"),
    ];
    expect(symptomStreaks(two, today)).toHaveLength(2);
  });
});

describe("GET /api/pets/:petId/anomalies (+ insights integration)", () => {
  /** A tz (valid −840..840) that puts the household clock at 18:00–22:59 right now. */
  function eveningTz(now: number): number {
    for (let tz = -840; tz <= 840; tz += 30) {
      const hour = Math.floor((((now + tz * 60_000) % DAY) + DAY) % DAY / HOUR);
      if (hour >= 18 && hour <= 22) return tz;
    }
    throw new Error("unreachable: ±14h covers every hour");
  }

  it("returns structured anomalies from minimal queries", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    const tz = eveningTz(now);
    // toilet trouble: 2 diarrhea in the last 72 h
    await seedActivity(petId, userId, { category: "toilet", occurredAt: now - HOUR, tzOffsetMin: tz, details: { kind: "poop", condition: "diarrhea" } });
    await seedActivity(petId, userId, { category: "toilet", occurredAt: now - 2 * DAY, tzOffsetMin: tz, details: { kind: "poop", condition: "bloody" } });
    // symptom streak: 3 consecutive household days ending today
    for (const back of [0, 1, 2]) {
      await seedActivity(petId, userId, { category: "symptom", occurredAt: now - back * DAY, tzOffsetMin: tz, details: { name: "Limping", severity: "mild" } });
    }
    // no food/water today + evening tz ⇒ quiet day

    const res = await SELF.fetch(`https://app.local/api/pets/${petId}/anomalies?tz=${tz}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: AnomaliesResponse };
    const byRule = new Map(data.anomalies.map((a) => [a.rule, a]));
    expect(byRule.get("toilet_trouble")?.params).toEqual({ count: 2 });
    expect(byRule.get("quiet_day")?.severity).toBe("info");
    const streak = byRule.get("symptom_streak") as Extract<Anomaly, { rule: "symptom_streak" }>;
    expect(streak.params.name).toBe("Limping");
    expect(streak.params.days).toBeGreaterThanOrEqual(3);
  });

  it("quiet day disappears once water is logged today", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    const tz = eveningTz(now);
    await seedActivity(petId, userId, { category: "water", occurredAt: now - HOUR, tzOffsetMin: tz, details: { amountMl: 100 } });
    const res = await SELF.fetch(`https://app.local/api/pets/${petId}/anomalies?tz=${tz}`, {
      headers: { Cookie: cookie },
    });
    const { data } = (await res.json()) as { data: AnomaliesResponse };
    expect(data.anomalies.find((a) => a.rule === "quiet_day")).toBeUndefined();
  });

  it("insights returns the same anomalies; anomalies endpoint validates tz and 404s outsiders", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    await seedActivity(petId, userId, { category: "toilet", occurredAt: now - HOUR, tzOffsetMin: 0, details: { kind: "poop", condition: "diarrhea" } });
    await seedActivity(petId, userId, { category: "toilet", occurredAt: now - 2 * HOUR, tzOffsetMin: 0, details: { kind: "poop", condition: "diarrhea" } });

    const ins = await SELF.fetch(`https://app.local/api/pets/${petId}/insights?period=4w&tz=0`, {
      headers: { Cookie: cookie },
    });
    const { data } = (await ins.json()) as { data: InsightsResponse };
    expect(data.anomalies.find((a) => a.rule === "toilet_trouble")?.params).toEqual({ count: 2 });

    const bad = await SELF.fetch(`https://app.local/api/pets/${petId}/anomalies?tz=abc`, {
      headers: { Cookie: cookie },
    });
    expect(bad.status).toBe(400);
    const outsider = await seedUserWithSession({ email: "x@example.com" });
    const probe = await SELF.fetch(`https://app.local/api/pets/${petId}/anomalies?tz=0`, {
      headers: { Cookie: outsider.cookie },
    });
    expect(probe.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w worker -- anomalies`
Expected: FAIL — cannot resolve `../src/domain/anomalies`.

- [ ] **Step 3: Create `worker/src/domain/anomalies.ts`**

```ts
import type { Anomaly } from "@pawlog/shared";
import { sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { addDaysKey, dayKeyOfHousehold } from "./insights";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type AnomalyInputs = {
  /** weight activities of the last 37 days (absolute time), ascending */
  weighings: Array<{ occurredAt: number; kg: number }>;
  /** diarrhea/bloody toilet activities in the last 72 hours */
  troubleCount: number;
  /** food / water activities on TODAY's household day */
  foodCountToday: number;
  waterCountToday: number;
  /** distinct (household day, symptom name) pairs of the last 30 days */
  symptomDays: Array<{ day: string; name: string }>;
};

/**
 * Rule 1 — weight drift (spec §7): mean of the weighings in the last 7 days
 * vs the mean of a 14-day baseline window centered 30 days ago ([now−37d,
 * now−23d]); |Δ| ≥ 5% fires. Needs ≥1 weighing in EACH window — the windows
 * are disjoint, so that is the spec's "≥2 weighings".
 */
export function weightDrift(
  weighings: Array<{ occurredAt: number; kg: number }>,
  now: number,
): Anomaly | null {
  const recent = weighings.filter((w) => w.occurredAt >= now - 7 * DAY_MS);
  const baseline = weighings.filter(
    (w) => w.occurredAt >= now - 37 * DAY_MS && w.occurredAt <= now - 23 * DAY_MS,
  );
  if (recent.length === 0 || baseline.length === 0) return null;
  const mean = (xs: Array<{ kg: number }>) => xs.reduce((a, x) => a + x.kg, 0) / xs.length;
  const pct = ((mean(recent) - mean(baseline)) / mean(baseline)) * 100;
  if (Math.abs(pct) < 5) return null;
  return {
    rule: "weight_drift",
    severity: "warning",
    params: { pctChange: Math.round(pct * 10) / 10 },
  };
}

/** Rule 2 — toilet trouble: diarrhea or bloody ≥2× within a rolling 72 h. */
export function toiletTrouble(troubleCount: number): Anomaly | null {
  if (troubleCount < 2) return null;
  return { rule: "toilet_trouble", severity: "warning", params: { count: troubleCount } };
}

/** Rule 3 — quiet day: no food AND no water logged today by 18:00 household. */
export function quietDay(
  foodCountToday: number,
  waterCountToday: number,
  now: number,
  tzOffsetMin: number,
): Anomaly | null {
  const local = now + tzOffsetMin * 60_000;
  const hour = Math.floor((((local % DAY_MS) + DAY_MS) % DAY_MS) / HOUR_MS);
  if (hour < 18) return null;
  if (foodCountToday > 0 || waterCountToday > 0) return null;
  return { rule: "quiet_day", severity: "info", params: {} };
}

/**
 * Rule 4 — symptom streak: the same symptom name on ≥3 consecutive household
 * days, with the run still current (its last day is today or yesterday —
 * otherwise old streaks would flag forever). One anomaly per qualifying name.
 */
export function symptomStreaks(
  symptomDays: Array<{ day: string; name: string }>,
  todayKey: string,
): Anomaly[] {
  const byName = new Map<string, Set<string>>();
  for (const row of symptomDays) {
    if (!row.name) continue;
    let days = byName.get(row.name);
    if (!days) {
      days = new Set();
      byName.set(row.name, days);
    }
    days.add(row.day);
  }
  const out: Anomaly[] = [];
  for (const [name, days] of byName) {
    let cursor = days.has(todayKey) ? todayKey : addDaysKey(todayKey, -1);
    if (!days.has(cursor)) continue; // run doesn't reach today/yesterday
    let run = 0;
    while (days.has(cursor)) {
      run++;
      cursor = addDaysKey(cursor, -1);
    }
    if (run >= 3) {
      out.push({ rule: "symptom_streak", severity: "warning", params: { name, days: run } });
    }
  }
  return out;
}

/** Four cheap, index-friendly queries — this is everything the rules need. */
export async function loadAnomalyInputs(
  db: DrizzleD1Database,
  petId: string,
  tzOffsetMin: number,
  now: number,
): Promise<AnomalyInputs> {
  const todayKey = dayKeyOfHousehold(now, tzOffsetMin);
  const weighings = await db.all<{ occurredAt: number; kg: number }>(sql`
    SELECT occurred_at AS occurredAt, CAST(json_extract(details, '$.kg') AS REAL) AS kg
    FROM activities
    WHERE pet_id = ${petId} AND category = 'weight' AND deleted_at IS NULL
      AND occurred_at >= ${now - 37 * DAY_MS}
    ORDER BY occurred_at
  `);
  const trouble = await db.all<{ n: number }>(sql`
    SELECT COUNT(*) AS n FROM activities
    WHERE pet_id = ${petId} AND category = 'toilet' AND deleted_at IS NULL
      AND json_extract(details, '$.condition') IN ('diarrhea', 'bloody')
      AND occurred_at >= ${now - 3 * DAY_MS}
  `);
  const food = await db.all<{ n: number }>(sql`
    SELECT COUNT(*) AS n FROM activities
    WHERE pet_id = ${petId} AND category = 'food' AND deleted_at IS NULL
      AND date((occurred_at + tz_offset_min * 60000) / 1000, 'unixepoch') = ${todayKey}
  `);
  const water = await db.all<{ n: number }>(sql`
    SELECT COUNT(*) AS n FROM activities
    WHERE pet_id = ${petId} AND category = 'water' AND deleted_at IS NULL
      AND date((occurred_at + tz_offset_min * 60000) / 1000, 'unixepoch') = ${todayKey}
  `);
  const symptomDays = await db.all<{ day: string; name: string }>(sql`
    SELECT DISTINCT date((occurred_at + tz_offset_min * 60000) / 1000, 'unixepoch') AS day,
           json_extract(details, '$.name') AS name
    FROM activities
    WHERE pet_id = ${petId} AND category = 'symptom' AND deleted_at IS NULL
      AND occurred_at >= ${now - 30 * DAY_MS}
  `);
  return {
    weighings,
    troubleCount: trouble[0]?.n ?? 0,
    foodCountToday: food[0]?.n ?? 0,
    waterCountToday: water[0]?.n ?? 0,
    symptomDays,
  };
}

/** Stable order: weight → toilet → quiet → symptom streaks. */
export function evaluateAnomalies(
  inputs: AnomalyInputs,
  now: number,
  tzOffsetMin: number,
): Anomaly[] {
  const out: Anomaly[] = [];
  const drift = weightDrift(inputs.weighings, now);
  if (drift) out.push(drift);
  const trouble = toiletTrouble(inputs.troubleCount);
  if (trouble) out.push(trouble);
  const quiet = quietDay(inputs.foodCountToday, inputs.waterCountToday, now, tzOffsetMin);
  if (quiet) out.push(quiet);
  out.push(...symptomStreaks(inputs.symptomDays, dayKeyOfHousehold(now, tzOffsetMin)));
  return out;
}
```

- [ ] **Step 4: Wire anomalies into `worker/src/routes/insights.ts`**

Add the imports:

```ts
import type { AnomaliesResponse } from "@pawlog/shared";
import { evaluateAnomalies, loadAnomalyInputs } from "../domain/anomalies";
```

In the insights handler, replace

```ts
    const anomalies: Anomaly[] = []; // wired up in the anomalies task
```

with

```ts
    const now = Date.now();
    const anomalies: Anomaly[] = evaluateAnomalies(
      await loadAnomalyInputs(db, petId, tz, now),
      now,
      tz,
    );
```

Then append the lightweight endpoint (the Home banner's only call):

```ts
insightRoutes.get(
  "/api/pets/:petId/anomalies",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const tz = parseTzQuery(c.req.query("tz"));
    if (tz === "invalid") {
      return err(c, 400, "validation", "tz must be an integer -840..840");
    }
    const now = Date.now();
    const db = drizzle(c.env.DB);
    const inputs = await loadAnomalyInputs(db, c.get("petId"), tz, now);
    const data: AnomaliesResponse = { anomalies: evaluateAnomalies(inputs, now, tz) };
    return c.json({ data });
  },
);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS (all suites; ~20 new tests incl. the table-driven cases).

- [ ] **Step 6: Commit**

```bash
git add worker/src/domain/anomalies.ts worker/src/routes/insights.ts worker/test/anomalies.test.ts
git commit -m "feat: add anomaly rules and anomalies endpoint"
```

---

### Task 9: Frontend API hooks + i18n catalog + date helpers

**Files:**
- Modify: `app/src/api/keys.ts`
- Create: `app/src/api/schedules.ts`
- Create: `app/src/api/insights.ts`
- Modify: `app/src/api/activities.ts` (invalidation only)
- Modify: `app/src/lib/dates.ts`
- Modify: `app/src/i18n/messages.ts`, `app/src/i18n/en.ts`, `app/src/i18n/ja.ts`
- Modify: `app/test/dates.test.ts`

This task only ADDS i18n keys. The Plan-3 placeholder keys (`health.soonTitle`/`soonBody`, `home.careSoonTitle`/`careSoonBody`) stay until the screens that use them are rewritten (Tasks 12 and 13) — removing them now would break typecheck.

- [ ] **Step 1: Extend `app/src/api/keys.ts`**

Append inside the `keys` object:

```ts
  schedules: (petId: string) => ["schedules", petId] as const,
  careStatus: (petId: string) => ["care-status", petId] as const,
  insightsRoot: (petId: string) => ["insights", petId] as const,
  insights: (petId: string, period: string) => ["insights", petId, period] as const,
  anomalies: (petId: string) => ["anomalies", petId] as const,
```

And extend the doc comment's invalidation rules:

```
 *   schedule create/update/delete   → ["schedules", petId] + ["care-status", petId]
 *   schedule complete               → schedules + care-status + activities + summary + insights + anomalies
 *   activity create/update/delete   → (as before) + ["insights", petId] + ["anomalies", petId]
```

- [ ] **Step 2: Create `app/src/api/schedules.ts`**

```ts
import type {
  CareStatusResponse,
  CompleteScheduleInput,
  CompleteScheduleResponse,
  CreateScheduleInput,
  ScheduleResponse,
  UpdateScheduleInput,
} from "@pawlog/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deviceTzOffsetMin } from "../lib/dates";
import { api } from "./client";
import { keys } from "./keys";

export function useSchedules(petId: string) {
  return useQuery({
    queryKey: keys.schedules(petId),
    queryFn: () => api<ScheduleResponse[]>(`/api/pets/${petId}/schedules`),
  });
}

export function useCareStatus(petId: string) {
  return useQuery({
    queryKey: keys.careStatus(petId),
    queryFn: () =>
      api<CareStatusResponse>(`/api/pets/${petId}/care-status?tz=${deviceTzOffsetMin()}`),
    staleTime: 60_000,
  });
}

async function invalidateCare(
  qc: ReturnType<typeof useQueryClient>,
  petId: string,
): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: keys.schedules(petId) }),
    qc.invalidateQueries({ queryKey: keys.careStatus(petId) }),
  ]);
}

export function useCreateSchedule(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateScheduleInput) =>
      api<ScheduleResponse>(`/api/pets/${petId}/schedules`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidateCare(qc, petId),
  });
}

export function useUpdateSchedule(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateScheduleInput }) =>
      api<ScheduleResponse>(`/api/pets/${petId}/schedules/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidateCare(qc, petId),
  });
}

export function useDeleteSchedule(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean }>(`/api/pets/${petId}/schedules/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateCare(qc, petId),
  });
}

/** Completing also creates an activity, so lists, summaries, and the analyzer all refresh. */
export function useCompleteSchedule(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input?: CompleteScheduleInput }) =>
      api<CompleteScheduleResponse>(`/api/pets/${petId}/schedules/${id}/complete`, {
        method: "POST",
        body: JSON.stringify(input ?? {}),
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.schedules(petId) }),
        qc.invalidateQueries({ queryKey: keys.careStatus(petId) }),
        qc.invalidateQueries({ queryKey: keys.activitiesRoot(petId) }),
        qc.invalidateQueries({ queryKey: keys.summaryRoot(petId) }),
        qc.invalidateQueries({ queryKey: keys.insightsRoot(petId) }),
        qc.invalidateQueries({ queryKey: keys.anomalies(petId) }),
      ]);
    },
  });
}
```

- [ ] **Step 3: Create `app/src/api/insights.ts`**

```ts
import type { AnomaliesResponse, InsightsPeriod, InsightsResponse } from "@pawlog/shared";
import { useQuery } from "@tanstack/react-query";
import { deviceTzOffsetMin } from "../lib/dates";
import { api } from "./client";
import { keys } from "./keys";

export function useInsights(petId: string, period: InsightsPeriod) {
  return useQuery({
    queryKey: keys.insights(petId, period),
    queryFn: () =>
      api<InsightsResponse>(
        `/api/pets/${petId}/insights?period=${period}&tz=${deviceTzOffsetMin()}`,
      ),
    staleTime: 5 * 60_000,
  });
}

/** Lightweight Home-banner query (4 rules only — no chart datasets). */
export function useAnomalies(petId: string) {
  return useQuery({
    queryKey: keys.anomalies(petId),
    queryFn: () =>
      api<AnomaliesResponse>(`/api/pets/${petId}/anomalies?tz=${deviceTzOffsetMin()}`),
    staleTime: 60_000,
  });
}
```

- [ ] **Step 4: Extend the invalidation in `app/src/api/activities.ts`**

New activity data must re-evaluate anomalies and charts (spec §7: dismissed flags "reappear only on new triggering data"). In `invalidateActivityData`, extend the `Promise.all` to:

```ts
  await Promise.all([
    qc.invalidateQueries({ queryKey: keys.activitiesRoot(petId) }),
    qc.invalidateQueries({ queryKey: keys.summary(petId, month) }),
    qc.invalidateQueries({ queryKey: keys.insightsRoot(petId) }),
    qc.invalidateQueries({ queryKey: keys.anomalies(petId) }),
  ]);
```

And in `useDeleteActivity`'s `onSuccess`, extend its `Promise.all` to:

```ts
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.activitiesRoot(petId) }),
        qc.invalidateQueries({ queryKey: keys.summaryRoot(petId) }),
        qc.invalidateQueries({ queryKey: keys.insightsRoot(petId) }),
        qc.invalidateQueries({ queryKey: keys.anomalies(petId) }),
      ]);
```

- [ ] **Step 5: Add the chart-axis label helper to `app/src/lib/dates.ts`**

Append:

```ts
/** Short month+day label for chart axes ("Jun 8" / 「6月8日」). */
export function formatMonthDay(key: DayKey, locale: string): string {
  const { year, month, day } = dayKeyToParts(key);
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
```

- [ ] **Step 6: Extend the `Messages` interface in `app/src/i18n/messages.ts`**

Add to the import: `import type { Category, InsightsPeriod, Role, ScheduleType } from "@pawlog/shared";`

Extend the existing `health` section (keep `soonTitle`/`soonBody` for now — removed in Task 12):

```ts
  health: {
    soonTitle: string; // removed in Task 12
    soonBody: string; // removed in Task 12
    periods: Record<InsightsPeriod, string>;
    weightTitle: string;
    weightEmpty: string;
    movingAvg: string;
    pctChange: (pct: string) => string;
    intakeTitle: string;
    intakeEmpty: string;
    food: string;
    water: string;
    target: string;
    notLogged: string;
    gramsOnlyHint: string;
    toiletTitle: string;
    toiletEmpty: string;
    timelineTitle: string;
    timelineEmpty: string;
    vetVisits: string;
  };
```

Append two new top-level sections (after `settings`):

```ts
  care: {
    title: string;
    addSchedule: string;
    editSchedule: string;
    emptyTitle: string;
    emptyHint: string;
    types: Record<ScheduleType, string>;
    typeLabel: string;
    nameLabel: string;
    categoryLabel: string;
    repeatLabel: string;
    everyLabel: string;
    firstDueLabel: string;
    endLabel: string;
    endHint: string;
    recurrence: {
      once: string;
      hours: (n: number) => string;
      days: (n: number) => string;
      weeks: (n: number) => string;
      months: (n: number) => string;
    };
    overdue: string;
    dueToday: (time: string) => string;
    dueIn: (days: number) => string;
    finishedBadge: string;
    complete: string;
    completed: (name: string) => string;
    undo: string;
    undone: string;
    deleteSchedule: string;
    deleteConfirm: string;
    created: string;
    saved: string;
    homeTitle: string;
    homeAllDone: string;
    seeAll: string;
    nameRequired: string;
    invalidEnd: string;
    invalidN: string;
  };
  anomalies: {
    weightDrift: (pct: string) => string;
    toiletTrouble: (count: number) => string;
    quietDay: (petName: string) => string;
    symptomStreak: (name: string, days: number) => string;
    advice: string;
    dismiss: string;
    view: string;
  };
```

- [ ] **Step 7: Fill `app/src/i18n/en.ts`**

Replace the `health` section with (keeping the two placeholder keys):

```ts
  health: {
    soonTitle: "Health insights are on their way",
    soonBody:
      "Weight trends, intake vs targets, and gentle anomaly alerts arrive in the next update. Keep logging — every entry feeds the charts.",
    periods: { "4w": "4 weeks", "3m": "3 months", "1y": "1 year" },
    weightTitle: "Weight",
    weightEmpty: "No weighings in this period yet — log a Weight entry and the trend appears here.",
    movingAvg: "7-point average",
    pctChange: (pct) => `${pct}% over this period`,
    intakeTitle: "Food & water vs targets",
    intakeEmpty: "No food or water logged in this period yet.",
    food: "Food (g)",
    water: "Water (ml)",
    target: "Target",
    notLogged: "Not logged",
    gramsOnlyHint: "Food counts entries measured in grams; hollow marks mean nothing was logged.",
    toiletTitle: "Toilet patterns",
    toiletEmpty: "No toilet entries in this period yet.",
    timelineTitle: "Symptoms & medication",
    timelineEmpty: "No symptoms, medication, or vet visits in this period.",
    vetVisits: "Vet visits",
  },
```

Append after `settings`:

```ts
  care: {
    title: "Care schedule",
    addSchedule: "New care item",
    editSchedule: "Edit care item",
    emptyTitle: "No care items yet",
    emptyHint: "Track medication, vaccinations, and grooming with gentle due-date reminders.",
    types: {
      medication: "Medication",
      vaccination: "Vaccination",
      vet_visit: "Vet visit",
      deworming: "Deworming",
      grooming: "Grooming",
      custom: "Custom",
    },
    typeLabel: "Type",
    nameLabel: "Name",
    categoryLabel: "Logs as",
    repeatLabel: "Repeat",
    everyLabel: "Every",
    firstDueLabel: "First due",
    endLabel: "Until",
    endHint: "Leave empty to repeat indefinitely",
    recurrence: {
      once: "One time",
      hours: (n) => `Every ${n} h`,
      days: (n) => (n === 1 ? "Every day" : `Every ${n} days`),
      weeks: (n) => (n === 1 ? "Every week" : `Every ${n} weeks`),
      months: (n) => (n === 1 ? "Every month" : `Every ${n} months`),
    },
    overdue: "Overdue",
    dueToday: (time) => `Today ${time}`,
    dueIn: (days) => (days === 1 ? "Tomorrow" : `In ${days} days`),
    finishedBadge: "Finished",
    complete: "Done",
    completed: (name) => `${name} completed`,
    undo: "Undo",
    undone: "Undone",
    deleteSchedule: "Delete this care item",
    deleteConfirm: "Tap again to confirm",
    created: "Care item created",
    saved: "Care item saved",
    homeTitle: "Care today",
    homeAllDone: "All caught up — nothing due today.",
    seeAll: "See all",
    nameRequired: "Please give it a name",
    invalidEnd: "The end date must be after the first due time",
    invalidN: "The repeat interval must be at least 1",
  },
  anomalies: {
    weightDrift: (pct) => `Weight changed ${pct}% compared to a month ago`,
    toiletTrouble: (count) => `${count} concerning toilet entries in the last 3 days`,
    quietDay: (petName) => `No food or water logged for ${petName} today`,
    symptomStreak: (name, days) => `"${name}" has been logged ${days} days in a row`,
    advice: "Just a gentle heads-up — consider asking your vet.",
    dismiss: "Dismiss",
    view: "View charts",
  },
```

- [ ] **Step 8: Fill `app/src/i18n/ja.ts`**

Replace the `health` section with (keeping the two placeholder keys and their existing Japanese values):

```ts
  health: {
    soonTitle: "健康インサイトはもうすぐ",
    soonBody:
      "体重の推移、目標との比較、やさしい異常アラートは次のアップデートで届きます。記録を続けましょう — すべての記録がグラフになります。",
    periods: { "4w": "4週間", "3m": "3か月", "1y": "1年" },
    weightTitle: "体重",
    weightEmpty: "この期間の体重記録はまだありません。体重を記録するとここに推移が表示されます。",
    movingAvg: "7点移動平均",
    pctChange: (pct) => `この期間で${pct}%`,
    intakeTitle: "食事・飲水と目標",
    intakeEmpty: "この期間の食事・飲水の記録はまだありません。",
    food: "食事(g)",
    water: "水(ml)",
    target: "目標",
    notLogged: "未記録",
    gramsOnlyHint: "食事はグラム単位の記録のみ集計します。白抜きは未記録の印です。",
    toiletTitle: "トイレの傾向",
    toiletEmpty: "この期間のトイレ記録はまだありません。",
    timelineTitle: "症状とお薬",
    timelineEmpty: "この期間の症状・お薬・通院の記録はありません。",
    vetVisits: "通院",
  },
```

(If the existing `soonTitle`/`soonBody` Japanese strings differ from the above, KEEP the existing values — only the new keys matter.) Append after `settings`:

```ts
  care: {
    title: "ケア予定",
    addSchedule: "ケア予定を追加",
    editSchedule: "ケア予定を編集",
    emptyTitle: "ケア予定はまだありません",
    emptyHint: "お薬・ワクチン・お手入れなどを期日つきで管理できます。",
    types: {
      medication: "お薬",
      vaccination: "ワクチン",
      vet_visit: "通院",
      deworming: "駆虫",
      grooming: "お手入れ",
      custom: "カスタム",
    },
    typeLabel: "種類",
    nameLabel: "名前",
    categoryLabel: "記録カテゴリ",
    repeatLabel: "繰り返し",
    everyLabel: "間隔",
    firstDueLabel: "初回予定",
    endLabel: "終了日",
    endHint: "空欄でずっと繰り返します",
    recurrence: {
      once: "1回のみ",
      hours: (n) => `${n}時間ごと`,
      days: (n) => (n === 1 ? "毎日" : `${n}日ごと`),
      weeks: (n) => (n === 1 ? "毎週" : `${n}週間ごと`),
      months: (n) => (n === 1 ? "毎月" : `${n}か月ごと`),
    },
    overdue: "期限切れ",
    dueToday: (time) => `今日 ${time}`,
    dueIn: (days) => (days === 1 ? "明日" : `${days}日後`),
    finishedBadge: "終了",
    complete: "完了",
    completed: (name) => `${name}を完了しました`,
    undo: "元に戻す",
    undone: "元に戻しました",
    deleteSchedule: "このケア予定を削除",
    deleteConfirm: "もう一度タップで確定",
    created: "ケア予定を作成しました",
    saved: "ケア予定を保存しました",
    homeTitle: "今日のケア",
    homeAllDone: "今日の予定はすべて完了しています。",
    seeAll: "すべて見る",
    nameRequired: "名前を入力してください",
    invalidEnd: "終了日は初回予定より後にしてください",
    invalidN: "間隔は1以上にしてください",
  },
  anomalies: {
    weightDrift: (pct) => `体重が1か月前から${pct}%変化しています`,
    toiletTrouble: (count) => `この3日間で気になるトイレ記録が${count}件あります`,
    quietDay: (petName) => `今日はまだ${petName}の食事・飲水の記録がありません`,
    symptomStreak: (name, days) => `「${name}」が${days}日連続で記録されています`,
    advice: "あくまで参考です。気になる場合はかかりつけ医にご相談ください。",
    dismiss: "閉じる",
    view: "グラフを見る",
  },
```

- [ ] **Step 9: Extend `app/test/dates.test.ts`**

Add `formatMonthDay` to the existing import from `../src/lib/dates`, add a new import line `import { isoWeekKey, isoWeekStartDay } from "@pawlog/shared";`, and append:

```ts
describe("chart axis helpers (plan 4)", () => {
  it("formatMonthDay renders a short axis label", () => {
    expect(formatMonthDay("2026-06-08", "en")).toBe("Jun 8");
  });

  it("shared ISO week math is importable from the app side", () => {
    expect(isoWeekKey("2026-06-12")).toBe("2026-W24");
    expect(isoWeekStartDay("2026-W24")).toBe("2026-06-08");
  });
});
```

(If the file uses bare `it` without `describe` blocks, wrap consistently with whatever style is present.)

- [ ] **Step 10: Verify**

Run: `npm run test -w app && npm run typecheck -w app && npm run build -w app`
Expected: all green; the new catalog sections compile in BOTH languages (a missing key is a type error).

- [ ] **Step 11: Commit**

```bash
git add app/src/api/ app/src/lib/dates.ts app/src/i18n/ app/test/dates.test.ts
git commit -m "feat: add care and insights api hooks with i18n catalog entries"
```

---

### Task 10: SVG charts I — WeightChart + IntakeChart

**Files:**
- Create: `app/src/features/health/bucketLabel.ts`
- Create: `app/src/features/health/WeightChart.tsx`
- Create: `app/src/features/health/IntakeChart.tsx`

Chart conventions (apply to all four components, Tasks 10–11):
- Pure SVG with a fixed `viewBox` rendered at `w-full` (text scales with the chart — acceptable at phone/card widths).
- No animation (nothing to suppress for `prefers-reduced-motion`); colors via `var(--color-…)` theme tokens so they follow the warm palette.
- Tooltips are native `<title>` elements inside a `<g>` per datum.
- `role="img"` + `aria-label` on every `<svg>`; per-chart `EmptyState` with catalog copy.
- "Not logged" is rendered (hollow), never faked as zero (spec §7).

- [ ] **Step 1: Create `app/src/features/health/bucketLabel.ts`**

```ts
import { isoWeekStartDay } from "@pawlog/shared";
import { formatMonthDay } from "../../lib/dates";

/** Axis label for a chart bucket: the day itself, or the ISO week's Monday. */
export function bucketLabel(key: string, bucket: "day" | "week", locale: string): string {
  return formatMonthDay(bucket === "week" ? isoWeekStartDay(key) : key, locale);
}
```

- [ ] **Step 2: Create `app/src/features/health/WeightChart.tsx`**

Geometry: 360×190 viewBox; plot area `x ∈ [38, 350]`, `y ∈ [16, 170]`. Buckets are centered slots: `x(b) = 38 + (index(b) + 0.5) · 312 / buckets.length`. The y-domain pads min/max by `max(20% of range, 0.3 kg)` so a flat series doesn't collapse: `y(kg) = 16 + (1 − (kg − lo)/(hi − lo)) · 154`.

```tsx
import type { WeightSeries } from "@pawlog/shared";
import { EmptyState } from "../../components/EmptyState";
import { useLocaleTag, useT } from "../../i18n";
import { bucketLabel } from "./bucketLabel";

const W = 360;
const H = 190;
const PAD = { left: 38, right: 10, top: 16, bottom: 20 };
const INNER_W = W - PAD.left - PAD.right; // 312
const INNER_H = H - PAD.top - PAD.bottom; // 154

export function WeightChart({
  series,
  buckets,
  bucket,
}: {
  series: WeightSeries;
  buckets: string[];
  bucket: "day" | "week";
}) {
  const t = useT();
  const tag = useLocaleTag();
  if (series.points.length === 0 || series.min === null || series.max === null) {
    return <EmptyState title={t.health.weightEmpty} className="py-6" />;
  }

  const index = new Map(buckets.map((b, i) => [b, i]));
  const span = Math.max((series.max - series.min) * 0.2, 0.3);
  const lo = series.min - span;
  const hi = series.max + span;
  const x = (b: string) => PAD.left + ((index.get(b) ?? 0) + 0.5) * (INNER_W / buckets.length);
  const y = (kg: number) => PAD.top + (1 - (kg - lo) / (hi - lo)) * INNER_H;
  const path = (pick: (p: WeightSeries["points"][number]) => number) =>
    series.points
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.bucket).toFixed(1)} ${y(pick(p)).toFixed(1)}`)
      .join(" ");

  const ticks = [lo, (lo + hi) / 2, hi];
  const axis = [...new Set([buckets[0]!, buckets[Math.floor(buckets.length / 2)]!, buckets[buckets.length - 1]!])];

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-ink-faint">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-0 w-5 border-t-2 border-dashed border-cat-weight" />
          {t.health.movingAvg}
        </span>
        {series.pctChange !== null && (
          <span className="rounded-full bg-cat-weight-soft px-2.5 py-0.5 font-semibold text-cat-weight">
            {t.health.pctChange(`${series.pctChange > 0 ? "+" : ""}${series.pctChange}`)}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t.health.weightTitle}>
        {/* min–max band */}
        <rect
          x={PAD.left}
          y={y(series.max)}
          width={INNER_W}
          height={Math.max(y(series.min) - y(series.max), 1)}
          fill="var(--color-cat-weight-soft)"
          opacity={0.6}
        />
        {/* y grid + tick labels */}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--color-cream-200)" strokeWidth={1} />
            <text x={PAD.left - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="var(--color-ink-faint)">
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        {/* trend: dashed moving average under the weight line */}
        <path d={path((p) => p.avg7)} fill="none" stroke="var(--color-cat-weight)" strokeWidth={1.5} strokeDasharray="5 4" opacity={0.7} />
        <path d={path((p) => p.kg)} fill="none" stroke="var(--color-cat-weight)" strokeWidth={2} strokeLinejoin="round" />
        {series.points.map((p) => (
          <g key={p.bucket}>
            <title>{`${bucketLabel(p.bucket, bucket, tag)}: ${p.kg} kg`}</title>
            <circle cx={x(p.bucket)} cy={y(p.kg)} r={3} fill="var(--color-cat-weight)" stroke="var(--color-paper)" strokeWidth={1} />
          </g>
        ))}
        {/* x labels: first / middle / last bucket */}
        {axis.map((b) => (
          <text key={b} x={x(b)} y={H - 6} textAnchor="middle" fontSize={9} fill="var(--color-ink-faint)">
            {bucketLabel(b, bucket, tag)}
          </text>
        ))}
      </svg>
    </div>
  );
}
```

- [ ] **Step 3: Create `app/src/features/health/IntakeChart.tsx`**

Two stacked bar lanes (food g / water ml), each 84 px tall in a 360×222 viewBox. Per-lane scale: `scale = 84 / (1.15 · max(values, targetLine, 1))`; bar width `clamp(0.7 · slot, 1.5, 14)` where `slot = 312 / buckets.length`. Logged buckets are filled bars (`height = max(v · scale, 2)`); **not-logged buckets are 4 px hollow outline rects at the baseline** — visually distinct from any real bar. The dashed target line is `daily target × 7` for week buckets.

```tsx
import type { InsightsResponse } from "@pawlog/shared";
import { EmptyState } from "../../components/EmptyState";
import { useLocaleTag, useT } from "../../i18n";
import { bucketLabel } from "./bucketLabel";

const W = 360;
const LANE_H = 84;
const GAP = 26;
const PAD = { left: 38, right: 10, top: 12, bottom: 16 };
const INNER_W = W - PAD.left - PAD.right; // 312
const H = PAD.top + LANE_H * 2 + GAP + PAD.bottom; // 222

type Lane = {
  values: Record<string, number>;
  /** target already scaled per bucket (×7 for week buckets) */
  target: number | null;
  color: string;
  label: string;
  unit: string;
};

export function IntakeChart({
  intake,
  buckets,
  bucket,
}: {
  intake: InsightsResponse["intake"];
  buckets: string[];
  bucket: "day" | "week";
}) {
  const t = useT();
  const tag = useLocaleTag();
  if (Object.keys(intake.food).length === 0 && Object.keys(intake.water).length === 0) {
    return <EmptyState title={t.health.intakeEmpty} className="py-6" />;
  }

  const mult = bucket === "week" ? 7 : 1;
  const lanes: Lane[] = [
    {
      values: intake.food,
      target: intake.targets?.foodGPerDay != null ? intake.targets.foodGPerDay * mult : null,
      color: "var(--color-cat-food)",
      label: t.health.food,
      unit: "g",
    },
    {
      values: intake.water,
      target: intake.targets?.waterMlPerDay != null ? intake.targets.waterMlPerDay * mult : null,
      color: "var(--color-cat-water)",
      label: t.health.water,
      unit: "ml",
    },
  ];
  const slot = INNER_W / buckets.length;
  const barW = Math.max(Math.min(slot * 0.7, 14), 1.5);

  const renderLane = (lane: Lane, laneIndex: number) => {
    const top = PAD.top + laneIndex * (LANE_H + GAP);
    const baseline = top + LANE_H;
    const peak = Math.max(...Object.values(lane.values), lane.target ?? 0, 1);
    const scale = LANE_H / (peak * 1.15);
    return (
      <g key={lane.label}>
        <text x={PAD.left} y={top - 3} fontSize={10} fontWeight={700} fill={lane.color}>
          {lane.label}
        </text>
        <line x1={PAD.left} x2={W - PAD.right} y1={baseline} y2={baseline} stroke="var(--color-cream-300)" strokeWidth={1} />
        {buckets.map((b, i) => {
          const cx = PAD.left + (i + 0.5) * slot;
          const v = lane.values[b];
          if (v === undefined) {
            // not logged: hollow marker (spec §7 — distinct from a real bar)
            return (
              <g key={b}>
                <title>{`${bucketLabel(b, bucket, tag)}: ${t.health.notLogged}`}</title>
                <rect x={cx - barW / 2} y={baseline - 4} width={barW} height={4} rx={1} fill="none" stroke="var(--color-cream-300)" strokeWidth={1} />
              </g>
            );
          }
          const h = Math.max(v * scale, 2);
          return (
            <g key={b}>
              <title>{`${bucketLabel(b, bucket, tag)}: ${v} ${lane.unit}`}</title>
              <rect x={cx - barW / 2} y={baseline - h} width={barW} height={h} rx={1.5} fill={lane.color} />
            </g>
          );
        })}
        {lane.target !== null && (
          <g>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={baseline - lane.target * scale}
              y2={baseline - lane.target * scale}
              stroke={lane.color}
              strokeWidth={1.2}
              strokeDasharray="4 3"
              opacity={0.8}
            />
            <text x={W - PAD.right} y={baseline - lane.target * scale - 3} textAnchor="end" fontSize={9} fill={lane.color}>
              {`${t.health.target} ${Math.round(lane.target)} ${lane.unit}`}
            </text>
          </g>
        )}
      </g>
    );
  };

  const axis = [...new Set([buckets[0]!, buckets[Math.floor(buckets.length / 2)]!, buckets[buckets.length - 1]!])];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t.health.intakeTitle}>
        {lanes.map(renderLane)}
        {axis.map((b) => (
          <text
            key={b}
            x={PAD.left + (buckets.indexOf(b) + 0.5) * slot}
            y={H - 4}
            textAnchor="middle"
            fontSize={9}
            fill="var(--color-ink-faint)"
          >
            {bucketLabel(b, bucket, tag)}
          </text>
        ))}
      </svg>
      <p className="mt-1 text-xs text-ink-faint">{t.health.gramsOnlyHint}</p>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck -w app && npm run build -w app`
Expected: clean (the components aren't rendered anywhere yet — that's Task 12).

- [ ] **Step 5: Commit**

```bash
git add app/src/features/health/
git commit -m "feat: add weight and intake svg charts"
```

---

### Task 11: SVG charts II — ToiletMatrix + CareTimeline

**Files:**
- Create: `app/src/features/health/ToiletMatrix.tsx`
- Create: `app/src/features/health/CareTimeline.tsx`

- [ ] **Step 1: Create `app/src/features/health/ToiletMatrix.tsx`**

Bucket rows (newest first) × two cells (pee | poop). Geometry: 360-wide viewBox, 70 px label gutter, two `(360 − 70 − 18)/2 = 136` px cells, 16 px rows; total height `18 + rows · 16 + 4` (the SVG grows; a `max-h-80 overflow-y-auto` wrapper scrolls long periods). Cells are colored by the worst condition that bucket (severity legend below); count > 1 prints inside the cell; a bucket with no logs renders a faint outline.

```tsx
import type { ToiletCell, ToiletMatrixRow, ToiletSeverity } from "@pawlog/shared";
import { TOILET_SEVERITY } from "@pawlog/shared";
import { EmptyState } from "../../components/EmptyState";
import { useLocaleTag, useT } from "../../i18n";
import { bucketLabel } from "./bucketLabel";

const W = 360;
const ROW_H = 16;
const HEADER_H = 18;
const LABEL_W = 70;
const CELL_GAP = 6;
const CELL_W = (W - LABEL_W - CELL_GAP * 3) / 2; // 136

export const conditionFill: Record<ToiletSeverity, string> = {
  normal: "var(--color-moss-600)",
  soft: "var(--color-cat-vaccine)",
  hard: "var(--color-cat-toilet)",
  diarrhea: "var(--color-clay-500)",
  bloody: "var(--color-berry-600)",
};

function Cell({
  x,
  y,
  cell,
  label,
  conditionName,
}: {
  x: number;
  y: number;
  cell: ToiletCell | null;
  label: string;
  conditionName: (c: ToiletSeverity) => string;
}) {
  if (!cell) {
    return (
      <rect x={x} y={y + 2} width={CELL_W} height={ROW_H - 5} rx={4} fill="none" stroke="var(--color-cream-200)" strokeWidth={1} />
    );
  }
  return (
    <g>
      <title>{`${label}: ${cell.count}× · ${conditionName(cell.worst)}`}</title>
      <rect
        x={x}
        y={y + 2}
        width={CELL_W}
        height={ROW_H - 5}
        rx={4}
        fill={conditionFill[cell.worst]}
        opacity={cell.worst === "normal" ? 0.55 : 0.9}
      />
      {cell.count > 1 && (
        <text x={x + CELL_W / 2} y={y + ROW_H - 5} textAnchor="middle" fontSize={9} fontWeight={700} fill="var(--color-paper)">
          {cell.count}
        </text>
      )}
    </g>
  );
}

export function ToiletMatrix({
  rows,
  buckets,
  bucket,
}: {
  rows: ToiletMatrixRow[];
  buckets: string[];
  bucket: "day" | "week";
}) {
  const t = useT();
  const tag = useLocaleTag();
  if (rows.length === 0) return <EmptyState title={t.health.toiletEmpty} className="py-6" />;

  const byBucket = new Map(rows.map((r) => [r.bucket, r]));
  const ordered = [...buckets].reverse(); // newest first
  const H = HEADER_H + ordered.length * ROW_H + 4;
  const peeX = LABEL_W + CELL_GAP;
  const poopX = LABEL_W + CELL_GAP * 2 + CELL_W;
  const conditionName = (c: ToiletSeverity) => t.options.condition[c];

  return (
    <div>
      <div className="max-h-80 overflow-y-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t.health.toiletTitle}>
          <text x={peeX + CELL_W / 2} y={11} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--color-ink-soft)">
            {t.options.toiletKind.pee}
          </text>
          <text x={poopX + CELL_W / 2} y={11} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--color-ink-soft)">
            {t.options.toiletKind.poop}
          </text>
          {ordered.map((b, i) => {
            const y0 = HEADER_H + i * ROW_H;
            const row = byBucket.get(b);
            const label = bucketLabel(b, bucket, tag);
            return (
              <g key={b}>
                <text x={LABEL_W - 4} y={y0 + ROW_H - 5} textAnchor="end" fontSize={9} fill="var(--color-ink-faint)">
                  {label}
                </text>
                <Cell x={peeX} y={y0} cell={row?.pee ?? null} label={`${label} · ${t.options.toiletKind.pee}`} conditionName={conditionName} />
                <Cell x={poopX} y={y0} cell={row?.poop ?? null} label={`${label} · ${t.options.toiletKind.poop}`} conditionName={conditionName} />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-faint">
        {TOILET_SEVERITY.map((cond) => (
          <span key={cond} className="flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: conditionFill[cond] }} />
            {t.options.condition[cond]}
          </span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `app/src/features/health/CareTimeline.tsx`**

Shared horizontal time axis over `[windowStart, windowEnd]` (household-naive ms, exactly what the API returns). 92 px name gutter; one row per vet-marker lane + per medication/symptom span; `x(ms) = 92 + clamp((ms − windowStart)/(windowEnd − windowStart), 0, 1) · 258`. Spans are rounded 10 px-tall rects from `x(firstAt)` to `x(lastAt)` (min 6 px so single entries stay visible); symptom span opacity encodes max severity (mild 0.45 / moderate 0.7 / severe 1). Vet visits are diamonds on the top lane.

```tsx
import type { InsightsResponse } from "@pawlog/shared";
import { EmptyState } from "../../components/EmptyState";
import { useLocaleTag, useT } from "../../i18n";

const W = 360;
const ROW_H = 20;
const GUTTER = 92;
const PAD_R = 10;
const AXIS_H = 16;
const TOP = 8;
const INNER_W = W - GUTTER - PAD_R; // 258

const SEVERITY_OPACITY = { mild: 0.45, moderate: 0.7, severe: 1 } as const;
const LANE_COLOR = {
  medication: "var(--color-cat-medication)",
  symptom: "var(--color-cat-symptom)",
} as const;

/** Household-naive ms → label (read as UTC, like all household math). */
function dateLabel(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
}

export function CareTimeline({
  timeline,
  windowStart,
  windowEnd,
}: {
  timeline: InsightsResponse["timeline"];
  windowStart: number;
  windowEnd: number;
}) {
  const t = useT();
  const tag = useLocaleTag();
  const { medications, symptoms, vetVisits } = timeline;
  if (medications.length === 0 && symptoms.length === 0 && vetVisits.length === 0) {
    return <EmptyState title={t.health.timelineEmpty} className="py-6" />;
  }

  const x = (ms: number) =>
    GUTTER + Math.min(Math.max((ms - windowStart) / (windowEnd - windowStart), 0), 1) * INNER_W;

  const lanes = [
    ...medications.map((s) => ({ ...s, kind: "medication" as const, opacity: 0.85 })),
    ...symptoms.map((s) => ({ ...s, kind: "symptom" as const, opacity: SEVERITY_OPACITY[s.maxSeverity] })),
  ];
  const vetRow = vetVisits.length > 0 ? 1 : 0;
  const H = TOP + (vetRow + lanes.length) * ROW_H + AXIS_H;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t.health.timelineTitle}>
      {vetRow === 1 && (
        <g>
          <text x={GUTTER - 6} y={TOP + ROW_H - 7} textAnchor="end" fontSize={9} fontWeight={700} fill="var(--color-cat-vet)">
            {t.health.vetVisits}
          </text>
          {vetVisits.map((v, i) => (
            <g key={`${v.at}-${i}`}>
              <title>{`${dateLabel(v.at, tag)}${v.clinic ? ` · ${v.clinic}` : ""}`}</title>
              <path d={`M${x(v.at).toFixed(1)} ${TOP + 3} l5 6 -5 6 -5 -6 Z`} fill="var(--color-cat-vet)" />
            </g>
          ))}
        </g>
      )}
      {lanes.map((lane, i) => {
        const y0 = TOP + (vetRow + i) * ROW_H;
        const x1 = x(lane.firstAt);
        const w = Math.max(x(lane.lastAt) - x1, 6);
        return (
          <g key={`${lane.kind}-${lane.name}`}>
            <text x={GUTTER - 6} y={y0 + ROW_H - 7} textAnchor="end" fontSize={9} fill="var(--color-ink-soft)">
              {lane.name.length > 14 ? `${lane.name.slice(0, 13)}…` : lane.name}
            </text>
            <line x1={GUTTER} x2={W - PAD_R} y1={y0 + ROW_H / 2} y2={y0 + ROW_H / 2} stroke="var(--color-cream-200)" strokeWidth={1} />
            <g>
              <title>{`${lane.name}: ${lane.count}× (${dateLabel(lane.firstAt, tag)} – ${dateLabel(lane.lastAt, tag)})`}</title>
              <rect x={x1 - 3} y={y0 + ROW_H / 2 - 5} width={w + 6} height={10} rx={5} fill={LANE_COLOR[lane.kind]} opacity={lane.opacity} />
            </g>
          </g>
        );
      })}
      {[windowStart, (windowStart + windowEnd) / 2, windowEnd - 1].map((ms, i) => (
        <text
          key={ms}
          x={x(ms)}
          y={H - 4}
          textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
          fontSize={9}
          fill="var(--color-ink-faint)"
        >
          {dateLabel(ms, tag)}
        </text>
      ))}
    </svg>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck -w app && npm run build -w app`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/src/features/health/
git commit -m "feat: add toilet matrix and care timeline svg charts"
```

---

### Task 12: Health tab — anomalies, charts, schedule management

**Files:**
- Create: `app/src/features/health/dismissals.ts`
- Create: `app/src/features/health/AnomalyBanners.tsx`
- Create: `app/src/features/health/useCompleteWithUndo.ts`
- Create: `app/src/features/health/ScheduleSheet.tsx`
- Create: `app/src/features/health/CareScheduleList.tsx`
- Modify: `app/src/routes/HealthTab.tsx` (full replacement)
- Modify: `app/src/i18n/messages.ts`, `app/src/i18n/en.ts`, `app/src/i18n/ja.ts` (remove the two placeholder keys)

- [ ] **Step 1: Create `app/src/features/health/dismissals.ts`**

```ts
import type { Anomaly } from "@pawlog/shared";

/**
 * Dismissals live client-side, scoped to pet + rule (+ symptom name for
 * symptom_streak) + household day — a new day re-evaluates, which is how
 * "reappear only on new triggering data" (spec §7) works in practice.
 */
function storageKey(petId: string, anomaly: Anomaly, day: string): string {
  const sub = anomaly.rule === "symptom_streak" ? anomaly.params.name : "";
  return `pawlog:anomaly:${petId}:${anomaly.rule}:${sub}:${day}`;
}

export function isDismissed(petId: string, anomaly: Anomaly, day: string): boolean {
  try {
    return localStorage.getItem(storageKey(petId, anomaly, day)) !== null;
  } catch {
    return false; // storage unavailable → banner simply shows
  }
}

export function dismissAnomaly(petId: string, anomaly: Anomaly, day: string): void {
  try {
    localStorage.setItem(storageKey(petId, anomaly, day), "1");
  } catch {
    // private mode etc. — the banner reappears next render, acceptable
  }
}
```

- [ ] **Step 2: Create `app/src/features/health/AnomalyBanners.tsx`**

```tsx
import type { Anomaly } from "@pawlog/shared";
import { useState } from "react";
import { Link } from "react-router";
import { IconButton } from "../../components/IconButton";
import { XIcon } from "../../components/icons";
import { useT } from "../../i18n";
import type { Messages } from "../../i18n/messages";
import { cn } from "../../lib/cn";
import { todayKey } from "../../lib/dates";
import { dismissAnomaly, isDismissed } from "./dismissals";

/** Localized copy from structured params — the only place anomaly text exists. */
export function anomalyMessage(a: Anomaly, petName: string, t: Messages): string {
  switch (a.rule) {
    case "weight_drift":
      return t.anomalies.weightDrift(
        `${a.params.pctChange > 0 ? "+" : ""}${a.params.pctChange}`,
      );
    case "toilet_trouble":
      return t.anomalies.toiletTrouble(a.params.count);
    case "quiet_day":
      return t.anomalies.quietDay(petName);
    case "symptom_streak":
      return t.anomalies.symptomStreak(a.params.name, a.params.days);
  }
}

export function AnomalyBanners({
  petId,
  petName,
  anomalies,
  linkToHealth = false,
}: {
  petId: string;
  petName: string;
  anomalies: Anomaly[];
  /** on Home: deep-link each banner to the Health tab (spec §7) */
  linkToHealth?: boolean;
}) {
  const t = useT();
  const today = todayKey();
  const [, setVersion] = useState(0); // re-render after a dismissal
  const visible = anomalies.filter((a) => !isDismissed(petId, a, today));
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" data-slot="anomaly-banners">
      {visible.map((a) => (
        <div
          key={`${a.rule}-${a.rule === "symptom_streak" ? a.params.name : ""}`}
          role="status"
          className={cn(
            "animate-pop flex items-start gap-3 rounded-card border p-3 shadow-card",
            a.severity === "warning"
              ? "border-berry-600/30 bg-berry-100"
              : "border-clay-300/50 bg-clay-50",
          )}
        >
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-sm font-semibold",
                a.severity === "warning" ? "text-berry-700" : "text-clay-800",
              )}
            >
              {anomalyMessage(a, petName, t)}
            </p>
            <p className="text-xs text-ink-soft">{t.anomalies.advice}</p>
            {linkToHealth && (
              <Link
                to="/health"
                className="text-xs font-semibold text-clay-600 underline underline-offset-4"
              >
                {t.anomalies.view}
              </Link>
            )}
          </div>
          <IconButton
            label={t.anomalies.dismiss}
            onClick={() => {
              dismissAnomaly(petId, a, today);
              setVersion((v) => v + 1);
            }}
          >
            <XIcon className="h-4 w-4" />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `app/src/features/health/useCompleteWithUndo.ts`**

```ts
import type { ScheduleResponse } from "@pawlog/shared";
import { useDeleteActivity } from "../../api/activities";
import { useCompleteSchedule, useUpdateSchedule } from "../../api/schedules";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";
import { deviceTzOffsetMin } from "../../lib/dates";

/**
 * Complete + undo, used by both the Health tab and the Home care card.
 * Undo is exactly (locked decision): soft-DELETE the activity the completion
 * created, then PATCH the schedule's nextDueAt/active back to the values it
 * had BEFORE completing — both captured from the schedule row we already had.
 */
export function useCompleteWithUndo(petId: string): {
  complete: (schedule: ScheduleResponse) => void;
  isPending: boolean;
} {
  const t = useT();
  const toast = useToast();
  const completeMut = useCompleteSchedule(petId);
  const removeActivity = useDeleteActivity(petId);
  const updateSchedule = useUpdateSchedule(petId);

  const complete = (schedule: ScheduleResponse) => {
    completeMut.mutate(
      { id: schedule.id, input: { tzOffsetMin: deviceTzOffsetMin() } },
      {
        onSuccess: (res) => {
          toast.show(t.care.completed(schedule.name), {
            action: {
              label: t.care.undo,
              onClick: () => {
                removeActivity.mutate(res.activity.id);
                updateSchedule.mutate(
                  {
                    id: schedule.id,
                    input: { nextDueAt: schedule.nextDueAt, active: schedule.active },
                  },
                  { onSuccess: () => toast.show(t.care.undone) },
                );
              },
            },
          });
        },
        onError: () => toast.show(t.errors.title, { tone: "danger" }),
      },
    );
  };
  return { complete, isPending: completeMut.isPending };
}
```

- [ ] **Step 4: Create `app/src/features/health/ScheduleSheet.tsx`**

Create + edit in one Sheet. Type picker pre-selects a sensible `categoryLink` (free choice of all 11 remains — locked decision); the details template reuses `DetailsFields`/`buildDetails`, so the template is provably schema-valid client-side with the same Zod the server runs. In edit mode `type`/`categoryLink` are disabled (immutable). Delete is a two-tap confirm.

```tsx
import type {
  Category,
  CreateScheduleInput,
  RecurrenceUnit,
  ScheduleResponse,
  ScheduleType,
} from "@pawlog/shared";
import { CATEGORIES, RECURRENCE_UNITS, SCHEDULE_TYPES, createScheduleSchema } from "@pawlog/shared";
import { useEffect, useState } from "react";
import { useCreateSchedule, useDeleteSchedule, useUpdateSchedule } from "../../api/schedules";
import { Button } from "../../components/Button";
import { DateInput, DateTimeInput, Field, NumberInput, Select, TextInput } from "../../components/form";
import { Sheet } from "../../components/Sheet";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";
import type { Messages } from "../../i18n/messages";
import { buildDetails, initialValues, type FormValues } from "../add/categoryFields";
import { DetailsFields } from "../add/DetailsFields";

const DEFAULT_CATEGORY: Record<ScheduleType, Category> = {
  medication: "medication",
  vaccination: "vaccination",
  vet_visit: "vet_visit",
  deworming: "medication",
  grooming: "grooming",
  custom: "note",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" → inclusive end of that device-local day, epoch ms. */
function endOfLocalDayMs(isoDate: string): number {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  const d = Number(isoDate.slice(8, 10));
  return new Date(y, m - 1, d + 1).getTime() - 1;
}

function msToLocalIsoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function recurrenceOptionLabel(unit: RecurrenceUnit, n: number, t: Messages): string {
  switch (unit) {
    case "once":
      return t.care.recurrence.once;
    case "hour":
      return t.care.recurrence.hours(n);
    case "day":
      return t.care.recurrence.days(n);
    case "week":
      return t.care.recurrence.weeks(n);
    case "month":
      return t.care.recurrence.months(n);
  }
}

export function ScheduleSheet({
  petId,
  open,
  onClose,
  schedule,
}: {
  petId: string;
  open: boolean;
  onClose: () => void;
  /** present = edit mode (type + categoryLink are immutable server-side) */
  schedule?: ScheduleResponse;
}) {
  const t = useT();
  const toast = useToast();
  const create = useCreateSchedule(petId);
  const update = useUpdateSchedule(petId);
  const remove = useDeleteSchedule(petId);

  const [type, setType] = useState<ScheduleType>("medication");
  const [name, setName] = useState("");
  const [categoryLink, setCategoryLink] = useState<Category>("medication");
  const [details, setDetails] = useState<FormValues>(() => initialValues("medication"));
  const [unit, setUnit] = useState<RecurrenceUnit>("day");
  const [n, setN] = useState("1");
  const [firstDueMs, setFirstDueMs] = useState(() => Date.now());
  const [endDate, setEndDate] = useState(""); // "" = no end
  const [error, setError] = useState<string | null>(null);
  const [armDelete, setArmDelete] = useState(false);

  // (re)seed the form whenever the sheet opens
  useEffect(() => {
    if (!open) return;
    setError(null);
    setArmDelete(false);
    if (schedule) {
      setType(schedule.type);
      setName(schedule.name);
      setCategoryLink(schedule.categoryLink);
      setDetails(initialValues(schedule.categoryLink, schedule.detailsTemplate));
      setUnit(schedule.recurrenceUnit);
      setN(String(schedule.recurrenceN ?? 1));
      setFirstDueMs(schedule.nextDueAt);
      setEndDate(schedule.endAt === null ? "" : msToLocalIsoDate(schedule.endAt));
    } else {
      setType("medication");
      setName("");
      setCategoryLink("medication");
      setDetails(initialValues("medication"));
      setUnit("day");
      setN("1");
      setFirstDueMs(Date.now());
      setEndDate("");
    }
  }, [open, schedule]);

  const pickType = (next: ScheduleType) => {
    setType(next);
    if (!schedule) {
      const cat = DEFAULT_CATEGORY[next];
      setCategoryLink(cat);
      setDetails(initialValues(cat));
    }
  };
  const pickCategory = (next: Category) => {
    setCategoryLink(next);
    setDetails(initialValues(next));
  };

  const submit = () => {
    const built = buildDetails(categoryLink, details, t);
    if ("error" in built) {
      setError(built.error);
      return;
    }
    const candidate: CreateScheduleInput = {
      type,
      name: name.trim(),
      categoryLink,
      detailsTemplate: built.details,
      recurrenceUnit: unit,
      ...(unit !== "once" ? { recurrenceN: Number(n) || 0 } : {}),
      nextDueAt: firstDueMs,
      ...(endDate !== "" ? { endAt: endOfLocalDayMs(endDate) } : {}),
    };
    // same Zod the server runs — friendly per-field messages first
    const parsed = createScheduleSchema.safeParse(candidate);
    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path[0];
      setError(
        path === "name"
          ? t.care.nameRequired
          : path === "recurrenceN"
            ? t.care.invalidN
            : path === "endAt"
              ? t.care.invalidEnd
              : (parsed.error.issues[0]?.message ?? t.add.detailsInvalid),
      );
      return;
    }
    if (schedule) {
      update.mutate(
        {
          id: schedule.id,
          input: {
            name: candidate.name,
            detailsTemplate: candidate.detailsTemplate,
            recurrenceUnit: candidate.recurrenceUnit,
            recurrenceN: unit === "once" ? null : (candidate.recurrenceN ?? 1),
            nextDueAt: candidate.nextDueAt,
            endAt: endDate === "" ? null : candidate.endAt!,
          },
        },
        {
          onSuccess: () => {
            toast.show(t.care.saved);
            onClose();
          },
          onError: () => toast.show(t.errors.title, { tone: "danger" }),
        },
      );
    } else {
      create.mutate(parsed.data, {
        onSuccess: () => {
          toast.show(t.care.created);
          onClose();
        },
        onError: () => toast.show(t.errors.title, { tone: "danger" }),
      });
    }
  };

  const destroy = () => {
    if (!schedule) return;
    if (!armDelete) {
      setArmDelete(true); // two-tap confirm
      return;
    }
    remove.mutate(schedule.id, {
      onSuccess: () => {
        toast.show(t.detail.deleted);
        onClose();
      },
      onError: () => toast.show(t.errors.title, { tone: "danger" }),
    });
  };

  return (
    <Sheet open={open} onClose={onClose} title={schedule ? t.care.editSchedule : t.care.addSchedule}>
      <div className="flex flex-col gap-4 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.care.typeLabel}>
            <Select value={type} disabled={!!schedule} onChange={(e) => pickType(e.target.value as ScheduleType)}>
              {SCHEDULE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {t.care.types[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t.care.categoryLabel}>
            <Select value={categoryLink} disabled={!!schedule} onChange={(e) => pickCategory(e.target.value as Category)}>
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {t.categories[cat]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t.care.nameLabel}>
          <TextInput value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        </Field>
        <DetailsFields category={categoryLink} values={details} onChange={setDetails} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.care.repeatLabel}>
            <Select value={unit} onChange={(e) => setUnit(e.target.value as RecurrenceUnit)}>
              {RECURRENCE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {recurrenceOptionLabel(u, Number(n) || 1, t)}
                </option>
              ))}
            </Select>
          </Field>
          {unit !== "once" && (
            <Field label={t.care.everyLabel}>
              <NumberInput value={n} min={1} step={1} onChange={(e) => setN(e.target.value)} />
            </Field>
          )}
        </div>
        <Field label={t.care.firstDueLabel}>
          <DateTimeInput valueMs={firstDueMs} onChangeMs={setFirstDueMs} />
        </Field>
        <Field label={`${t.care.endLabel} (${t.common.optional})`} hint={t.care.endHint}>
          <DateInput value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="text-sm font-semibold text-berry-600">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button className="flex-1" disabled={create.isPending || update.isPending} onClick={submit}>
            {t.common.save}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
        </div>
        {schedule && (
          <Button variant="danger" size="sm" disabled={remove.isPending} onClick={destroy}>
            {armDelete ? t.care.deleteConfirm : t.care.deleteSchedule}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
```

- [ ] **Step 5: Create `app/src/features/health/CareScheduleList.tsx`**

`DueBadge` and `recurrenceLabel` are exported — the Home care card (Task 13) reuses both.

```tsx
import type { Role, ScheduleResponse } from "@pawlog/shared";
import { useState } from "react";
import { useSchedules } from "../../api/schedules";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { CategoryIcon, categoryTone } from "../../components/CategoryIcon";
import { EmptyState } from "../../components/EmptyState";
import { Spinner } from "../../components/Spinner";
import { useLocaleTag, useT } from "../../i18n";
import type { Messages } from "../../i18n/messages";
import { cn } from "../../lib/cn";
import { dayKeyOf, dayStartMs, deviceTzOffsetMin, formatTime, todayKey } from "../../lib/dates";
import { ScheduleSheet } from "./ScheduleSheet";
import { useCompleteWithUndo } from "./useCompleteWithUndo";

export function recurrenceLabel(s: ScheduleResponse, t: Messages): string {
  const n = s.recurrenceN ?? 1;
  switch (s.recurrenceUnit) {
    case "once":
      return t.care.recurrence.once;
    case "hour":
      return t.care.recurrence.hours(n);
    case "day":
      return t.care.recurrence.days(n);
    case "week":
      return t.care.recurrence.weeks(n);
    case "month":
      return t.care.recurrence.months(n);
  }
}

export function DueBadge({ schedule }: { schedule: ScheduleResponse }) {
  const t = useT();
  const tag = useLocaleTag();
  const pill = "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold";
  if (!schedule.active) {
    return <span className={cn(pill, "bg-cream-200 text-ink-faint")}>{t.care.finishedBadge}</span>;
  }
  const now = Date.now();
  const tz = deviceTzOffsetMin();
  if (schedule.nextDueAt < now) {
    return <span className={cn(pill, "bg-berry-100 text-berry-700")}>{t.care.overdue}</span>;
  }
  const dueDay = dayKeyOf(schedule.nextDueAt, tz);
  const today = todayKey();
  if (dueDay === today) {
    return (
      <span className={cn(pill, "bg-clay-100 text-clay-800")}>
        {t.care.dueToday(formatTime(schedule.nextDueAt, tz, tag))}
      </span>
    );
  }
  const days = Math.round((dayStartMs(dueDay) - dayStartMs(today)) / 86_400_000);
  return <span className={cn(pill, "bg-cream-200 text-ink-soft")}>{t.care.dueIn(days)}</span>;
}

export function CareScheduleList({ petId, role }: { petId: string; role: Role }) {
  const t = useT();
  const schedules = useSchedules(petId);
  const { complete, isPending } = useCompleteWithUndo(petId);
  const [editing, setEditing] = useState<ScheduleResponse | null>(null);
  const canEdit = role !== "viewer";

  if (schedules.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  const items = schedules.data ?? [];

  return (
    <>
      {items.length === 0 ? (
        <Card className="p-0">
          <EmptyState title={t.care.emptyTitle} hint={t.care.emptyHint} />
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-cream-200">
            {items.map((s) => {
              const tone = categoryTone[s.categoryLink];
              return (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                      tone.soft,
                      tone.text,
                    )}
                  >
                    <CategoryIcon category={s.categoryLink} className="h-5 w-5" />
                  </span>
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    disabled={!canEdit}
                    onClick={() => setEditing(s)}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold text-ink">{s.name}</span>
                      <DueBadge schedule={s} />
                    </span>
                    <span className="block text-xs text-ink-faint">
                      {t.care.types[s.type]} · {recurrenceLabel(s, t)}
                    </span>
                  </button>
                  {canEdit && s.active && (
                    <Button size="sm" variant="soft" disabled={isPending} onClick={() => complete(s)}>
                      {t.care.complete}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <ScheduleSheet
        petId={petId}
        open={editing !== null}
        onClose={() => setEditing(null)}
        schedule={editing ?? undefined}
      />
    </>
  );
}
```

- [ ] **Step 6: Replace `app/src/routes/HealthTab.tsx`**

```tsx
import type { InsightsPeriod } from "@pawlog/shared";
import { INSIGHTS_PERIODS } from "@pawlog/shared";
import { useState } from "react";
import { useInsights } from "../api/insights";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { Spinner } from "../components/Spinner";
import { AnomalyBanners } from "../features/health/AnomalyBanners";
import { CareScheduleList } from "../features/health/CareScheduleList";
import { CareTimeline } from "../features/health/CareTimeline";
import { IntakeChart } from "../features/health/IntakeChart";
import { ScheduleSheet } from "../features/health/ScheduleSheet";
import { ToiletMatrix } from "../features/health/ToiletMatrix";
import { WeightChart } from "../features/health/WeightChart";
import { useT } from "../i18n";
import { useRequiredPet } from "../state/pets";

export function HealthTab() {
  const t = useT();
  const pet = useRequiredPet();
  const [period, setPeriod] = useState<InsightsPeriod>("4w");
  const [adding, setAdding] = useState(false);
  const insights = useInsights(pet.id, period);
  const canEdit = pet.role !== "viewer";
  const charts = insights.data;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="animate-pop text-2xl text-ink">{t.nav.health}</h1>

      {charts && charts.anomalies.length > 0 && (
        <AnomalyBanners petId={pet.id} petName={pet.name} anomalies={charts.anomalies} />
      )}

      <div className="animate-pop flex gap-2" role="group" aria-label={t.nav.health}>
        {INSIGHTS_PERIODS.map((p) => (
          <Chip key={p} selected={period === p} onClick={() => setPeriod(p)}>
            {t.health.periods[p]}
          </Chip>
        ))}
      </div>

      {!charts ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-4 md:grid md:grid-cols-2">
          <Card className="animate-pop">
            <h2 className="mb-2 font-display text-lg text-ink">{t.health.weightTitle}</h2>
            <WeightChart series={charts.weight} buckets={charts.buckets} bucket={charts.bucket} />
          </Card>
          <Card className="animate-pop" style={{ animationDelay: "60ms" }}>
            <h2 className="mb-2 font-display text-lg text-ink">{t.health.intakeTitle}</h2>
            <IntakeChart intake={charts.intake} buckets={charts.buckets} bucket={charts.bucket} />
          </Card>
          <Card className="animate-pop" style={{ animationDelay: "120ms" }}>
            <h2 className="mb-2 font-display text-lg text-ink">{t.health.toiletTitle}</h2>
            <ToiletMatrix rows={charts.toilet} buckets={charts.buckets} bucket={charts.bucket} />
          </Card>
          <Card className="animate-pop" style={{ animationDelay: "180ms" }}>
            <h2 className="mb-2 font-display text-lg text-ink">{t.health.timelineTitle}</h2>
            <CareTimeline
              timeline={charts.timeline}
              windowStart={charts.windowStart}
              windowEnd={charts.windowEnd}
            />
          </Card>
        </div>
      )}

      <section className="animate-pop" style={{ animationDelay: "240ms" }}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-lg text-ink">{t.care.title}</h2>
          {canEdit && (
            <Button size="sm" onClick={() => setAdding(true)}>
              {t.care.addSchedule}
            </Button>
          )}
        </div>
        <CareScheduleList petId={pet.id} role={pet.role} />
      </section>

      <ScheduleSheet petId={pet.id} open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
```

- [ ] **Step 7: Remove the placeholder keys**

The old `HealthTab` placeholder is gone, so delete `soonTitle` and `soonBody` from the `health` section in `app/src/i18n/messages.ts`, `en.ts`, and `ja.ts` (typecheck enforces all three move together).

- [ ] **Step 8: Verify**

Run: `npm run typecheck -w app && npm run build -w app`
Expected: clean. Manual smoke (`npm run dev`): Health tab shows period chips, four charts (empty states until data exists), the care list; add a "Heart pills / every day" schedule → it appears with a due badge; Done → undo toast restores it (badge returns, the medication activity disappears from Home's "today so far"); editing can't change type/category; delete needs the second tap.

- [ ] **Step 9: Commit**

```bash
git add app/src/features/health/ app/src/routes/HealthTab.tsx app/src/i18n/
git commit -m "feat: assemble health tab with charts and care schedule management"
```

---

### Task 13: Home slots go live — care card + anomaly banners; final wire-check + README

**Files:**
- Create: `app/src/features/health/CareCard.tsx`
- Modify: `app/src/routes/Home.tsx` (full replacement)
- Modify: `app/src/i18n/messages.ts`, `app/src/i18n/en.ts`, `app/src/i18n/ja.ts` (remove the two placeholder keys)
- Modify: `README.md`

- [ ] **Step 1: Create `app/src/features/health/CareCard.tsx`**

Shows overdue + due-today items (max 4) with the same complete/undo flow as the Health tab, plus a "see all" link. Renders nothing while loading or when the pet has no schedules at all (keeps Home clean); shows a gentle all-done line when schedules exist but nothing is due.

```tsx
import type { Role } from "@pawlog/shared";
import { Link } from "react-router";
import { useCareStatus } from "../../api/schedules";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { CategoryIcon, categoryTone } from "../../components/CategoryIcon";
import { SproutIcon } from "../../components/icons";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { DueBadge } from "./CareScheduleList";
import { useCompleteWithUndo } from "./useCompleteWithUndo";

const MAX_ITEMS = 4;

export function CareCard({ petId, role }: { petId: string; role: Role }) {
  const t = useT();
  const status = useCareStatus(petId);
  const { complete, isPending } = useCompleteWithUndo(petId);
  if (!status.data) return null; // loading/error: the card pops in when ready
  const due = [...status.data.overdue, ...status.data.today];
  if (due.length === 0 && status.data.upcoming.length === 0) return null; // nothing scheduled
  const canEdit = role !== "viewer";

  return (
    <Card data-slot="care-items" className="animate-pop p-0" style={{ animationDelay: "60ms" }}>
      <div className="flex items-center justify-between px-4 pt-3">
        <p className="flex items-center gap-2 font-display text-ink">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-moss-100 text-moss-600">
            <SproutIcon className="h-4 w-4" />
          </span>
          {t.care.homeTitle}
        </p>
        <Link to="/health" className="text-sm font-semibold text-clay-600 underline-offset-4 hover:underline">
          {t.care.seeAll}
        </Link>
      </div>
      {due.length === 0 ? (
        <p className="px-4 pb-4 pt-2 text-sm text-ink-soft">{t.care.homeAllDone}</p>
      ) : (
        <ul className="divide-y divide-cream-200 pt-1">
          {due.slice(0, MAX_ITEMS).map((s) => {
            const tone = categoryTone[s.categoryLink];
            return (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    tone.soft,
                    tone.text,
                  )}
                >
                  <CategoryIcon category={s.categoryLink} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-ink">{s.name}</span>
                    <DueBadge schedule={s} />
                  </span>
                </span>
                {canEdit && (
                  <Button size="sm" variant="soft" disabled={isPending} onClick={() => complete(s)}>
                    {t.care.complete}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Replace `app/src/routes/Home.tsx`**

The two Plan-3 placeholder slots become real components; everything else (greeting, today-so-far, Quick Add) is unchanged.

```tsx
import { Link, useOutletContext } from "react-router";
import { useActivitiesRange } from "../api/activities";
import { useAnomalies } from "../api/insights";
import { ActivityRow } from "../components/ActivityRow";
import { PetAvatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { Spinner } from "../components/Spinner";
import { AnomalyBanners } from "../features/health/AnomalyBanners";
import { CareCard } from "../features/health/CareCard";
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
  const anomalies = useAnomalies(pet.id);
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

      {/* anomaly banners (lightweight rules-only endpoint), deep-linked to Health */}
      <AnomalyBanners
        petId={pet.id}
        petName={pet.name}
        anomalies={anomalies.data?.anomalies ?? []}
        linkToHealth
      />

      {/* care items: overdue / due today, complete with undo */}
      <CareCard petId={pet.id} role={pet.role} />

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

- [ ] **Step 3: Remove the placeholder keys**

Delete `careSoonTitle` and `careSoonBody` from the `home` section in `app/src/i18n/messages.ts`, `en.ts`, and `ja.ts` (their only consumer was the old slot card).

- [ ] **Step 4: Full-stack verification**

Run: `npm run typecheck`
Expected: shared, worker, and app all clean.

Run: `npm run test`
Expected: app builds, ALL worker tests pass (Plans 1–3 suites + the ~52 added by this plan), all app unit tests pass.

- [ ] **Step 5: Dev smoke (`npm run dev -w worker` in the background)**

```bash
curl -s -X POST http://localhost:8787/api/auth/dev-login -H "Content-Type: application/json" -d '{}' -c /tmp/pawlog.jar
CSRF=$(curl -s http://localhost:8787/api/me -b /tmp/pawlog.jar | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
PET=$(curl -s -X POST http://localhost:8787/api/pets -b /tmp/pawlog.jar -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" -d '{"name":"Momo","species":"cat"}' | sed -E 's/.*"id":"([^"]+)".*/\1/')
SCHED=$(curl -s -X POST "http://localhost:8787/api/pets/$PET/schedules" -b /tmp/pawlog.jar -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" -d "{\"type\":\"medication\",\"name\":\"Heart pills\",\"categoryLink\":\"medication\",\"detailsTemplate\":{\"name\":\"Heart pills\"},\"recurrenceUnit\":\"day\",\"recurrenceN\":1,\"nextDueAt\":$(($(date +%s) * 1000))}" | sed -E 's/.*"id":"([^"]+)".*/\1/')
curl -s -X POST "http://localhost:8787/api/pets/$PET/schedules/$SCHED/complete" -b /tmp/pawlog.jar -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" -d '{"tzOffsetMin":540}'
curl -s "http://localhost:8787/api/pets/$PET/care-status?tz=540" -b /tmp/pawlog.jar
curl -s "http://localhost:8787/api/pets/$PET/insights?period=4w&tz=540" -b /tmp/pawlog.jar
curl -s "http://localhost:8787/api/pets/$PET/anomalies?tz=540" -b /tmp/pawlog.jar
```

Expected: complete returns `{"data":{"activity":{...,"details":{"name":"Heart pills","scheduleId":"..."}},"schedule":{...}}}`; care-status shows the schedule under `today` or `upcoming` (advanced by one day); insights returns all four datasets + `anomalies`; the anomalies call returns `{"data":{"anomalies":[...]}}`. Stop the background worker afterward.

- [ ] **Step 6: End-to-end manual checklist (`npm run dev`, mobile viewport first)**

- [ ] Health tab: switch 4w / 3m / 1y — charts rebucket (1y axis shows week labels); each chart shows its illustrated empty state with no data.
- [ ] Log a few weights/food/water/toilet/symptom entries → charts populate; weight pct badge appears with ≥2 weighings.
- [ ] Create "Heart pills, every day, first due now" → due badge "Today HH:MM"; Done → toast undo restores schedule + removes the logged activity.
- [ ] Home: overdue/today care card with Done buttons; 5th+ item hidden behind "See all" → Health.
- [ ] Log 2 diarrhea toilet entries → warning banner on Home (after refetch) and Health; dismiss hides it for the day; deep link lands on Health.
- [ ] As a viewer-role member (seed via SQL if needed): no add/complete/edit controls, charts and list still visible.
- [ ] EN ↔ JA switch localizes schedule types, recurrence labels, badges, anomaly copy, chart legends.

- [ ] **Step 7: Append a Care & Analyzer section to `README.md`**

Add after the "Frontend" section:

```markdown
## Care & Analyzer

Care schedules (`care_schedules`) drive proactive reminders: each schedule
links an activity category to a details template; completing one atomically
logs the activity and advances `next_due_at` by its interval (anchored to the
previous due time; `once` and past-`end_at` schedules deactivate).
`GET /api/pets/:petId/care-status?tz=` buckets active schedules into
overdue / today / upcoming-7d for the Home card and the Health tab.

The Health Analyzer (`GET /api/pets/:petId/insights?period=4w|3m|1y&tz=`)
returns four chart datasets in one call — weight trend (7-point average,
min/max band, % change), food/water vs daily targets, a toilet-pattern
matrix, and a symptom/medication timeline with vet-visit markers — bucketed
by household day (ISO week for 1y), plus structured anomaly flags (weight
drift, toilet trouble, quiet day, symptom streak; advisory, never
diagnostic). A lightweight `GET /api/pets/:petId/anomalies?tz=` powers the
Home banners. Charts are hand-rolled SVG in `app/src/features/health/`;
anomaly copy is rendered client-side from the typed EN/JA catalogs.
```

- [ ] **Step 8: Commit**

```bash
git add app/src/features/health/CareCard.tsx app/src/routes/Home.tsx app/src/i18n/ README.md
git commit -m "feat: wire home care card and anomaly banners and document plan 4"
```

---

## Done criteria for Plan 4

- Root `npm run typecheck` and `npm run test` green (Plans 1–3 suites + ~52 new worker tests + the extended app unit tests).
- Every spec §5 Care & Analyzer route exists and is integration-tested: `GET/POST /schedules`, `PATCH/DELETE /schedules/:id`, `POST /schedules/:id/complete` (atomic, returns `{ activity, schedule }`), `GET /care-status`, `GET /insights?period=` — plus `GET /anomalies` (additive).
- Spec §7 fully covered: the 4 charts (weight scatter+line w/ 7-point average, min/max band, % change; intake bars vs dashed targets with hollow not-logged markers; toilet day-rows × pee/poop matrix colored by count+worst condition; symptom/medication spans + vet markers), the 4 anomaly rules with the exact thresholds, the care-status buckets, advisory non-diagnostic copy, deep links, and client-side dismissal that re-evaluates on new days/data.
- Completion atomicity is asserted (activity row + advanced schedule + both audit rows from one call); recurrence math incl. the "2×/day for 7 days = 14 doses" spec example is unit-tested; every new route group has the 401/403/404 authz matrix.
- The Health tab and the two Home slots are real, on-palette (clay/cream/category accents), fully localized in EN + JA, and respect roles (viewers get a read-only Health tab).
- The worker diff contains no schema/migration changes (only the type-only `CareSchedule` export and the `export` keyword on `activityToResponse`).

## Spec deviations encoded in this plan (intentional)

1. **No Recharts** — spec §2 lists it; the four charts are hand-rolled SVG components (bundle cost, full design control). No new dependency.
2. **Anomaly copy is client-side** — the API returns structured `{ rule, severity, params }`; the spec's advisory wording ("consider asking your vet") lives in the typed EN/JA catalogs, not in server strings.
3. **`tz` query param added** to `care-status` / `insights` / `anomalies` — spec §5 doesn't list it, but "due today", "by 18:00 household time", and period windows are undefined without the household clock; the client sends its device offset.
4. **`GET /api/pets/:petId/anomalies` added** (not in spec §5) — a rules-only endpoint so the Home banner doesn't pay for four chart datasets; insights embeds the same flags.
5. **Toilet matrix uses ISO-week rows for 1y** — spec §7 says "day-rows"; 365 rows is unusable, so the matrix follows the period bucket (days for 4w/3m, weeks for 1y with summed counts / worst condition).
6. **Food intake counts grams only** (`unit='g'`); ml/pieces food entries are excluded from the grams chart and a hint says so — mixed units cannot be honestly summed against a grams target.
7. **Schedule hard delete** — activities/pets soft-delete or cascade per spec §4, which is silent on schedules; logged activities + audit rows preserve history.
8. **Weight-drift baseline made precise** — spec §7's "vs 30 days ago" is implemented as the mean over a 14-day window centered 30 days ago ([−37 d, −23 d]), with ≥1 weighing in each of the two (disjoint) windows satisfying "≥2 weighings".
9. **Symptom-streak recency bound** — the ≥3-day run must end today or yesterday; otherwise an old streak would flag forever (spec: flags "reappear only on new triggering data").
10. **Type-only `CareSchedule` export added to the frozen `schema.ts`** — no SQL, no migration; sanctioned in the header.

## Next plans

5. **PWA & Polish** — vite-plugin-pwa manifest + service worker (app-shell precache, API stale-while-revalidate with the "showing cached data" indicator, photos cache-first), iOS install hint, offline read indicator, final design/performance polish pass.
