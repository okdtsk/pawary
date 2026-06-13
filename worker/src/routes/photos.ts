import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import type { Context } from "hono";
import { activities, activityPhotos, pets } from "../db/schema";
import { writeAudit } from "../domain/audit";
import type { AppEnv } from "../env";
import { newId } from "../lib/id";
import {
  imageDimensions,
  sniffImage,
  stripImageMetadata,
  type ImageContentType,
} from "../lib/image";
import { rateLimit } from "../lib/rate-limit";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import {
  requirePetRole,
  resolvePetAccess,
  roleAtLeast,
} from "../middleware/pet-access";
import { requireSession } from "../middleware/session";

export const photoRoutes = new Hono<AppEnv>();

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_PHOTOS_PER_ACTIVITY = 6;
const uploadLimit = rateLimit("upload", 30, 60_000, "user");

type Upload = {
  bytes: Uint8Array;
  contentType: ImageContentType;
  width: number | null;
  height: number | null;
};

/** Shared upload pipeline: size caps, magic-byte sniff, metadata strip. */
async function readImageUpload(
  c: Context<AppEnv>,
): Promise<Upload | Response> {
  const contentLength = Number(c.req.header("Content-Length") ?? "0");
  // fast reject before buffering (multipart overhead allowance: 4 KiB)
  if (contentLength > MAX_PHOTO_BYTES + 4096) {
    return err(c, 413, "too_large", "File exceeds 10 MB");
  }
  const form = await c.req.formData().catch(() => null);
  // Workers types narrow FormData.get() to string|null but the runtime does
  // return File objects for file fields — cast through unknown to check.
  const file = form?.get("file") as unknown;
  if (!(file instanceof Blob) || !("name" in file)) {
    return err(c, 400, "validation", "Multipart field 'file' is required");
  }
  const fileBlob = file as File;
  if (fileBlob.size > MAX_PHOTO_BYTES) {
    return err(c, 413, "too_large", "File exceeds 10 MB");
  }
  const raw = new Uint8Array(await fileBlob.arrayBuffer());
  const contentType = sniffImage(raw);
  if (!contentType) {
    return err(c, 400, "unsupported_media", "Only JPEG, PNG, and WebP are accepted");
  }
  const bytes = stripImageMetadata(raw, contentType);
  const dims = imageDimensions(bytes, contentType);
  return {
    bytes,
    contentType,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
  };
}

photoRoutes.post(
  "/api/pets/:petId/activities/:activityId/photos",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  uploadLimit,
  async (c) => {
    const petId = c.get("petId");
    const activityId = c.req.param("activityId");
    const db = drizzle(c.env.DB);
    const activity = await db
      .select()
      .from(activities)
      .where(
        and(
          eq(activities.id, activityId),
          eq(activities.petId, petId),
          isNull(activities.deletedAt),
        ),
      )
      .get();
    if (!activity) return err(c, 404, "not_found", "Not found");

    const existing = await db
      .select({ id: activityPhotos.id })
      .from(activityPhotos)
      .where(eq(activityPhotos.activityId, activity.id))
      .all();
    if (existing.length >= MAX_PHOTOS_PER_ACTIVITY) {
      return err(c, 400, "photo_limit", "An activity can have at most 6 photos");
    }

    const upload = await readImageUpload(c);
    if (upload instanceof Response) return upload;

    const photoId = newId();
    const r2Key = `pets/${petId}/photos/${photoId}`;
    await c.env.PHOTOS.put(r2Key, upload.bytes, {
      httpMetadata: { contentType: upload.contentType },
    });
    await db.insert(activityPhotos).values({
      id: photoId,
      activityId: activity.id,
      r2Key,
      width: upload.width,
      height: upload.height,
      contentType: upload.contentType,
      createdAt: Date.now(),
    });
    await writeAudit(db, {
      petId,
      userId: c.get("user").id,
      action: "update",
      entity: "activity",
      entityId: activity.id,
      diff: { photoAdded: photoId },
    });
    return c.json(
      {
        data: {
          id: photoId,
          width: upload.width,
          height: upload.height,
          contentType: upload.contentType,
        },
      },
      201,
    );
  },
);

photoRoutes.get("/api/photos/:photoId", requireSession, async (c) => {
  // `size=thumb|full` is accepted and IGNORED: resizing is deferred to
  // deployment (Cloudflare Images); the stripped original is always served.
  const db = drizzle(c.env.DB);
  const row = await db
    .select({ photo: activityPhotos, petId: activities.petId })
    .from(activityPhotos)
    .innerJoin(activities, eq(activityPhotos.activityId, activities.id))
    .where(eq(activityPhotos.id, c.req.param("photoId")))
    .get();
  if (!row) return err(c, 404, "not_found", "Not found");
  const access = await resolvePetAccess(db, row.petId, c.get("user").id);
  if (!access) return err(c, 404, "not_found", "Not found");
  const obj = await c.env.PHOTOS.get(row.photo.r2Key);
  if (!obj) return err(c, 404, "not_found", "Not found");
  const body = await obj.arrayBuffer();
  return c.body(body, 200, {
    "Content-Type": row.photo.contentType,
    "Cache-Control": "private, max-age=86400",
  });
});

photoRoutes.delete(
  "/api/photos/:photoId",
  requireSession,
  requireCsrf,
  async (c) => {
    const db = drizzle(c.env.DB);
    const row = await db
      .select({ photo: activityPhotos, petId: activities.petId })
      .from(activityPhotos)
      .innerJoin(activities, eq(activityPhotos.activityId, activities.id))
      .where(eq(activityPhotos.id, c.req.param("photoId")))
      .get();
    if (!row) return err(c, 404, "not_found", "Not found");
    const access = await resolvePetAccess(db, row.petId, c.get("user").id);
    if (!access) return err(c, 404, "not_found", "Not found");
    if (!roleAtLeast(access.role, "editor")) {
      return err(c, 403, "forbidden", "Insufficient role");
    }
    await c.env.PHOTOS.delete(row.photo.r2Key);
    await db.delete(activityPhotos).where(eq(activityPhotos.id, row.photo.id));
    await writeAudit(db, {
      petId: row.petId,
      userId: c.get("user").id,
      action: "update",
      entity: "activity",
      entityId: row.photo.activityId,
      diff: { photoRemoved: row.photo.id },
    });
    return c.json({ data: { ok: true } });
  },
);

photoRoutes.post(
  "/api/pets/:petId/avatar",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  uploadLimit,
  async (c) => {
    const upload = await readImageUpload(c);
    if (upload instanceof Response) return upload;
    const pet = c.get("pet");
    const r2Key = `pets/${pet.id}/avatar`;
    await c.env.PHOTOS.put(r2Key, upload.bytes, {
      httpMetadata: { contentType: upload.contentType },
    });
    const db = drizzle(c.env.DB);
    await db.update(pets).set({ avatarR2Key: r2Key }).where(eq(pets.id, pet.id));
    await writeAudit(db, {
      petId: pet.id,
      userId: c.get("user").id,
      action: "update",
      entity: "pet",
      entityId: pet.id,
      diff: { avatarUpdated: true },
    });
    return c.json({ data: { avatarR2Key: r2Key } });
  },
);

photoRoutes.get(
  "/api/pets/:petId/avatar",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const pet = c.get("pet");
    if (!pet.avatarR2Key) return err(c, 404, "not_found", "Not found");
    const obj = await c.env.PHOTOS.get(pet.avatarR2Key);
    if (!obj) return err(c, 404, "not_found", "Not found");
    const body = await obj.arrayBuffer();
    return c.body(body, 200, {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=86400",
    });
  },
);
