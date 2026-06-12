import { SELF, env } from "cloudflare:test";
import type { ScheduleResponse } from "@pawary/shared";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { auditLog, careSchedules } from "../src/db/schema";
import { authHeaders, seedPet, seedSchedule, seedUserWithSession, withMember } from "./helpers";

const base = (petId: string) => `https://app.local/api/pets/${petId}/schedules`;

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    type: "medication",
    name: "Heart pills",
    categoryLink: "medication",
    detailsTemplate: { name: "Heart pills", dose: 5, doseUnit: "mg" },
    recurrenceUnit: "day",
    recurrenceN: 1,
    nextDueAt: Date.now() + 3_600_000,
    ...overrides,
  };
}

async function scheduleAudits(petId: string) {
  const db = drizzle(env.DB);
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.petId, petId), eq(auditLog.entity, "schedule")))
    .all();
}

describe("POST /api/pets/:petId/schedules", () => {
  it("creates a schedule, audits it, and returns 201", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const res = await SELF.fetch(base(petId), {
      method: "POST",
      headers: authHeaders(cookie, csrfToken),
      body: JSON.stringify(validBody()),
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: ScheduleResponse };
    expect(data.type).toBe("medication");
    expect(data.categoryLink).toBe("medication");
    expect(data.detailsTemplate).toEqual({ name: "Heart pills", dose: 5, doseUnit: "mg" });
    expect(data.recurrenceUnit).toBe("day");
    expect(data.recurrenceN).toBe(1);
    expect(data.active).toBe(true);
    expect(data.endAt).toBeNull();
    const audits = await scheduleAudits(petId);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe("create");
    expect(audits[0]?.entityId).toBe(data.id);
  });

  it("normalizes recurrenceN to null for once-schedules", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const res = await SELF.fetch(base(petId), {
      method: "POST",
      headers: authHeaders(cookie, csrfToken),
      body: JSON.stringify(validBody({ recurrenceUnit: "once", recurrenceN: 5 })),
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: ScheduleResponse };
    expect(data.recurrenceN).toBeNull();
  });

  it("rejects invalid payloads with 400", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const cases: Record<string, unknown>[] = [
      validBody({ recurrenceN: undefined }), // required unless once
      validBody({ endAt: validBody().nextDueAt }), // endAt must be after nextDueAt
      validBody({ categoryLink: "water", detailsTemplate: { kg: 5 } }), // template vs category
      validBody({ name: "" }),
      validBody({ type: "haircut" }), // unknown enum value
      validBody({ surprise: 1 }), // strict: unknown key
    ];
    for (const body of cases) {
      const res = await SELF.fetch(base(petId), {
        method: "POST",
        headers: authHeaders(cookie, csrfToken),
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });
});

describe("GET /api/pets/:petId/schedules", () => {
  it("lists active schedules first, each group ordered by nextDueAt", async () => {
    const { userId, cookie } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const now = Date.now();
    const late = await seedSchedule(petId, { name: "Later", nextDueAt: now + 2_000_000 });
    const done = await seedSchedule(petId, { name: "Done", nextDueAt: now, active: false });
    const soon = await seedSchedule(petId, { name: "Soon", nextDueAt: now + 1_000_000 });
    const res = await SELF.fetch(base(petId), { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: ScheduleResponse[] };
    expect(data.map((s) => s.id)).toEqual([soon.scheduleId, late.scheduleId, done.scheduleId]);
  });

  it("enforces the authz matrix", async () => {
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    const viewer = await seedUserWithSession({ email: "v@example.com" });
    await withMember(petId, viewer.userId, "viewer");
    const outsider = await seedUserWithSession({ email: "x@example.com" });

    // viewer can read
    const read = await SELF.fetch(base(petId), { headers: { Cookie: viewer.cookie } });
    expect(read.status).toBe(200);
    // viewer cannot write
    const write = await SELF.fetch(base(petId), {
      method: "POST",
      headers: authHeaders(viewer.cookie, viewer.csrfToken),
      body: JSON.stringify(validBody()),
    });
    expect(write.status).toBe(403);
    // outsider sees 404 (anti-probing)
    const probe = await SELF.fetch(base(petId), { headers: { Cookie: outsider.cookie } });
    expect(probe.status).toBe(404);
    // no session
    const anon = await SELF.fetch(base(petId));
    expect(anon.status).toBe(401);
  });
});

describe("PATCH /api/pets/:petId/schedules/:id", () => {
  it("updates fields and audits a before/after diff", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const { scheduleId } = await seedSchedule(petId, { name: "Old name" });
    const nextDueAt = Date.now() + 9_000_000;
    const res = await SELF.fetch(`${base(petId)}/${scheduleId}`, {
      method: "PATCH",
      headers: authHeaders(cookie, csrfToken),
      body: JSON.stringify({ name: "New name", nextDueAt }),
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: ScheduleResponse };
    expect(data.name).toBe("New name");
    expect(data.nextDueAt).toBe(nextDueAt);
    const audits = await scheduleAudits(petId);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe("update");
    expect(audits[0]?.diff).toEqual({
      before: { name: "Old name", nextDueAt: expect.any(Number) },
      after: { name: "New name", nextDueAt },
    });
  });

  it("rejects immutable/invalid updates with 400", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const { scheduleId } = await seedSchedule(petId, { nextDueAt: Date.now() + 3_600_000 });
    const cases: Record<string, unknown>[] = [
      {}, // nothing to update
      { type: "grooming" }, // immutable (strict: unknown key)
      { categoryLink: "water" }, // immutable
      { detailsTemplate: { kg: 5 } }, // doesn't fit stored category (medication)
      { recurrenceN: null }, // unit stays "day" → N required
      { endAt: Date.now() }, // ≤ stored nextDueAt
    ];
    for (const body of cases) {
      const res = await SELF.fetch(`${base(petId)}/${scheduleId}`, {
        method: "PATCH",
        headers: authHeaders(cookie, csrfToken),
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });

  it("allows switching to once with recurrenceN null, and restoring active", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const { scheduleId } = await seedSchedule(petId, { active: false });
    const res = await SELF.fetch(`${base(petId)}/${scheduleId}`, {
      method: "PATCH",
      headers: authHeaders(cookie, csrfToken),
      body: JSON.stringify({ recurrenceUnit: "once", recurrenceN: null, active: true }),
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: ScheduleResponse };
    expect(data.recurrenceUnit).toBe("once");
    expect(data.recurrenceN).toBeNull();
    expect(data.active).toBe(true);
  });

  it("is 404 for another pet's schedule id", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const { petId: otherPet } = await seedPet(userId, "owner", { name: "Hana" });
    const { scheduleId } = await seedSchedule(otherPet);
    const res = await SELF.fetch(`${base(petId)}/${scheduleId}`, {
      method: "PATCH",
      headers: authHeaders(cookie, csrfToken),
      body: JSON.stringify({ name: "Stolen" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/pets/:petId/schedules/:id", () => {
  it("hard-deletes, audits, and 404s on repeat", async () => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const { scheduleId } = await seedSchedule(petId);
    const res = await SELF.fetch(`${base(petId)}/${scheduleId}`, {
      method: "DELETE",
      headers: authHeaders(cookie, csrfToken),
    });
    expect(res.status).toBe(200);
    const db = drizzle(env.DB);
    const rows = await db.select().from(careSchedules).where(eq(careSchedules.id, scheduleId)).all();
    expect(rows).toHaveLength(0);
    const audits = await scheduleAudits(petId);
    expect(audits[0]?.action).toBe("delete");
    const again = await SELF.fetch(`${base(petId)}/${scheduleId}`, {
      method: "DELETE",
      headers: authHeaders(cookie, csrfToken),
    });
    expect(again.status).toBe(404);
  });
});
