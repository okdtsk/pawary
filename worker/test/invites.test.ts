import { env, SELF } from "cloudflare:test";
import type { CreateInviteResponse, MembersResponse } from "@pawary/shared";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { auditLog, petInvites } from "../src/db/schema";
import { sha256Hex } from "../src/lib/crypto";
import { newId } from "../src/lib/id";
import { authHeaders, seedPet, seedUserWithSession, withMember } from "./helpers";

it("pet_invites rows round-trip through the migration", async () => {
  const { userId } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const db = drizzle(env.DB);
  const now = Date.now();
  const id = newId();
  await db.insert(petInvites).values({
    id,
    petId,
    role: "editor",
    tokenHash: "a".repeat(64),
    createdBy: userId,
    createdAt: now,
    expiresAt: now + 1000,
  });
  const row = await db.select().from(petInvites).where(eq(petInvites.id, id)).get();
  expect(row).toMatchObject({ id, petId, role: "editor", usedAt: null, usedBy: null });
});

async function createInvite(
  petId: string,
  auth: { cookie: string; csrfToken: string },
  role: string = "editor",
) {
  return SELF.fetch(`https://app.local/api/pets/${petId}/invites`, {
    method: "POST",
    headers: authHeaders(auth.cookie, auth.csrfToken),
    body: JSON.stringify({ role }),
  });
}

it("POST invites creates a hashed single-use invite and returns the URL once", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const res = await createInvite(petId, owner, "viewer");
  expect(res.status).toBe(201);
  const { data } = (await res.json()) as { data: CreateInviteResponse };
  const token = data.url.split("/join/")[1]!;
  expect(token.length).toBeGreaterThanOrEqual(40);
  expect(new URL(data.url).pathname).toBe(`/join/${token}`);

  const db = drizzle(env.DB);
  const row = await db
    .select()
    .from(petInvites)
    .where(eq(petInvites.id, data.id))
    .get();
  expect(row).toMatchObject({ petId, role: "viewer", usedAt: null });
  expect(row!.tokenHash).toBe(await sha256Hex(token)); // raw token never stored
  expect(row!.expiresAt - row!.createdAt).toBe(7 * 24 * 60 * 60 * 1000);

  const audits = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.petId, petId), eq(auditLog.entity, "invite")))
    .all();
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ action: "create", entityId: data.id });
});

it("POST invites rejects owner role and non-owner callers", async () => {
  const owner = await seedUserWithSession();
  const editor = await seedUserWithSession({ email: "e@example.com" });
  const { petId } = await seedPet(owner.userId);
  await withMember(petId, editor.userId, "editor");

  const badRole = await createInvite(petId, owner, "owner");
  expect(badRole.status).toBe(400);

  const forbidden = await createInvite(petId, editor);
  expect(forbidden.status).toBe(403);
});

it("pending invites appear in GET members for owners; expired ones are filtered", async () => {
  const owner = await seedUserWithSession({ displayName: "Olive" });
  const { petId } = await seedPet(owner.userId);
  const created = (await (await createInvite(petId, owner)).json()) as {
    data: CreateInviteResponse;
  };

  // seed an EXPIRED invite directly — must never surface
  const db = drizzle(env.DB);
  await db.insert(petInvites).values({
    id: newId(),
    petId,
    role: "viewer",
    tokenHash: "b".repeat(64),
    createdBy: owner.userId,
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() - 1,
  });

  const members = await SELF.fetch(`https://app.local/api/pets/${petId}/members`, {
    headers: { Cookie: owner.cookie },
  });
  const body = (await members.json()) as { data: MembersResponse };
  expect(body.data.invites).toHaveLength(1);
  expect(body.data.invites![0]).toMatchObject({
    id: created.data.id,
    role: "editor",
    createdByName: "Olive",
  });
});

it("DELETE invites revokes a pending invite; revoked invites vanish from GET members", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const created = (await (await createInvite(petId, owner)).json()) as {
    data: CreateInviteResponse;
  };

  const del = await SELF.fetch(
    `https://app.local/api/pets/${petId}/invites/${created.data.id}`,
    { method: "DELETE", headers: authHeaders(owner.cookie, owner.csrfToken) },
  );
  expect(del.status).toBe(200);

  const members = await SELF.fetch(`https://app.local/api/pets/${petId}/members`, {
    headers: { Cookie: owner.cookie },
  });
  const body = (await members.json()) as { data: MembersResponse };
  expect(body.data.invites).toEqual([]);

  const again = await SELF.fetch(
    `https://app.local/api/pets/${petId}/invites/${created.data.id}`,
    { method: "DELETE", headers: authHeaders(owner.cookie, owner.csrfToken) },
  );
  expect(again.status).toBe(404); // second revoke is not found
});
