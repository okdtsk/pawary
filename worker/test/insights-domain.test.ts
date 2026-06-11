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
