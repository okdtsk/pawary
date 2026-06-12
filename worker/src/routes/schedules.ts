import type { CareStatusResponse, CompleteScheduleResponse, ScheduleResponse } from "@pawary/shared";
import {
  activityDetailsSchemas,
  completeScheduleSchema,
  createScheduleSchema,
  updateScheduleSchema,
} from "@pawary/shared";
import { and, asc, desc, eq, lt } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { Hono } from "hono";
import { activities, careSchedules, type Activity, type CareSchedule } from "../db/schema";
import { writeAudit } from "../domain/audit";
import { advanceSchedule } from "../domain/recurrence";
import type { AppEnv } from "../env";
import { newId } from "../lib/id";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requirePetRole } from "../middleware/pet-access";
import { requireSession } from "../middleware/session";
import { parseTzQuery } from "../lib/tz";
import { activityToResponse } from "./activities";

export const scheduleRoutes = new Hono<AppEnv>();

export function scheduleToResponse(s: CareSchedule): ScheduleResponse {
  return {
    id: s.id,
    petId: s.petId,
    type: s.type,
    name: s.name,
    categoryLink: s.categoryLink,
    detailsTemplate: s.detailsTemplate,
    recurrenceUnit: s.recurrenceUnit,
    recurrenceN: s.recurrenceN,
    nextDueAt: s.nextDueAt,
    endAt: s.endAt,
    active: s.active,
    createdAt: s.createdAt,
  };
}

/** Scoped to the pet — a schedule id from another pet is a 404. */
export async function getSchedule(
  db: DrizzleD1Database,
  petId: string,
  id: string | undefined,
): Promise<CareSchedule | undefined> {
  if (!id) return undefined;
  return db
    .select()
    .from(careSchedules)
    .where(and(eq(careSchedules.id, id), eq(careSchedules.petId, petId)))
    .get();
}

scheduleRoutes.get(
  "/api/pets/:petId/schedules",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(careSchedules)
      .where(eq(careSchedules.petId, c.get("petId")))
      .orderBy(desc(careSchedules.active), asc(careSchedules.nextDueAt))
      .all();
    return c.json({ data: rows.map(scheduleToResponse) });
  },
);

scheduleRoutes.post(
  "/api/pets/:petId/schedules",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createScheduleSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const petId = c.get("petId");
    const user = c.get("user");
    const db = drizzle(c.env.DB);
    const schedule: CareSchedule = {
      id: newId(),
      petId,
      type: parsed.data.type,
      name: parsed.data.name,
      categoryLink: parsed.data.categoryLink,
      detailsTemplate: parsed.data.detailsTemplate ?? {},
      recurrenceUnit: parsed.data.recurrenceUnit,
      // normalized: once-schedules never carry an interval count
      recurrenceN: parsed.data.recurrenceUnit === "once" ? null : parsed.data.recurrenceN!,
      nextDueAt: parsed.data.nextDueAt,
      endAt: parsed.data.endAt ?? null,
      active: true,
      notifiedDueAt: null,
      createdAt: Date.now(),
    };
    await db.insert(careSchedules).values(schedule);
    await writeAudit(db, {
      petId,
      userId: user.id,
      action: "create",
      entity: "schedule",
      entityId: schedule.id,
      diff: { type: schedule.type, name: schedule.name },
    });
    return c.json({ data: scheduleToResponse(schedule) }, 201);
  },
);

scheduleRoutes.patch(
  "/api/pets/:petId/schedules/:id",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateScheduleSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    if (Object.keys(parsed.data).length === 0) {
      return err(c, 400, "validation", "No fields to update");
    }
    const db = drizzle(c.env.DB);
    const schedule = await getSchedule(db, c.get("petId"), c.req.param("id"));
    if (!schedule) return err(c, 404, "not_found", "Not found");

    if (parsed.data.detailsTemplate !== undefined) {
      // categoryLink is immutable, so the template must fit the STORED category
      const check = activityDetailsSchemas[schedule.categoryLink].safeParse(
        parsed.data.detailsTemplate,
      );
      if (!check.success) {
        return err(c, 400, "validation", check.error.issues[0]?.message ?? "Invalid details template");
      }
    }

    const changes: Partial<CareSchedule> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of [
      "name",
      "detailsTemplate",
      "recurrenceUnit",
      "recurrenceN",
      "nextDueAt",
      "endAt",
      "active",
    ] as const) {
      const value = parsed.data[key];
      if (value !== undefined) {
        changes[key] = value as never;
        before[key] = schedule[key];
        after[key] = value;
      }
    }
    // cross-field rules re-checked on the MERGED record
    const merged: CareSchedule = { ...schedule, ...changes };
    if (merged.recurrenceUnit !== "once" && merged.recurrenceN === null) {
      return err(c, 400, "validation", "recurrenceN is required unless recurrence is once");
    }
    if (merged.endAt !== null && merged.endAt <= merged.nextDueAt) {
      return err(c, 400, "validation", "endAt must be after nextDueAt");
    }
    await db.update(careSchedules).set(changes).where(eq(careSchedules.id, schedule.id));
    await writeAudit(db, {
      petId: schedule.petId,
      userId: c.get("user").id,
      action: "update",
      entity: "schedule",
      entityId: schedule.id,
      diff: { before, after },
    });
    return c.json({ data: scheduleToResponse(merged) });
  },
);

