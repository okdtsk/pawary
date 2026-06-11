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
