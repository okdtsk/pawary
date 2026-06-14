import { env, SELF } from "cloudflare:test";
import type { ActivityPhotoMeta, ActivityResponse } from "@pawary/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { activityPhotos, auditLog, pets } from "../src/db/schema";
import {
  authHeaders,
  seedActivity,
  seedPet,
  seedUserWithSession,
  withMember,
} from "./helpers";
import { buildGif, buildJpeg, buildPng, containsSeq } from "./image-fixtures";

function upload(
  url: string,
  cookie: string,
  csrfToken: string,
  bytes: Uint8Array,
  filename = "p.jpg",
) {
  const form = new FormData();
  form.append("file", new File([bytes], filename));
  return SELF.fetch(url, {
    method: "POST",
    headers: { Cookie: cookie, "X-CSRF-Token": csrfToken },
    body: form,
  });
}

async function seedOwnerWithActivity() {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const { activityId } = await seedActivity(petId, owner.userId);
  return { ...owner, petId, activityId };
}

it("uploads a jpeg: 201, EXIF stripped in R2, dimensions recorded", async () => {
  const { cookie, csrfToken, petId, activityId } = await seedOwnerWithActivity();
  const res = await upload(
    `https://app.local/api/pets/${petId}/activities/${activityId}/photos`,
    cookie,
    csrfToken,
    buildJpeg(),
  );
  expect(res.status).toBe(201);
  const { data } = (await res.json()) as { data: ActivityPhotoMeta };
  expect(data).toMatchObject({
    width: 120,
    height: 80,
    contentType: "image/jpeg",
  });

  const stored = await env.PHOTOS.get(`pets/${petId}/photos/${data.id}`);
  expect(stored).not.toBeNull();
  const bytes = new Uint8Array(await stored!.arrayBuffer());
  expect(containsSeq(bytes, [0x45, 0x78, 0x69, 0x66])).toBe(false); // "Exif"

  // photo appears on the activity detail
  const detail = await SELF.fetch(
    `https://app.local/api/pets/${petId}/activities/${activityId}`,
    { headers: { Cookie: cookie } },
  );
  const body = (await detail.json()) as { data: ActivityResponse };
  expect(body.data.photos).toEqual([data]);

  // audit row on the activity
  const db = drizzle(env.DB);
  const audits = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityId, activityId))
    .all();
  expect(audits.some((a) => a.action === "update")).toBe(true);
});

it("rejects non-images (400) and oversized files (413)", async () => {
  const { cookie, csrfToken, petId, activityId } = await seedOwnerWithActivity();
  const url = `https://app.local/api/pets/${petId}/activities/${activityId}/photos`;

  const gif = await upload(url, cookie, csrfToken, buildGif(), "p.gif");
  expect(gif.status).toBe(400);
  expect(((await gif.json()) as { error: { code: string } }).error.code).toBe(
    "unsupported_media",
  );

  const big = await upload(
    url,
    cookie,
    csrfToken,
    new Uint8Array(10 * 1024 * 1024 + 1),
  );
  expect(big.status).toBe(413);
});

it("enforces the 6-photo limit per activity", async () => {
  const { cookie, csrfToken, petId, activityId } = await seedOwnerWithActivity();
  const db = drizzle(env.DB);
  for (let i = 0; i < 6; i++) {
    await db.insert(activityPhotos).values({
      id: `photo_${i}`,
      activityId,
      r2Key: `pets/${petId}/photos/photo_${i}`,
      width: 1,
      height: 1,
      contentType: "image/png",
      createdAt: Date.now(),
    });
  }
  const res = await upload(
    `https://app.local/api/pets/${petId}/activities/${activityId}/photos`,
    cookie,
    csrfToken,
    buildPng(),
  );
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
    "photo_limit",
  );
});