scheduleRoutes.delete(
  "/api/pets/:petId/schedules/:id",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const schedule = await getSchedule(db, c.get("petId"), c.req.param("id"));
    if (!schedule) return err(c, 404, "not_found", "Not found");
    // Hard delete (locked decision): history lives in logged activities + audit_log.
    await db.delete(careSchedules).where(eq(careSchedules.id, schedule.id));
    await writeAudit(db, {
      petId: schedule.petId,
      userId: c.get("user").id,
      action: "delete",
      entity: "schedule",
      entityId: schedule.id,
    });
    return c.json({ data: { ok: true } });
  },
);

const DAY_MS = 86_400_000;

const COMPLETE_PAST_MS = 7 * 24 * 3_600_000;
const COMPLETE_FUTURE_MS = 3_600_000;

scheduleRoutes.post(
  "/api/pets/:petId/schedules/:id/complete",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const body = await c.req.json().catch(() => ({})); // empty body allowed
    const parsed = completeScheduleSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const now = Date.now();
    const occurredAt = parsed.data.occurredAt ?? now;
    if (occurredAt < now - COMPLETE_PAST_MS || occurredAt > now + COMPLETE_FUTURE_MS) {
      return err(
        c,
        400,
        "validation",
        "occurredAt must be within the last 7 days or up to 1 hour ahead",
      );
    }
    const db = drizzle(c.env.DB);
    const schedule = await getSchedule(db, c.get("petId"), c.req.param("id"));
    if (!schedule) return err(c, 404, "not_found", "Not found");
    if (!schedule.active) {
      return err(c, 409, "schedule_inactive", "Schedule is no longer active");
    }

    // Build the activity from the template; medication gets the scheduleId
    // back-reference (the shared medication schema has the optional field).
    const template = (schedule.detailsTemplate ?? {}) as Record<string, unknown>;
    const details =
      schedule.categoryLink === "medication"
        ? { ...template, scheduleId: schedule.id }
        : template;
    const check = activityDetailsSchemas[schedule.categoryLink].safeParse(details);
    if (!check.success) {
      // can only happen if a stored template predates a schema change
      return err(c, 500, "internal", "Stored details template is invalid");
    }

    const user = c.get("user");
    const adv = advanceSchedule(schedule);
    const activity: Activity = {
      id: newId(),
      petId: schedule.petId,
      category: schedule.categoryLink,
      occurredAt,
      tzOffsetMin: parsed.data.tzOffsetMin ?? 0,
      memo: parsed.data.memo ?? null,
      details: check.data,
      createdBy: user.id,
      updatedBy: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    // both-or-neither: D1 batches are transactional (spec §4 "atomically")
    await db.batch([
      db.insert(activities).values(activity),
      db
        .update(careSchedules)
        .set({ nextDueAt: adv.nextDueAt, active: adv.active })
        .where(eq(careSchedules.id, schedule.id)),
    ]);
    await writeAudit(db, {
      petId: schedule.petId,
      userId: user.id,
      action: "create",
      entity: "activity",
      entityId: activity.id,
      diff: { category: activity.category, scheduleId: schedule.id },
    });
    await writeAudit(db, {
      petId: schedule.petId,
      userId: user.id,
      action: "update",
      entity: "schedule",
      entityId: schedule.id,
      diff: {
        before: { nextDueAt: schedule.nextDueAt, active: schedule.active },
        after: { nextDueAt: adv.nextDueAt, active: adv.active },
      },
    });

    const updated: CareSchedule = { ...schedule, nextDueAt: adv.nextDueAt, active: adv.active };
    const data: CompleteScheduleResponse = {
      activity: activityToResponse(activity, []),
      schedule: scheduleToResponse(updated),
    };
    return c.json({ data }, 201);
  },
);

scheduleRoutes.get(
  "/api/pets/:petId/care-status",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const tz = parseTzQuery(c.req.query("tz"));
    if (tz === "invalid") {
      return err(c, 400, "validation", "tz must be an integer -840..840");
    }
    const now = Date.now();
    const tzMs = tz * 60_000;
    // next household midnight, as a UTC instant
    const todayEnd = Math.floor((now + tzMs) / DAY_MS) * DAY_MS + DAY_MS - tzMs;
    const horizon = todayEnd + 7 * DAY_MS;

    const db = drizzle(c.env.DB);
    // single range scan on idx_schedules_pet_active_due
    const rows = await db
      .select()
      .from(careSchedules)
      .where(
        and(
          eq(careSchedules.petId, c.get("petId")),
          eq(careSchedules.active, true),
          lt(careSchedules.nextDueAt, horizon),
        ),
      )
      .orderBy(asc(careSchedules.nextDueAt))
      .all();

    const data: CareStatusResponse = { overdue: [], today: [], upcoming: [] };
    for (const row of rows) {
      const bucket =
        row.nextDueAt < now ? data.overdue : row.nextDueAt < todayEnd ? data.today : data.upcoming;
      bucket.push(scheduleToResponse(row));
    }
    return c.json({ data });
  },
);
