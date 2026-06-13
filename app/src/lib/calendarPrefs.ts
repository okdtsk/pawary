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
    if (typeof window === "undefined") return;
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
      // the event dispatched inside writeCalendarPrefs drives the re-read via the effect listener
    },
    [],
  );

  return { prefs, setPref };
}