it("upload authz: viewer 403, non-member 404, deleted activity 404", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const { activityId } = await seedActivity(petId, owner.userId);
  const url = `https://app.local/api/pets/${petId}/activities/${activityId}/photos`;

  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  expect(
    (await upload(url, viewer.cookie, viewer.csrfToken, buildPng())).status,
  ).toBe(403);

  const outsider = await seedUserWithSession({ email: "eve@example.com" });
  expect(
    (await upload(url, outsider.cookie, outsider.csrfToken, buildPng())).status,
  ).toBe(404);

  const { activityId: ghost } = await seedActivity(petId, owner.userId, {
    deletedAt: Date.now(),
  });
  expect(
    (
      await upload(
        `https://app.local/api/pets/${petId}/activities/${ghost}/photos`,
        owner.cookie,
        owner.csrfToken,
        buildPng(),
      )
    ).status,
  ).toBe(404);
});

it("serves a photo to members with private caching; size param ignored", async () => {
  const { cookie, csrfToken, petId, activityId } =
    await seedOwnerWithActivity();
  const created = await upload(
    `https://app.local/api/pets/${petId}/activities/${activityId}/photos`,
    cookie,
    csrfToken,
    buildPng(),
    "p.png",
  );
  const { data } = (await created.json()) as { data: ActivityPhotoMeta };

  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  const res = await SELF.fetch(
    `https://app.local/api/photos/${data.id}?size=thumb`,
    { headers: { Cookie: viewer.cookie } },
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("image/png");
  expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");
  expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);

  const outsider = await seedUserWithSession({ email: "eve@example.com" });
  const denied = await SELF.fetch(`https://app.local/api/photos/${data.id}`, {
    headers: { Cookie: outsider.cookie },
  });
  expect(denied.status).toBe(404);
});

it("DELETE photo removes the row and the R2 object, with audit", async () => {
  const { cookie, csrfToken, petId, activityId } = await seedOwnerWithActivity();
  const created = await upload(
    `https://app.local/api/pets/${petId}/activities/${activityId}/photos`,
    cookie,
    csrfToken,
    buildPng(),
    "p.png",
  );
  const { data } = (await created.json()) as { data: ActivityPhotoMeta };

  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  const asViewer = await SELF.fetch(`https://app.local/api/photos/${data.id}`, {
    method: "DELETE",
    headers: authHeaders(viewer.cookie, viewer.csrfToken),
  });
  expect(asViewer.status).toBe(403);

  const res = await SELF.fetch(`https://app.local/api/photos/${data.id}`, {
    method: "DELETE",
    headers: authHeaders(cookie, csrfToken),
  });
  expect(res.status).toBe(200);
  expect(await env.PHOTOS.get(`pets/${petId}/photos/${data.id}`)).toBeNull();

  const db = drizzle(env.DB);
  const rows = await db
    .select()
    .from(activityPhotos)
    .where(eq(activityPhotos.id, data.id))
    .all();
  expect(rows).toHaveLength(0);
});

it("avatar upload + serve round-trip; GET 404 when unset", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);

  const missing = await SELF.fetch(
    `https://app.local/api/pets/${petId}/avatar`,
    { headers: { Cookie: cookie } },
  );
  expect(missing.status).toBe(404);

  const up = await upload(
    `https://app.local/api/pets/${petId}/avatar`,
    cookie,
    csrfToken,
    buildPng(),
    "avatar.png",
  );
  expect(up.status).toBe(200);

  const res = await SELF.fetch(`https://app.local/api/pets/${petId}/avatar`, {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("image/png");

  const db = drizzle(env.DB);
  const pet = await db.select().from(pets).where(eq(pets.id, petId)).get();
  // key is versioned per upload so the served URL can be cache-busted
  expect(pet?.avatarR2Key).toMatch(new RegExp(`^pets/${petId}/avatar/`));
});

