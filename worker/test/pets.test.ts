import { env, SELF } from "cloudflare:test";
import type { PetResponse } from "@pawlog/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { auditLog } from "../src/db/schema";
import {
  authHeaders,
  seedPet,
  seedUserWithSession,
  withMember,
} from "./helpers";

async function createPet(
  cookie: string,
  csrfToken: string,
  body: unknown = { name: "Momo", species: "cat" },
) {
  return SELF.fetch("https://app.local/api/pets", {
    method: "POST",
    headers: authHeaders(cookie, csrfToken),
    body: JSON.stringify(body),
  });
}

it("POST /api/pets creates a pet, owner membership, and audit row", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const res = await createPet(cookie, csrfToken, {
    name: "Momo",
    species: "cat",
    breed: "Mixed",
    birthday: "2020-04-01",
  });
  expect(res.status).toBe(201);
  const { data } = (await res.json()) as { data: PetResponse };
  expect(data.name).toBe("Momo");
  expect(data.role).toBe("owner");
  expect(data.archived).toBe(false);
  expect(data.targets).toBeNull();

  // visible in /api/me with owner role
  const me = await SELF.fetch("https://app.local/api/me", {
    headers: { Cookie: cookie },
  });
  const meBody = (await me.json()) as {
    data: { pets: Array<{ id: string; role: string }> };
  };
  expect(meBody.data.pets).toEqual([
    expect.objectContaining({ id: data.id, role: "owner" }),
  ]);

  const db = drizzle(env.DB);
  const audits = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.petId, data.id))
    .all();
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    userId,
    action: "create",
    entity: "pet",
    entityId: data.id,
  });
});

it("POST /api/pets rejects invalid bodies", async () => {
  const { cookie, csrfToken } = await seedUserWithSession();
  for (const body of [
    { name: "", species: "cat" },
    { name: "x".repeat(51), species: "cat" },
    { name: "Momo", species: "hamster" },
    { name: "Momo", species: "cat", birthday: "April 1" },
    { name: "Momo", species: "cat", isAdmin: true },
  ]) {
    const res = await createPet(cookie, csrfToken, body);
    expect(res.status).toBe(400);
  }
});

it("POST /api/pets requires a csrf token", async () => {
  const { cookie } = await seedUserWithSession();
  const res = await SELF.fetch("https://app.local/api/pets", {
    method: "POST",
    headers: authHeaders(cookie),
    body: JSON.stringify({ name: "Momo", species: "cat" }),
  });
  expect(res.status).toBe(403);
});

it("GET /api/pets/:petId is 404 for non-members and unknown ids", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const outsider = await seedUserWithSession({ email: "eve@example.com" });
  for (const id of [petId, "01HZZZZZZZZZZZZZZZZZZZZZZZ"]) {
    const res = await SELF.fetch(`https://app.local/api/pets/${id}`, {
      headers: { Cookie: outsider.cookie },
    });
    expect(res.status).toBe(404);
  }
});

it("GET /api/pets/:petId returns the pet with the caller's role", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId, "owner", { name: "Hana" });
  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  const res = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    headers: { Cookie: viewer.cookie },
  });
  expect(res.status).toBe(200);
  const { data } = (await res.json()) as { data: PetResponse };
  expect(data.name).toBe("Hana");
  expect(data.role).toBe("viewer");
});

it("PATCH /api/pets/:petId updates fields as editor and writes an audit diff", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const editor = await seedUserWithSession({ email: "ed@example.com" });
  await withMember(petId, editor.userId, "editor");
  const res = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    method: "PATCH",
    headers: authHeaders(editor.cookie, editor.csrfToken),
    body: JSON.stringify({ name: "Hana", breed: null }),
  });
  expect(res.status).toBe(200);
  const { data } = (await res.json()) as { data: PetResponse };
  expect(data.name).toBe("Hana");
  expect(data.breed).toBeNull();

  const db = drizzle(env.DB);
  const audits = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.petId, petId))
    .all();
  expect(audits).toHaveLength(1);
  expect(audits[0]?.action).toBe("update");
  expect(audits[0]?.diff).toMatchObject({
    before: { name: "Momo" },
    after: { name: "Hana" },
  });
});

it("PATCH /api/pets/:petId is 403 for viewers and 404 for non-members", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  const asViewer = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    method: "PATCH",
    headers: authHeaders(viewer.cookie, viewer.csrfToken),
    body: JSON.stringify({ name: "Hana" }),
  });
  expect(asViewer.status).toBe(403);

  const outsider = await seedUserWithSession({ email: "eve@example.com" });
  const asOutsider = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    method: "PATCH",
    headers: authHeaders(outsider.cookie, outsider.csrfToken),
    body: JSON.stringify({ name: "Hana" }),
  });
  expect(asOutsider.status).toBe(404);
});

it("PATCH /api/pets/:petId rejects an empty body", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const res = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    method: "PATCH",
    headers: authHeaders(cookie, csrfToken),
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(400);
});
