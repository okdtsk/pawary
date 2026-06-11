import { SELF } from "cloudflare:test";
import type { CareStatusResponse } from "@pawlog/shared";
import { describe, expect, it } from "vitest";
import { seedPet, seedSchedule, seedUserWithSession } from "./helpers";

const DAY = 86_400_000;
const TZ = 540; // JST

function nextHouseholdMidnight(now: number, tz: number): number {
  const tzMs = tz * 60_000;
  return Math.floor((now + tzMs) / DAY) * DAY + DAY - tzMs;
}

async function careStatus(petId: string, cookie: string, tz?: string) {
  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/care-status${tz === undefined ? "" : `?tz=${tz}`}`,
    { headers: { Cookie: cookie } },
  );
  return { status: res.status, body: (await res.json()) as { data: CareStatusResponse } };
}

describe("GET /api/pets/:petId/care-status", () => {
  it("buckets active schedules into overdue / today / upcoming-7d, sorted by due time", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    const todayEnd = nextHouseholdMidnight(now, TZ);

    const overdue = await seedSchedule(petId, { name: "Overdue", nextDueAt: now - 60_000 });
    const today = await seedSchedule(petId, { name: "Today", nextDueAt: todayEnd - 1 });
    const upcoming = await seedSchedule(petId, { name: "Upcoming", nextDueAt: todayEnd + 3_600_000 });
    await seedSchedule(petId, { name: "Far", nextDueAt: todayEnd + 8 * DAY }); // beyond horizon
    await seedSchedule(petId, { name: "Done", nextDueAt: now - 60_000, active: false }); // inactive

    const { status, body } = await careStatus(petId, cookie, String(TZ));
    expect(status).toBe(200);
    expect(body.data.overdue.map((s) => s.id)).toEqual([overdue.scheduleId]);
    expect(body.data.today.map((s) => s.id)).toEqual([today.scheduleId]);
    expect(body.data.upcoming.map((s) => s.id)).toEqual([upcoming.scheduleId]);
  });

  it("defaults tz to 0 and rejects invalid tz values", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    await seedSchedule(petId, { nextDueAt: Date.now() - 60_000 });

    const ok = await careStatus(petId, cookie); // no tz param
    expect(ok.status).toBe(200);
    expect(ok.body.data.overdue).toHaveLength(1);

    for (const bad of ["abc", "900", "-900", "1.5"]) {
      const res = await careStatus(petId, cookie, bad);
      expect(res.status).toBe(400);
    }
  });

  it("is 404 for non-members", async () => {
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    const outsider = await seedUserWithSession({ email: "x@example.com" });
    const { status } = await careStatus(petId, outsider.cookie, "0");
    expect(status).toBe(404);
  });
});
