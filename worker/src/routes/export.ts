import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import {
  activities,
  activityPhotos,
  careSchedules,
  petMembers,
  pets,
  petTargets,
  quickPresets,
} from "../db/schema";
import { csvLine, isoWithOffset } from "../domain/export";
import type { AppEnv } from "../env";
import { err } from "../lib/respond";
import { requirePetRole } from "../middleware/pet-access";
import { requireSession } from "../middleware/session";

export const exportRoutes = new Hono<AppEnv>();

exportRoutes.get("/api/me/export", requireSession, async (c) => {
  const user = c.get("user");
  const db = drizzle(c.env.DB);
  const ownerships = await db
    .select()
    .from(petMembers)
    .where(and(eq(petMembers.userId, user.id), eq(petMembers.role, "owner")))
    .all();

  const exportedPets = [];
  for (const membership of ownerships) {
    const pet = await db
      .select()
      .from(pets)
      .where(eq(pets.id, membership.petId))
      .get();
    if (!pet) continue;
    const petActivities = await db
      .select()
      .from(activities)
      .where(eq(activities.petId, pet.id))
      .all();
    const schedules = await db
      .select()
      .from(careSchedules)
      .where(eq(careSchedules.petId, pet.id))
      .all();
    const presets = await db
      .select()
      .from(quickPresets)
      .where(eq(quickPresets.petId, pet.id))
      .all();
    const targets = await db
      .select()
      .from(petTargets)
      .where(eq(petTargets.petId, pet.id))
      .get();
    exportedPets.push({
      pet,
      targets: targets ?? null,
      schedules,
      presets,
      activities: petActivities.map((a) => ({
        ...a,
        deleted: a.deletedAt !== null,
      })),
    });
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      locale: user.locale,
      createdAt: user.createdAt,
    },
    pets: exportedPets,
  };
  return c.body(JSON.stringify(payload, null, 2), 200, {
    "Content-Type": "application/json",
    "Content-Disposition": 'attachment; filename="pawary-export.json"',
  });
});

exportRoutes.get(
  "/api/pets/:petId/export",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const format = c.req.query("format") ?? "json";
    if (format !== "json" && format !== "csv") {
      return err(c, 400, "validation", "format must be json or csv");
    }
    const pet = c.get("pet");
    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(activities)
      .where(eq(activities.petId, pet.id))
      .all();

    if (format === "json") {
      const ids = rows.map((a) => a.id);
      const photos =
        ids.length > 0
          ? await db
              .select({
                id: activityPhotos.id,
                activityId: activityPhotos.activityId,
                width: activityPhotos.width,
                height: activityPhotos.height,
                contentType: activityPhotos.contentType,
                createdAt: activityPhotos.createdAt,
              })
              .from(activityPhotos)
              .where(inArray(activityPhotos.activityId, ids))
              .all()
          : [];
      const payload = {
        exportedAt: new Date().toISOString(),
        pet,
        activities: rows.map((a) => ({ ...a, deleted: a.deletedAt !== null })),
        photos,
      };
      return c.body(JSON.stringify(payload, null, 2), 200, {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="pawary-${pet.id}.json"`,
      });
    }

    const lines = [csvLine(["id", "category", "occurred_at", "memo", "details"])];
    for (const a of rows) {
      if (a.deletedAt !== null) continue; // human-readable view: live rows only
      lines.push(
        csvLine([
          a.id,
          a.category,
          isoWithOffset(a.occurredAt, a.tzOffsetMin),
          a.memo ?? "",
          JSON.stringify(a.details),
        ]),
      );
    }
    return c.body(lines.join("\r\n") + "\r\n", 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pawary-${pet.id}.csv"`,
    });
  },
);
