import { env, SELF } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, expect, it } from "vitest";
import { auditLog, petMembers, pets, sessions, users } from "../src/db/schema";
import { resetRateLimits } from "../src/lib/rate-limit";
import {
  authHeaders,
  seedActivity,
  seedPet,
  seedUserWithSession,
  withMember,
} from "./helpers";

beforeEach(() => resetRateLimits());
afterEach(() => resetRateLimits());

function deleteMe(cookie: string, csrfToken: string, confirmEmail: string) {
  return SELF.fetch("https://app.local/api/me", {
    method: "DELETE",
    headers: authHeaders(cookie, csrfToken),
    body: JSON.stringify({ confirmEmail }),
  });
}

it("rejects a wrong or differently-cased confirmation email", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  for (const email of ["other@example.com", "PAT@example.com", ""]) {
    const res = await deleteMe(cookie, csrfToken, email);
    expect(res.status).toBe(400);
  }
  const db = drizzle(env.DB);
  expect(
    await db.select().from(users).where(eq(users.id, userId)).get(),
  ).toBeTruthy();
});

it("deletes the user, sessions, sole-owned pets, and their R2 objects", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  await seedActivity(petId, userId);
  await env.PHOTOS.put(`pets/${petId}/photos/x`, new Uint8Array([1, 2, 3]));
  await env.PHOTOS.put(`pets/${petId}/avatar`, new Uint8Array([4, 5, 6]));

  const res = await deleteMe(cookie, csrfToken, "pat@example.com");
  expect(res.status).toBe(200);
  // session cookie cleared
  expect(
    res.headers.getSetCookie().some((v) => v.startsWith("session=")),
  ).toBe(true);

  const db = drizzle(env.DB);
  expect(await db.select().from(users).all()).toHaveLength(0);
  expect(await db.select().from(sessions).all()).toHaveLength(0);
  expect(await db.select().from(pets).all()).toHaveLength(0);
  const listing = await env.PHOTOS.list({ prefix: `pets/${petId}/` });
  expect(listing.objects).toHaveLength(0);

  // audit rows have no FKs, so the pet-delete audit survives the cascade
  const audits = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.petId, petId))
    .all();
  expect(
    audits.some(
      (a) =>
        a.entity === "pet" && a.action === "delete" && a.userId === userId,
    ),
  ).toBe(true);

  // old cookie is dead
  const me = await SELF.fetch("https://app.local/api/me", {
    headers: { Cookie: cookie },
  });
  expect(me.status).toBe(401);
});

it("shared pets with another owner survive, with a member-delete audit row", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const coOwner = await seedUserWithSession({ email: "co@example.com" });
  const { petId: sharedPet } = await seedPet(userId, "owner");
  await withMember(sharedPet, coOwner.userId, "owner");

  const other = await seedUserWithSession({ email: "boss@example.com" });
  const { petId: editedPet } = await seedPet(other.userId, "owner");
  await withMember(editedPet, userId, "editor");

  const res = await deleteMe(cookie, csrfToken, "pat@example.com");
  expect(res.status).toBe(200);

  const db = drizzle(env.DB);
  // both pets survive; the deleted user's memberships cascaded away
  expect(await db.select().from(pets).all()).toHaveLength(2);
  expect(
    await db.select().from(petMembers).where(eq(petMembers.userId, userId)).all(),
  ).toHaveLength(0);

  for (const petId of [sharedPet, editedPet]) {
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.petId, petId))
      .all();
    expect(
      audits.some(
        (a) =>
          a.entity === "member" && a.action === "delete" && a.entityId === userId,
      ),
    ).toBe(true);
  }
});

it("is rate limited to 3 attempts per hour per user", async () => {
  const { cookie, csrfToken } = await seedUserWithSession();
  for (let i = 0; i < 3; i++) {
    const res = await deleteMe(cookie, csrfToken, "wrong@example.com");
    expect(res.status).toBe(400); // wrong email, but counted
  }
  const blocked = await deleteMe(cookie, csrfToken, "wrong@example.com");
  expect(blocked.status).toBe(429);
});
