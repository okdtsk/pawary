import { beforeEach, describe, expect, it } from "vitest";
import {
  readCalendarPrefs,
  writeCalendarPrefs,
  householdTimeZone,
  householdTzOffsetMin,
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
    get length() {
      return store.size;
    },
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

  it("householdTzOffsetMin uses the stored zone", () => {
    writeCalendarPrefs({ timeZone: "Asia/Tokyo" });
    expect(householdTzOffsetMin(Date.UTC(2026, 0, 1))).toBe(540);
  });

  it("survives corrupt JSON", () => {
    globalThis.localStorage.setItem("pawary.calendarPrefs", "{not json");
    expect(readCalendarPrefs().startHour).toBe(7);
  });
});
