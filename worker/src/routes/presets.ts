import type { PresetResponse } from "@pawlog/shared";
import {
  activityDetailsSchemas,
  presetSchema,
  updatePresetSchema,
} from "@pawlog/shared";
import { and, asc, eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { Hono } from "hono";
import { quickPresets } from "../db/schema";
import { writeAudit } from "../domain/audit";
import type { AppEnv } from "../env";
import { newId } from "../lib/id";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requirePetRole } from "../middleware/pet-access";
import { requireSession } from "../middleware/session";

export const presetRoutes = new Hono<AppEnv>();

type PresetRow = typeof quickPresets.$inferSelect;

function presetToResponse(row: PresetRow): PresetResponse {
  return {
    id: row.id,
    category: row.category,
    label: row.label,
    details: row.details,
    sortOrder: row.sortOrder,
  };
}

async function getPreset(
  db: DrizzleD1Database,
  petId: string,
  id: string | undefined,
): Promise<PresetRow | undefined> {
  if (!id) return undefined;
  return db
    .select()
    .from(quickPresets)
    .where(and(eq(quickPresets.id, id), eq(quickPresets.petId, petId)))
    .get();
}

presetRoutes.get(
  "/api/pets/:petId/presets",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(quickPresets)
      .where(eq(quickPresets.petId, c.get("petId")))
      .orderBy(asc(quickPresets.sortOrder), asc(quickPresets.createdAt))
      .all();
    return c.json({ data: rows.map(presetToResponse) });
  },
);

presetRoutes.post(
  "/api/pets/:petId/presets",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = presetSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const petId = c.get("petId");
    const db = drizzle(c.env.DB);
    const row: PresetRow = {
      id: newId(),
      petId,
      category: parsed.data.category,
      label: parsed.data.label,
      details: parsed.data.details ?? {},
      sortOrder: parsed.data.sortOrder ?? 0,
      createdAt: Date.now(),
    };
    await db.insert(quickPresets).values(row);
    await writeAudit(db, {
      petId,
      userId: c.get("user").id,
      action: "create",
      entity: "preset",
      entityId: row.id,
      diff: { label: row.label, category: row.category },
    });
    return c.json({ data: presetToResponse(row) }, 201);
  },
);

presetRoutes.patch(
  "/api/pets/:petId/presets/:id",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updatePresetSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    if (Object.keys(parsed.data).length === 0) {
      return err(c, 400, "validation", "No fields to update");
    }
    const db = drizzle(c.env.DB);
    const row = await getPreset(db, c.get("petId"), c.req.param("id"));
    if (!row) return err(c, 404, "not_found", "Not found");
    if (parsed.data.details !== undefined) {
      const details = activityDetailsSchemas[row.category].safeParse(
        parsed.data.details,
      );
      if (!details.success) {
        return err(c, 400, "validation", details.error.issues[0]?.message ?? "Invalid details");
      }
    }
    const changes: Partial<PresetRow> = {};
    if (parsed.data.label !== undefined) changes.label = parsed.data.label;
    if (parsed.data.details !== undefined) changes.details = parsed.data.details;
    if (parsed.data.sortOrder !== undefined) changes.sortOrder = parsed.data.sortOrder;
    await db.update(quickPresets).set(changes).where(eq(quickPresets.id, row.id));
    await writeAudit(db, {
      petId: row.petId,
      userId: c.get("user").id,
      action: "update",
      entity: "preset",
      entityId: row.id,
      diff: { after: changes },
    });
    return c.json({ data: presetToResponse({ ...row, ...changes }) });
  },
);

presetRoutes.delete(
  "/api/pets/:petId/presets/:id",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const row = await getPreset(db, c.get("petId"), c.req.param("id"));
    if (!row) return err(c, 404, "not_found", "Not found");
    await db.delete(quickPresets).where(eq(quickPresets.id, row.id));
    await writeAudit(db, {
      petId: row.petId,
      userId: c.get("user").id,
      action: "delete",
      entity: "preset",
      entityId: row.id,
      diff: { label: row.label },
    });
    return c.json({ data: { ok: true } });
  },
);
