/**
 * Date math for Pawary views.
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

/** Today's day-key. Pass a household offset to bucket in a chosen zone. */
export function todayKey(
  now: number = Date.now(),
  tzOffsetMin: number = deviceTzOffsetMin(),
): DayKey {
  return dayKeyOf(now, tzOffsetMin);
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

/** Start of a day in epoch ms. With a household offset, brackets that zone's day. */
export function dayStartMs(key: DayKey, tzOffsetMin?: number): number {
  const { year, month, day } = dayKeyToParts(key);
  if (tzOffsetMin !== undefined) {
    return Date.UTC(year, month - 1, day) - tzOffsetMin * MIN_MS;
  }
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

/** Inclusive epoch-ms range covering a consecutive day-key span. */
export function rangeMs(
  days: DayKey[],
  tzOffsetMin?: number,
): { from: number; to: number } {
  const first = days[0] ?? todayKey();
  const last = days[days.length - 1] ?? first;
  return { from: dayStartMs(first, tzOffsetMin), to: dayEndMs(last, tzOffsetMin) };
}

/** ISO weekday 0=Monday .. 6=Sunday for a day-key. */
function mondayIndex(key: DayKey): number {
  const { year, month, day } = dayKeyToParts(key);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/** True when a day-key falls on Saturday or Sunday. */
export function isWeekend(key: DayKey): boolean {
  const { year, month, day } = dayKeyToParts(key);
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return dow === 0 || dow === 6;
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
  if (view === "3day") return [addDays(anchor, -2), addDays(anchor, -1), anchor];
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

/** Device-local day-key of an instant (wheel-picker decomposition). */
export function localDayKey(ms: number): DayKey {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Device-local epoch ms for a day-key + wall-clock hour/minute (seconds zeroed). */
export function localComposeMs(key: DayKey, hour: number, minute: number): number {
  const { year, month, day } = dayKeyToParts(key);
  return new Date(year, month - 1, day, hour, minute).getTime();
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

/** Short month+day label for chart axes ("Jun 8" / 「6月8日」). */
export function formatMonthDay(key: DayKey, locale: string): string {
  const { year, month, day } = dayKeyToParts(key);
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
