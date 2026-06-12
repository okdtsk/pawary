import { SELF } from "cloudflare:test";
import type { InsightsResponse } from "@pawary/shared";
import { describe, expect, it } from "vitest";
import { seedActivity, seedPet, seedUserWithSession } from "./helpers";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TZ = 540; // JST

/** Same day-key math the server uses — for computing expected bucket keys. */
function dayKey(ms: number, tz: number): string {
  const d = new Date(ms + tz * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Noon of the calendar day that is `daysBack` before today's household day
 * (computed in tz=TZ).  Using noon rather than midnight means any wall-clock
 * time — including the few milliseconds around local midnight — keeps the
 * seed firmly inside the intended day bucket.
 *
 * Algorithm:
 *   1. Find today's household day-key (the day "now" falls in for TZ=540).
 *   2. Step back `daysBack` full calendar days.
 *   3. Return UTC midnight of that day (ISO date) + TZ offset inverted back to
 *      UTC, then add 12 hours for noon.  Equivalently: the UTC instant whose
 *      local TZ time is noon on (today – daysBack).
 */
function householdNoon(daysBack: number): number {
  // UTC midnight of today's TZ-local calendar day
  const nowLocal = Date.now() + TZ * 60_000;
  const todayMidnightLocal = nowLocal - (nowLocal % DAY); // truncate to day
  const targetMidnightLocal = todayMidnightLocal - daysBack * DAY;
  // Convert back to UTC, then add 12 hours for noon
  return targetMidnightLocal - TZ * 60_000 + 12 * HOUR;
}

async function insights(petId: string, cookie: string, query = `period=4w&tz=${TZ}`) {
  const res = await SELF.fetch(`https://app.local/api/pets/${petId}/insights?${query}`, {
    headers: { Cookie: cookie },
  });
  return { status: res.status, body: (await res.json()) as { data: InsightsResponse } };
}

describe("GET /api/pets/:petId/insights", () => {
  it("returns the weight series with latest-per-day points and pct change", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    // Seed at household noon so the day bucket is stable at any wall-clock time.
    const noon10 = householdNoon(10);
    const noon2 = householdNoon(2);
    await seedActivity(petId, userId, { category: "weight", occurredAt: noon10, tzOffsetMin: TZ, details: { kg: 4.0 } });
    // two weighings on the same household day — only the later one counts
    await seedActivity(petId, userId, { category: "weight", occurredAt: noon2, tzOffsetMin: TZ, details: { kg: 9.9 } });
    await seedActivity(petId, userId, { category: "weight", occurredAt: noon2 + HOUR, tzOffsetMin: TZ, details: { kg: 4.4 } });

    const { status, body } = await insights(petId, cookie);
    expect(status).toBe(200);
    expect(body.data.period).toBe("4w");
    expect(body.data.bucket).toBe("day");
    expect(body.data.buckets).toHaveLength(28);
    expect(body.data.weight.points.map((p) => [p.bucket, p.kg])).toEqual([
      [dayKey(noon10, TZ), 4.0],
      [dayKey(noon2 + HOUR, TZ), 4.4],
    ]);
    expect(body.data.weight.min).toBe(4.0);
    expect(body.data.weight.max).toBe(4.4);
    expect(body.data.weight.pctChange).toBe(10);
  });

  it("intake: sums food grams (g only) and water ml per day; absent ≠ zero", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    // Anchor at household noon so the day bucket is stable at any wall-clock time.
    const noon1 = householdNoon(1);
    const day = dayKey(noon1, TZ);
    await seedActivity(petId, userId, { category: "food", occurredAt: noon1, tzOffsetMin: TZ, details: { foodType: "dry", unit: "g", amount: 60 } });
    await seedActivity(petId, userId, { category: "food", occurredAt: noon1 + HOUR, tzOffsetMin: TZ, details: { foodType: "wet", unit: "g", amount: 40 } });
    await seedActivity(petId, userId, { category: "food", occurredAt: noon1, tzOffsetMin: TZ, details: { foodType: "wet", unit: "ml", amount: 500 } }); // ml excluded
    await seedActivity(petId, userId, { category: "food", occurredAt: noon1, tzOffsetMin: TZ, details: { foodType: "treat", unit: "pieces", amount: 3 } }); // pieces excluded
    await seedActivity(petId, userId, { category: "food", occurredAt: noon1, tzOffsetMin: TZ, details: { foodType: "dry", unit: "g" } }); // no amount → excluded
    await seedActivity(petId, userId, { category: "water", occurredAt: noon1, tzOffsetMin: TZ, details: { amountMl: 120 } });

    const { body } = await insights(petId, cookie);
    expect(body.data.intake.food).toEqual({ [day]: 100 });
    expect(body.data.intake.water).toEqual({ [day]: 120 });
    expect(body.data.intake.targets).toBeNull(); // none set for this pet
  });

  it("toilet matrix: per-day cells with count and worst condition", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    // Anchor at household noon so the day bucket is stable at any wall-clock time.
    const noon1 = householdNoon(1);
    const day = dayKey(noon1, TZ);
    await seedActivity(petId, userId, { category: "toilet", occurredAt: noon1, tzOffsetMin: TZ, details: { kind: "poop", condition: "normal" } });
    await seedActivity(petId, userId, { category: "toilet", occurredAt: noon1 + HOUR, tzOffsetMin: TZ, details: { kind: "poop", condition: "diarrhea" } });
    await seedActivity(petId, userId, { category: "toilet", occurredAt: noon1, tzOffsetMin: TZ, details: { kind: "pee", condition: "normal" } });

    const { body } = await insights(petId, cookie);
    const row = body.data.toilet.find((r) => r.bucket === day);
    expect(row?.poop).toEqual({ count: 2, worst: "diarrhea" });
    expect(row?.pee).toEqual({ count: 1, worst: "normal" });
  });

  it("timeline: medication/symptom spans grouped by name, vet visits as markers", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    await seedActivity(petId, userId, { category: "medication", occurredAt: now - 5 * DAY, tzOffsetMin: TZ, details: { name: "Antibiotic" } });
    await seedActivity(petId, userId, { category: "medication", occurredAt: now - 2 * DAY, tzOffsetMin: TZ, details: { name: "Antibiotic" } });
    await seedActivity(petId, userId, { category: "symptom", occurredAt: now - 4 * DAY, tzOffsetMin: TZ, details: { name: "Limping", severity: "mild" } });
    await seedActivity(petId, userId, { category: "symptom", occurredAt: now - 3 * DAY, tzOffsetMin: TZ, details: { name: "Limping", severity: "severe" } });
    await seedActivity(petId, userId, { category: "vet_visit", occurredAt: now - 3 * DAY, tzOffsetMin: TZ, details: { clinic: "Sakura Clinic" } });

    const { body } = await insights(petId, cookie);
    const med = body.data.timeline.medications[0];
    expect(med?.name).toBe("Antibiotic");
    expect(med?.count).toBe(2);
    expect(med?.firstAt).toBe(now - 5 * DAY + TZ * 60_000); // household-naive ms
    expect(med?.lastAt).toBe(now - 2 * DAY + TZ * 60_000);
    const sym = body.data.timeline.symptoms[0];
    expect(sym?.maxSeverity).toBe("severe");
    expect(body.data.timeline.vetVisits).toEqual([
      { at: now - 3 * DAY + TZ * 60_000, clinic: "Sakura Clinic" },
    ]);
    expect(body.data.windowEnd).toBeGreaterThan(body.data.windowStart);
  });

  it("1y uses ISO week buckets", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    await seedActivity(petId, userId, { category: "weight", occurredAt: now - 10 * DAY, tzOffsetMin: TZ, details: { kg: 4.0 } });
    await seedActivity(petId, userId, { category: "weight", occurredAt: now - DAY, tzOffsetMin: TZ, details: { kg: 4.2 } });
    const { body } = await insights(petId, cookie, `period=1y&tz=${TZ}`);
    expect(body.data.bucket).toBe("week");
    for (const p of body.data.weight.points) {
      expect(p.bucket).toMatch(/^\d{4}-W\d{2}$/);
      expect(body.data.buckets).toContain(p.bucket);
    }
  });

  it("returns pet targets when set", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const put = await SELF.fetch(`https://app.local/api/pets/${petId}/targets`, {
      method: "PUT",
      headers: { Cookie: cookie, "X-CSRF-Token": csrfToken, "Content-Type": "application/json" },
      body: JSON.stringify({ foodGPerDay: 60, waterMlPerDay: 250 }),
    });
    expect(put.status).toBe(200);
    const { body } = await insights(petId, cookie);
    expect(body.data.intake.targets).toEqual({ foodGPerDay: 60, waterMlPerDay: 250 });
  });

  it("validates period and tz, and 404s non-members", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    for (const q of ["", "period=2w", "period=4w&tz=abc", "period=4w&tz=900"]) {
      const res = await insights(petId, cookie, q);
      expect(res.status).toBe(400);
    }
    const outsider = await seedUserWithSession({ email: "x@example.com" });
    const probe = await insights(petId, outsider.cookie);
    expect(probe.status).toBe(404);
  });
});
