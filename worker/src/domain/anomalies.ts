import type { Anomaly } from "@pawary/shared";
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
