import type { ScheduleResponse } from "@pawlog/shared";
import { activityDetailsSchemas, createScheduleSchema, updateScheduleSchema } from "@pawlog/shared";
import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { Hono } from "hono";
import { careSchedules, type CareSchedule } from "../db/schema";
import { writeAudit } from "../domain/audit";
import type { AppEnv } from "../env";
import { newId } from "../lib/id";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requirePetRole } from "../middleware/pet-access";
import { requireSession } from "../middleware/session";

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
