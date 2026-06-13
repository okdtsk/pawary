import { isoWeekKey, isoWeekStartDay } from "@pawary/shared";
import { describe, expect, it } from "vitest";
import {
  addDays,
  dayEndMs,
  dayKeyOf,
  dayStartMs,
  formatMonthDay,
  formatTime,
  isWeekend,
  localComposeMs,
  localDayKey,
  minutesIntoDay,
  monthGrid,
  monthKeyOf,
  relativeDayKind,
  shiftAnchor,
  shiftMonth,
  tzOffsetMinFor,
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
  it("3day puts anchor last (today on right); day is just the anchor", () => {
    expect(viewDays("3day", "2026-06-13")).toEqual([
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

describe("chart axis helpers (plan 4)", () => {
  it("formatMonthDay renders a short axis label", () => {
    expect(formatMonthDay("2026-06-08", "en")).toBe("Jun 8");
  });

  it("shared ISO week math is importable from the app side", () => {
    expect(isoWeekKey("2026-06-12")).toBe("2026-W24");
    expect(isoWeekStartDay("2026-W24")).toBe("2026-06-08");
  });
});

describe("wheel-picker local helpers", () => {
  it("round-trips an instant through localDayKey + localComposeMs", () => {
    const ms = new Date(2026, 5, 12, 9, 30).getTime();
    expect(localDayKey(ms)).toBe("2026-06-12");
    expect(localComposeMs("2026-06-12", 9, 30)).toBe(ms);
  });

  it("zeroes seconds when composing", () => {
    const withSeconds = new Date(2026, 0, 1, 23, 59, 45).getTime();
    expect(localComposeMs(localDayKey(withSeconds), 23, 59)).toBe(
      new Date(2026, 0, 1, 23, 59).getTime(),
    );
  });

  it("composes across month boundaries via day-keys", () => {
    expect(localComposeMs("2026-03-01", 0, 0)).toBe(
      new Date(2026, 2, 1).getTime(),
    );
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
