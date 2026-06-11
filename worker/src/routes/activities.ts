import type { ActivityPhotoMeta, ActivityResponse } from "@pawlog/shared";
import { createActivitySchema } from "@pawlog/shared";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { Hono } from "hono";
import { activities, activityPhotos, type Activity } from "../db/schema";
import { writeAudit } from "../domain/audit";
import type { AppEnv } from "../env";
import { newId } from "../lib/id";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requirePetRole } from "../middleware/pet-access";
import { requireSession } from "../middleware/session";

export const activityRoutes = new Hono<AppEnv>();

function activityToResponse(
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
