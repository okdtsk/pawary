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
