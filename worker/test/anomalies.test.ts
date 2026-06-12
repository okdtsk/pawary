import { SELF } from "cloudflare:test";
import type { AnomaliesResponse, Anomaly, InsightsResponse } from "@pawary/shared";
import { describe, expect, it } from "vitest";
import {
  quietDay,
  symptomStreaks,
  toiletTrouble,
  weightDrift,
} from "../src/domain/anomalies";
import { seedActivity, seedPet, seedUserWithSession } from "./helpers";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 5, 11, 12, 0);

describe("weightDrift (rule 1)", () => {
  const w = (daysAgo: number, kg: number) => ({ occurredAt: NOW - daysAgo * DAY, kg });

  it.each([
    // [name, weighings, expected pctChange or null]
    ["−6.1% drop triggers", [w(30, 4.6), w(2, 4.3), w(1, 4.34)], -6.1],
    ["exactly −5.0% triggers (≥ threshold)", [w(30, 4.0), w(1, 3.8)], -5.0],
    ["+5.5% rise triggers too", [w(30, 4.0), w(1, 4.22)], 5.5],
    ["−4.8% stays quiet", [w(30, 4.6), w(2, 4.4), w(1, 4.36)], null],
    ["no baseline weighing → null (needs ≥2 weighings)", [w(2, 4.3)], null],
    ["no recent weighing → null", [w(30, 4.6)], null],
    ["baseline outside the 23–37d window is ignored", [w(40, 5.0), w(1, 4.0)], null],
  ] as Array<[string, Array<{ occurredAt: number; kg: number }>, number | null]>)(
    "%s",
    (_name, weighings, expected) => {
      const result = weightDrift(weighings, NOW);
      if (expected === null) {
        expect(result).toBeNull();
      } else {
        expect(result).toEqual({
          rule: "weight_drift",
          severity: "warning",
          params: { pctChange: expected },
        });
      }
    },
  );

  it("averages multiple weighings inside each window", () => {
    // recent mean (4.3 + 4.5)/2 = 4.4 vs baseline mean (5.0 + 4.6)/2 = 4.8 → −8.3%
    const result = weightDrift(
      [w(30, 5.0), w(28, 4.6), w(3, 4.3), w(1, 4.5)],
      NOW,
    );
    expect(result?.params).toEqual({ pctChange: -8.3 });
  });
});

describe("toiletTrouble (rule 2)", () => {
  it.each([
    [0, null],
    [1, null],
    [2, 2],
    [5, 5],
  ] as Array<[number, number | null]>)("count %i", (count, expected) => {
    const result = toiletTrouble(count);
    if (expected === null) expect(result).toBeNull();
    else
      expect(result).toEqual({
        rule: "toilet_trouble",
        severity: "warning",
        params: { count: expected },
      });
  });
});

describe("quietDay (rule 3)", () => {
  // NOW is 12:00 UTC; tz 540 → 21:00 household, tz 300 → 17:00 household
  it("fires only at/after 18:00 household with zero food AND water", () => {
    expect(quietDay(0, 0, NOW, 540)).toEqual({
      rule: "quiet_day",
      severity: "info",
      params: {},
    });
    expect(quietDay(0, 0, NOW, 300)).toBeNull(); // 17:00 — too early
    expect(quietDay(1, 0, NOW, 540)).toBeNull(); // food was logged
    expect(quietDay(0, 2, NOW, 540)).toBeNull(); // water was logged
  });

  it("handles negative household offsets", () => {
    // 12:00 UTC − 14:00 = 22:00 previous household day → fires
    expect(quietDay(0, 0, NOW, -840)).not.toBeNull();
  });
});

describe("symptomStreaks (rule 4)", () => {
  const today = "2026-06-11";
  const d = (name: string, day: string) => ({ name, day });

  it("fires on ≥3 consecutive days ending today, with the run length", () => {
    const rows = [d("Limping", "2026-06-09"), d("Limping", "2026-06-10"), d("Limping", "2026-06-11")];
    expect(symptomStreaks(rows, today)).toEqual([
      { rule: "symptom_streak", severity: "warning", params: { name: "Limping", days: 3 } },
    ]);
  });

  it("a run ending yesterday still fires; a gap breaks the run", () => {
    const endsYesterday = [
      d("Cough", "2026-06-07"),
      d("Cough", "2026-06-08"),
      d("Cough", "2026-06-09"),
      d("Cough", "2026-06-10"),
    ];
    expect(symptomStreaks(endsYesterday, today)[0]?.params).toEqual({ name: "Cough", days: 4 });

    const gap = [d("Cough", "2026-06-07"), d("Cough", "2026-06-09"), d("Cough", "2026-06-10")];
    expect(symptomStreaks(gap, today)).toEqual([]); // only 2 consecutive reach yesterday
  });

  it("a stale run (ended 3 days ago) and short runs stay quiet; names are independent", () => {
    const stale = [d("Itch", "2026-06-06"), d("Itch", "2026-06-07"), d("Itch", "2026-06-08")];
    expect(symptomStreaks(stale, today)).toEqual([]);
    const short = [d("Itch", "2026-06-10"), d("Itch", "2026-06-11")];
    expect(symptomStreaks(short, today)).toEqual([]);
    const two = [
      d("Itch", "2026-06-09"), d("Itch", "2026-06-10"), d("Itch", "2026-06-11"),
      d("Limp", "2026-06-09"), d("Limp", "2026-06-10"), d("Limp", "2026-06-11"),
    ];
    expect(symptomStreaks(two, today)).toHaveLength(2);
  });
});

