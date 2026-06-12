import { SELF, env } from "cloudflare:test";
import type { CompleteScheduleResponse } from "@pawary/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { activities, auditLog, careSchedules } from "../src/db/schema";
import { authHeaders, seedPet, seedSchedule, seedUserWithSession, withMember } from "./helpers";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function complete(
  petId: string,
  scheduleId: string,
  cookie: string,
  csrfToken: string,
  body: Record<string, unknown> = {},
) {
  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/schedules/${scheduleId}/complete`,
    { method: "POST", headers: authHeaders(cookie, csrfToken), body: JSON.stringify(body) },
  );
  return { status: res.status, body: (await res.json()) as { data: CompleteScheduleResponse } };
}

describe("POST /api/pets/:petId/schedules/:id/complete", () => {
  it("inserts the activity from the template (medication gets scheduleId), advances, audits both", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const due = Date.now() - HOUR; // overdue daily pill
    const { scheduleId } = await seedSchedule(petId, {
      detailsTemplate: { name: "Heart pills", dose: 5, doseUnit: "mg" },
      recurrenceUnit: "day",
      recurrenceN: 1,
      nextDueAt: due,
    });

    const before = Date.now();
    const { status, body } = await complete(petId, scheduleId, cookie, csrfToken, {
      tzOffsetMin: 540,
      memo: "with breakfast",
    });
    expect(status).toBe(201);

    // activity: template + injected scheduleId (medication only)
    expect(body.data.activity.category).toBe("medication");
    expect(body.data.activity.details).toEqual({
      name: "Heart pills",
      dose: 5,
      doseUnit: "mg",
      scheduleId,
    });
    expect(body.data.activity.tzOffsetMin).toBe(540);
    expect(body.data.activity.memo).toBe("with breakfast");
    expect(body.data.activity.occurredAt).toBeGreaterThanOrEqual(before);
    expect(body.data.activity.photos).toEqual([]);

    // schedule: anchored advance (old due + 1 day), still active
    expect(body.data.schedule.nextDueAt).toBe(due + DAY);
    expect(body.data.schedule.active).toBe(true);

    // persisted rows
    const db = drizzle(env.DB);
    const acts = await db.select().from(activities).where(eq(activities.petId, petId)).all();
    expect(acts).toHaveLength(1);
    const sched = await db.select().from(careSchedules).where(eq(careSchedules.id, scheduleId)).get();
    expect(sched?.nextDueAt).toBe(due + DAY);

    // audit: one activity create + one schedule update
    const audits = await db.select().from(auditLog).where(eq(auditLog.petId, petId)).all();
    const activityAudit = audits.find((a) => a.entity === "activity");
    const scheduleAudit = audits.find((a) => a.entity === "schedule");
    expect(activityAudit?.action).toBe("create");
    expect(activityAudit?.diff).toEqual({ category: "medication", scheduleId });
    expect(scheduleAudit?.action).toBe("update");
    expect(scheduleAudit?.diff).toEqual({
      before: { nextDueAt: due, active: true },
      after: { nextDueAt: due + DAY, active: true },
    });
  });

  it("does not inject scheduleId for non-medication categories", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const { scheduleId } = await seedSchedule(petId, {
      type: "grooming",
      name: "Nail trim",
      categoryLink: "grooming",
      detailsTemplate: { kind: "nails" },
      recurrenceUnit: "week",
      recurrenceN: 2,
    });
    const { status, body } = await complete(petId, scheduleId, cookie, csrfToken);
    expect(status).toBe(201);
    expect(body.data.activity.category).toBe("grooming");
    expect(body.data.activity.details).toEqual({ kind: "nails" });
    expect(body.data.activity.tzOffsetMin).toBe(0); // default
  });

  it("deactivates once-schedules and 409s a second completion", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const { scheduleId } = await seedSchedule(petId, {
      type: "vaccination",
      categoryLink: "vaccination",
      detailsTemplate: { vaccineName: "Rabies" },
      recurrenceUnit: "once",
      recurrenceN: null,
    });
    const first = await complete(petId, scheduleId, cookie, csrfToken);
    expect(first.status).toBe(201);
    expect(first.body.data.schedule.active).toBe(false);
    const second = await complete(petId, scheduleId, cookie, csrfToken);
    expect(second.status).toBe(409);
  });

  it("deactivates when the next occurrence would pass endAt", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    const { scheduleId } = await seedSchedule(petId, {
      recurrenceUnit: "hour",
      recurrenceN: 12,
      nextDueAt: now,
      endAt: now + 11 * HOUR, // next slot (+12 h) lands past endAt
    });
    const { status, body } = await complete(petId, scheduleId, cookie, csrfToken);
    expect(status).toBe(201);
    expect(body.data.schedule.active).toBe(false);
  });

  it("accepts occurredAt within [now − 7 d, now + 1 h] and rejects outside", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const { scheduleId } = await seedSchedule(petId);
    const now = Date.now();

    const past = await complete(petId, scheduleId, cookie, csrfToken, {
      occurredAt: now - 8 * DAY,
    });
    expect(past.status).toBe(400);
    const future = await complete(petId, scheduleId, cookie, csrfToken, {
      occurredAt: now + 2 * HOUR,
    });
    expect(future.status).toBe(400);

    const okAt = now - 2 * HOUR;
    const ok = await complete(petId, scheduleId, cookie, csrfToken, { occurredAt: okAt });
    expect(ok.status).toBe(201);
    expect(ok.body.data.activity.occurredAt).toBe(okAt);
  });

  it("enforces the authz matrix and CSRF", async () => {
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    const { scheduleId } = await seedSchedule(petId);
    const viewer = await seedUserWithSession({ email: "v@example.com" });
    await withMember(petId, viewer.userId, "viewer");
    const outsider = await seedUserWithSession({ email: "x@example.com" });

    const asViewer = await complete(petId, scheduleId, viewer.cookie, viewer.csrfToken);
    expect(asViewer.status).toBe(403);
    const asOutsider = await complete(petId, scheduleId, outsider.cookie, outsider.csrfToken);
    expect(asOutsider.status).toBe(404);
    const noCsrf = await SELF.fetch(
      `https://app.local/api/pets/${petId}/schedules/${scheduleId}/complete`,
      { method: "POST", headers: authHeaders(owner.cookie), body: "{}" },
    );
    expect(noCsrf.status).toBe(403);
  });
});
