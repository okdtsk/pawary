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
