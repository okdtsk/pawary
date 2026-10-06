import type { ActivityListResponse, ActivityPhotoMeta, ActivityResponse, Category, DaySummaryResponse } from "@pawary/shared";
import { CATEGORIES, activityDetailsSchemas, createActivitySchema, updateActivitySchema } from "@pawary/shared";
import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { Hono } from "hono";
import { activities, activityPhotos, type Activity } from "../db/schema";
import { writeAudit } from "../domain/audit";
import { notifyCareteamNewLog } from "../domain/push/careteam-notify";
import type { AppEnv } from "../env";
import { newId } from "../lib/id";
import { decodeCursor, encodeCursor } from "../lib/cursor";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requirePetRole } from "../middleware/pet-access";
import { requireSession } from "../middleware/session";

export const activityRoutes = new Hono<AppEnv>();

export function activityToResponse(
  a: Activity,
  photos: ActivityPhotoMeta[],
): ActivityResponse {
  return {
    id: a.id,
    petId: a.petId,
    category: a.category,
    occurredAt: a.occurredAt,
    tzOffsetMin: a.tzOffsetMin,
    memo: a.memo,
    details: a.details,
    createdBy: a.createdBy,
    updatedBy: a.updatedBy,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    photos,
  };
}

/** Scoped to the pet and excluding soft-deleted rows. */
async function getLiveActivity(
  db: DrizzleD1Database,
  petId: string,
  id: string | undefined,
): Promise<Activity | undefined> {
  if (!id) return undefined;
  return db
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.id, id),
        eq(activities.petId, petId),
        isNull(activities.deletedAt),
      ),
    )
    .get();
}

async function getPhotoMeta(
  db: DrizzleD1Database,
  activityId: string,
): Promise<ActivityPhotoMeta[]> {
  return db
    .select({
      id: activityPhotos.id,
      width: activityPhotos.width,
      height: activityPhotos.height,
      contentType: activityPhotos.contentType,
    })
    .from(activityPhotos)
    .where(eq(activityPhotos.activityId, activityId))
    .all();
}

activityRoutes.post(
  "/api/pets/:petId/activities",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createActivitySchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const petId = c.get("petId");
    const user = c.get("user");
    const db = drizzle(c.env.DB);
    const now = Date.now();
    const activity: Activity = {
      id: newId(),
      petId,
      category: parsed.data.category,
      occurredAt: parsed.data.occurredAt,
      tzOffsetMin: parsed.data.tzOffsetMin,
      memo: parsed.data.memo ?? null,
      details: parsed.data.details ?? {},
      createdBy: user.id,
      updatedBy: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await db.insert(activities).values(activity);
    await writeAudit(db, {
      petId,
      userId: user.id,
      action: "create",
      entity: "activity",
      entityId: activity.id,
      diff: { category: activity.category },
    });
    c.executionCtx.waitUntil(
      notifyCareteamNewLog(c.env, petId, {
        createdBy: activity.createdBy,
        category: activity.category,
      }).catch(() => console.error({ event: 'careteam_notify_failed' })),
    );
    return c.json({ data: activityToResponse(activity, []) }, 201);
  },
);

activityRoutes.get(
  "/api/pets/:petId/activities/:id",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const activity = await getLiveActivity(
      db,
      c.get("petId"),
      c.req.param("id"),
    );
    if (!activity) return err(c, 404, "not_found", "Not found");
    const photos = await getPhotoMeta(db, activity.id);
    return c.json({ data: activityToResponse(activity, photos) });
  },
);

activityRoutes.patch(
  "/api/pets/:petId/activities/:id",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateActivitySchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    if (Object.keys(parsed.data).length === 0) {
      return err(c, 400, "validation", "No fields to update");
    }
    const db = drizzle(c.env.DB);
    const activity = await getLiveActivity(
      db,
      c.get("petId"),
      c.req.param("id"),
    );
    if (!activity) return err(c, 404, "not_found", "Not found");

    if (parsed.data.details !== undefined) {
      // category is immutable, so details must fit the EXISTING category
      const details = activityDetailsSchemas[activity.category].safeParse(
        parsed.data.details,
      );
      if (!details.success) {
        return err(c, 400, "validation", details.error.issues[0]?.message ?? "Invalid details");
      }
    }

    const user = c.get("user");
    const now = Date.now();
    const changes: Partial<Activity> = { updatedBy: user.id, updatedAt: now };
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of ["occurredAt", "tzOffsetMin", "memo", "details"] as const) {
      const value = parsed.data[key];
      if (value !== undefined) {
        changes[key] = value as never;
        before[key] = activity[key];
        after[key] = value;
      }
    }
    await db.update(activities).set(changes).where(eq(activities.id, activity.id));
    await writeAudit(db, {
      petId: activity.petId,
      userId: user.id,
      action: "update",
      entity: "activity",
      entityId: activity.id,
      diff: { before, after },
    });
    const updated: Activity = { ...activity, ...changes };
    const photos = await getPhotoMeta(db, activity.id);
    return c.json({ data: activityToResponse(updated, photos) });
  },
);

