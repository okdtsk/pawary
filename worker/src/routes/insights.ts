import type {
  Anomaly,
  AnomaliesResponse,
  CareSpan,
  InsightsPeriod,
  InsightsResponse,
  SymptomSpan,
  VetMarker,
} from "@pawlog/shared";
import { INSIGHTS_PERIODS } from "@pawlog/shared";
import { evaluateAnomalies, loadAnomalyInputs } from "../domain/anomalies";
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

    const now = Date.now();
    const anomalies: Anomaly[] = evaluateAnomalies(
      await loadAnomalyInputs(db, petId, tz, now),
      now,
      tz,
    );

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