it("avatar re-upload rotates the key and deletes the previous object", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const url = `https://app.local/api/pets/${petId}/avatar`;
  const db = drizzle(env.DB);

  const first = await upload(url, cookie, csrfToken, buildPng(), "a.png");
  expect(first.status).toBe(200);
  const firstKey = (
    await db.select().from(pets).where(eq(pets.id, petId)).get()
  )?.avatarR2Key;
  expect(firstKey).toBeTruthy();
  expect(await env.PHOTOS.head(firstKey!)).not.toBeNull();

  const second = await upload(url, cookie, csrfToken, buildJpeg(), "b.jpg");
  expect(second.status).toBe(200);
  const secondKey = (
    await db.select().from(pets).where(eq(pets.id, petId)).get()
  )?.avatarR2Key;
  expect(secondKey).toBeTruthy();
  expect(secondKey).not.toBe(firstKey);
  // old object removed, new one present
  expect(await env.PHOTOS.head(firstKey!)).toBeNull();
  expect(await env.PHOTOS.head(secondKey!)).not.toBeNull();
});

it("DELETE avatar: editor ok, viewer 403, clears key + object", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const url = `https://app.local/api/pets/${petId}/avatar`;
  const db = drizzle(env.DB);

  await upload(url, cookie, csrfToken, buildPng(), "a.png");
  const key = (
    await db.select().from(pets).where(eq(pets.id, petId)).get()
  )?.avatarR2Key;
  expect(key).toBeTruthy();

  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  const denied = await SELF.fetch(url, {
    method: "DELETE",
    headers: authHeaders(viewer.cookie, viewer.csrfToken),
  });
  expect(denied.status).toBe(403);

  const res = await SELF.fetch(url, {
    method: "DELETE",
    headers: authHeaders(cookie, csrfToken),
  });
  expect(res.status).toBe(200);
  expect(await env.PHOTOS.head(key!)).toBeNull();
  const pet = await db.select().from(pets).where(eq(pets.id, petId)).get();
  expect(pet?.avatarR2Key).toBeNull();

  // GET now 404s
  const gone = await SELF.fetch(url, { headers: { Cookie: cookie } });
  expect(gone.status).toBe(404);

  // audit recorded
  const audits = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.petId, petId))
    .all();
  expect(audits.some((a) => a.entity === "pet")).toBe(true);
});

it("DELETE pet: owner only; cascades rows and wipes the R2 prefix", async () => {
  const { userId, cookie, csrfToken, petId, activityId } =
    await seedOwnerWithActivity();
  await upload(
    `https://app.local/api/pets/${petId}/activities/${activityId}/photos`,
    cookie,
    csrfToken,
    buildPng(),
    "p.png",
  );
  await upload(
    `https://app.local/api/pets/${petId}/avatar`,
    cookie,
    csrfToken,
    buildPng(),
    "avatar.png",
  );

  const editor = await seedUserWithSession({ email: "ed@example.com" });
  await withMember(petId, editor.userId, "editor");
  const asEditor = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    method: "DELETE",
    headers: authHeaders(editor.cookie, editor.csrfToken),
  });
  expect(asEditor.status).toBe(403);

  const res = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    method: "DELETE",
    headers: authHeaders(cookie, csrfToken),
  });
  expect(res.status).toBe(200);

  const gone = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    headers: { Cookie: cookie },
  });
  expect(gone.status).toBe(404);

  const listing = await env.PHOTOS.list({ prefix: `pets/${petId}/` });
  expect(listing.objects).toHaveLength(0);

  const db = drizzle(env.DB);
  const { activities } = await import("../src/db/schema");
  const rows = await db
    .select()
    .from(activities)
    .where(eq(activities.petId, petId))
    .all();
  expect(rows).toHaveLength(0); // FK cascade

  const audits = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.petId, petId))
    .all();
  expect(
    audits.some((a) => a.entity === "pet" && a.action === "delete"),
  ).toBe(true);
  expect(audits.at(-1)?.userId).toBe(userId);
});