activityRoutes.delete(
  "/api/pets/:petId/activities/:id",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const activity = await getLiveActivity(
      db,
      c.get("petId"),
      c.req.param("id"),
    );
    if (!activity) return err(c, 404, "not_found", "Not found");
    const user = c.get("user");
    const now = Date.now();
    await db
      .update(activities)
      .set({ deletedAt: now, updatedBy: user.id, updatedAt: now })
      .where(eq(activities.id, activity.id));
    await writeAudit(db, {
      petId: activity.petId,
      userId: user.id,
      action: "delete",
      entity: "activity",
      entityId: activity.id,
    });
    return c.json({ data: { ok: true } });
  },
);

function parseEpoch(raw: string | undefined): number | undefined | "invalid" {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : "invalid";
}

function escapeLike(input: string): string {
  return input
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

activityRoutes.get(
  "/api/pets/:petId/activities",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const limitRaw = c.req.query("limit");
    const limit = limitRaw === undefined ? 50 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return err(c, 400, "validation", "limit must be an integer 1..200");
    }
    const from = parseEpoch(c.req.query("from"));
    const to = parseEpoch(c.req.query("to"));
    if (from === "invalid" || to === "invalid") {
      return err(c, 400, "validation", "from/to must be epoch milliseconds");
    }
    const cats = c.req.queries("category") ?? [];
    for (const cat of cats) {
      if (!(CATEGORIES as readonly string[]).includes(cat)) {
        return err(c, 400, "validation", `Unknown category: ${cat}`);
      }
    }
    const cursorRaw = c.req.query("cursor");
    let cursor: { o: number; i: string } | undefined;
    if (cursorRaw !== undefined) {
      const decoded = decodeCursor(cursorRaw);
      if (!decoded) return err(c, 400, "validation", "Invalid cursor");
      cursor = decoded;
    }
    const q = c.req.query("q");

    const petId = c.get("petId");
    const conds = [eq(activities.petId, petId), isNull(activities.deletedAt)];
    if (from !== undefined) conds.push(gte(activities.occurredAt, from));
    if (to !== undefined) conds.push(lte(activities.occurredAt, to));
    if (cats.length > 0) {
      conds.push(inArray(activities.category, cats as Category[]));
    }
    if (q) {
      const pattern = `%${escapeLike(q)}%`;
      conds.push(sql`${activities.memo} LIKE ${pattern} ESCAPE '\\'`);
    }
    if (cursor) {
      conds.push(
        or(
          lt(activities.occurredAt, cursor.o),
          and(
            eq(activities.occurredAt, cursor.o),
            lt(activities.id, cursor.i),
          ),
        )!,
      );
    }

    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(activities)
      .where(and(...conds))
      .orderBy(desc(activities.occurredAt), desc(activities.id))
      .limit(limit + 1) // sentinel row: page is full AND more exist
      .all();
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > limit && last ? encodeCursor(last.occurredAt, last.id) : null;

    const ids = page.map((a) => a.id);
    const photoRows =
      ids.length > 0
        ? await db
            .select({
              id: activityPhotos.id,
              activityId: activityPhotos.activityId,
              width: activityPhotos.width,
              height: activityPhotos.height,
              contentType: activityPhotos.contentType,
            })
            .from(activityPhotos)
            .where(inArray(activityPhotos.activityId, ids))
            .all()
        : [];
    const photosByActivity = new Map<string, ActivityPhotoMeta[]>();
    for (const photo of photoRows) {
      const meta: ActivityPhotoMeta = {
        id: photo.id,
        width: photo.width,
        height: photo.height,
        contentType: photo.contentType,
      };
      const bucket = photosByActivity.get(photo.activityId);
      if (bucket) bucket.push(meta);
      else photosByActivity.set(photo.activityId, [meta]);
    }

    const data: ActivityListResponse = {
      items: page.map((a) =>
        activityToResponse(a, photosByActivity.get(a.id) ?? []),
      ),
      nextCursor,
    };
    return c.json({ data });
  },
);

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

activityRoutes.get(
  "/api/pets/:petId/summary",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const month = c.req.query("month");
    if (!month || !MONTH_RE.test(month)) {
      return err(c, 400, "validation", "month must be YYYY-MM");
    }
    const year = Number(month.slice(0, 4));
    const mon = Number(month.slice(5, 7));
    const startMs = Date.UTC(year, mon - 1, 1);
    const endMs = Date.UTC(year, mon, 1);
    const petId = c.get("petId");
    const db = drizzle(c.env.DB);
    const rows = await db.all<{ day: string; category: Category; count: number }>(sql`
      SELECT date((occurred_at + tz_offset_min * 60000) / 1000, 'unixepoch') AS day,
             category,
             COUNT(*) AS count
      FROM activities
      WHERE pet_id = ${petId}
        AND deleted_at IS NULL
        AND occurred_at + tz_offset_min * 60000 >= ${startMs}
        AND occurred_at + tz_offset_min * 60000 < ${endMs}
      GROUP BY day, category
    `);
    const days: DaySummaryResponse["days"] = {};
    for (const row of rows) {
      const day = (days[row.day] ??= {});
      day[row.category] = row.count;
    }
    const data: DaySummaryResponse = { month, days };
    return c.json({ data });
  },
);