describe("GET /api/pets/:petId/anomalies (+ insights integration)", () => {
  /** A tz (valid −840..840) that puts the household clock at 18:00–22:59 right now. */
  function eveningTz(now: number): number {
    for (let tz = -840; tz <= 840; tz += 30) {
      const hour = Math.floor((((now + tz * 60_000) % DAY) + DAY) % DAY / HOUR);
      if (hour >= 18 && hour <= 22) return tz;
    }
    throw new Error("unreachable: ±14h covers every hour");
  }

  it("returns structured anomalies from minimal queries", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    const tz = eveningTz(now);
    // toilet trouble: 2 diarrhea in the last 72 h
    await seedActivity(petId, userId, { category: "toilet", occurredAt: now - HOUR, tzOffsetMin: tz, details: { kind: "poop", condition: "diarrhea" } });
    await seedActivity(petId, userId, { category: "toilet", occurredAt: now - 2 * DAY, tzOffsetMin: tz, details: { kind: "poop", condition: "bloody" } });
    // symptom streak: 3 consecutive household days ending today
    for (const back of [0, 1, 2]) {
      await seedActivity(petId, userId, { category: "symptom", occurredAt: now - back * DAY, tzOffsetMin: tz, details: { name: "Limping", severity: "mild" } });
    }
    // no food/water today + evening tz ⇒ quiet day

    const res = await SELF.fetch(`https://app.local/api/pets/${petId}/anomalies?tz=${tz}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: AnomaliesResponse };
    const byRule = new Map(data.anomalies.map((a) => [a.rule, a]));
    expect(byRule.get("toilet_trouble")?.params).toEqual({ count: 2 });
    expect(byRule.get("quiet_day")?.severity).toBe("info");
    const streak = byRule.get("symptom_streak") as Extract<Anomaly, { rule: "symptom_streak" }>;
    expect(streak.params.name).toBe("Limping");
    expect(streak.params.days).toBeGreaterThanOrEqual(3);
  });

  it("quiet day disappears once water is logged today", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    const tz = eveningTz(now);
    await seedActivity(petId, userId, { category: "water", occurredAt: now - HOUR, tzOffsetMin: tz, details: { amountMl: 100 } });
    const res = await SELF.fetch(`https://app.local/api/pets/${petId}/anomalies?tz=${tz}`, {
      headers: { Cookie: cookie },
    });
    const { data } = (await res.json()) as { data: AnomaliesResponse };
    expect(data.anomalies.find((a) => a.rule === "quiet_day")).toBeUndefined();
  });

  it("insights returns the same anomalies; anomalies endpoint validates tz and 404s outsiders", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    await seedActivity(petId, userId, { category: "toilet", occurredAt: now - HOUR, tzOffsetMin: 0, details: { kind: "poop", condition: "diarrhea" } });
    await seedActivity(petId, userId, { category: "toilet", occurredAt: now - 2 * HOUR, tzOffsetMin: 0, details: { kind: "poop", condition: "diarrhea" } });

    const ins = await SELF.fetch(`https://app.local/api/pets/${petId}/insights?period=4w&tz=0`, {
      headers: { Cookie: cookie },
    });
    const { data } = (await ins.json()) as { data: InsightsResponse };
    expect(data.anomalies.find((a) => a.rule === "toilet_trouble")?.params).toEqual({ count: 2 });

    const bad = await SELF.fetch(`https://app.local/api/pets/${petId}/anomalies?tz=abc`, {
      headers: { Cookie: cookie },
    });
    expect(bad.status).toBe(400);
    const outsider = await seedUserWithSession({ email: "x@example.com" });
    const probe = await SELF.fetch(`https://app.local/api/pets/${petId}/anomalies?tz=0`, {
      headers: { Cookie: outsider.cookie },
    });
    expect(probe.status).toBe(404);
  });
});
