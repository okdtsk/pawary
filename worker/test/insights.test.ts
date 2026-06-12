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
    const now = Date.now();
    await seedActivity(petId, userId, { category: "weight", occurredAt: now - 10 * DAY, tzOffsetMin: TZ, details: { kg: 4.0 } });
    // two weighings on the same household day — only the later one counts
    await seedActivity(petId, userId, { category: "weight", occurredAt: now - 2 * DAY, tzOffsetMin: TZ, details: { kg: 9.9 } });
    await seedActivity(petId, userId, { category: "weight", occurredAt: now - 2 * DAY + HOUR, tzOffsetMin: TZ, details: { kg: 4.4 } });

    const { status, body } = await insights(petId, cookie);
    expect(status).toBe(200);
    expect(body.data.period).toBe("4w");
    expect(body.data.bucket).toBe("day");
    expect(body.data.buckets).toHaveLength(28);
    expect(body.data.weight.points.map((p) => [p.bucket, p.kg])).toEqual([
      [dayKey(now - 10 * DAY, TZ), 4.0],
      [dayKey(now - 2 * DAY + HOUR, TZ), 4.4],
    ]);
    expect(body.data.weight.min).toBe(4.0);
    expect(body.data.weight.max).toBe(4.4);
    expect(body.data.weight.pctChange).toBe(10);
  });

  it("intake: sums food grams (g only) and water ml per day; absent ≠ zero", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    const day = dayKey(now - DAY, TZ);
    await seedActivity(petId, userId, { category: "food", occurredAt: now - DAY, tzOffsetMin: TZ, details: { foodType: "dry", unit: "g", amount: 60 } });
    await seedActivity(petId, userId, { category: "food", occurredAt: now - DAY + HOUR, tzOffsetMin: TZ, details: { foodType: "wet", unit: "g", amount: 40 } });
    await seedActivity(petId, userId, { category: "food", occurredAt: now - DAY, tzOffsetMin: TZ, details: { foodType: "wet", unit: "ml", amount: 500 } }); // ml excluded
    await seedActivity(petId, userId, { category: "food", occurredAt: now - DAY, tzOffsetMin: TZ, details: { foodType: "treat", unit: "pieces", amount: 3 } }); // pieces excluded
    await seedActivity(petId, userId, { category: "food", occurredAt: now - DAY, tzOffsetMin: TZ, details: { foodType: "dry", unit: "g" } }); // no amount → excluded
    await seedActivity(petId, userId, { category: "water", occurredAt: now - DAY, tzOffsetMin: TZ, details: { amountMl: 120 } });

    const { body } = await insights(petId, cookie);
    expect(body.data.intake.food).toEqual({ [day]: 100 });
    expect(body.data.intake.water).toEqual({ [day]: 120 });
    expect(body.data.intake.targets).toBeNull(); // none set for this pet
  });

  it("toilet matrix: per-day cells with count and worst condition", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    const day = dayKey(now - DAY, TZ);
    await seedActivity(petId, userId, { category: "toilet", occurredAt: now - DAY, tzOffsetMin: TZ, details: { kind: "poop", condition: "normal" } });
    await seedActivity(petId, userId, { category: "toilet", occurredAt: now - DAY + HOUR, tzOffsetMin: TZ, details: { kind: "poop", condition: "diarrhea" } });
    await seedActivity(petId, userId, { category: "toilet", occurredAt: now - DAY, tzOffsetMin: TZ, details: { kind: "pee", condition: "normal" } });

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
