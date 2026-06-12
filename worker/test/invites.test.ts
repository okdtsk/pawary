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

async function createdInviteUrl(
  petId: string,
  auth: { cookie: string; csrfToken: string },
  role: string = "editor",
): Promise<string> {
  const res = await createInvite(petId, auth, role);
  const { data } = (await res.json()) as { data: CreateInviteResponse };
  return data.url;
}

function tokenOf(url: string): string {
  return url.split("/join/")[1]!;
}

it("GET invite preview returns pet/inviter/role for a valid token, 404 otherwise", async () => {
  const owner = await seedUserWithSession({ displayName: "Olive" });
  const invitee = await seedUserWithSession({ email: "i@example.com" });
  const { petId } = await seedPet(owner.userId, "owner", { name: "Momo" });
  const url = await createdInviteUrl(petId, owner, "viewer");

  const res = await SELF.fetch(
    `https://app.local/api/invites/${tokenOf(url)}`,
    { headers: { Cookie: invitee.cookie } },
  );
  expect(res.status).toBe(200);
  expect(((await res.json()) as { data: unknown }).data).toEqual({
    petName: "Momo",
    role: "viewer",
    inviterName: "Olive",
  });

  const bogus = await SELF.fetch(`https://app.local/api/invites/${"x".repeat(43)}`, {
    headers: { Cookie: invitee.cookie },
  });
  expect(bogus.status).toBe(404);

  const anon = await SELF.fetch(`https://app.local/api/invites/${tokenOf(url)}`);
  expect(anon.status).toBe(401);
});

it("POST accept joins the pet, consumes the token, and audits", async () => {
  const owner = await seedUserWithSession();
  const invitee = await seedUserWithSession({ email: "i@example.com" });
  const { petId } = await seedPet(owner.userId);
  const url = await createdInviteUrl(petId, owner, "editor");
  const token = tokenOf(url);

  const res = await SELF.fetch(`https://app.local/api/invites/${token}/accept`, {
    method: "POST",
    headers: authHeaders(invitee.cookie, invitee.csrfToken),
  });
  expect(res.status).toBe(201);
  expect(((await res.json()) as { data: unknown }).data).toEqual({
    petId,
    role: "editor",
    alreadyMember: false,
  });

  // membership live: invitee can read the pet
  const pet = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    headers: { Cookie: invitee.cookie },
  });
  expect(pet.status).toBe(200);

  // replay is consumed
  const replay = await SELF.fetch(`https://app.local/api/invites/${token}/accept`, {
    method: "POST",
    headers: authHeaders(invitee.cookie, invitee.csrfToken),
  });
  expect(replay.status).toBe(404);

  const db = drizzle(env.DB);
  const memberAudits = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.petId, petId), eq(auditLog.entity, "member")))
    .all();
  expect(memberAudits).toHaveLength(1);
  expect(memberAudits[0]).toMatchObject({
    action: "create",
    entityId: invitee.userId,
    userId: invitee.userId,
  });
});

it("POST accept on an expired invite is 404", async () => {
  const owner = await seedUserWithSession();
  const invitee = await seedUserWithSession({ email: "i@example.com" });
  const { petId } = await seedPet(owner.userId);
  const url = await createdInviteUrl(petId, owner);
  const token = tokenOf(url);

  const db = drizzle(env.DB);
  await db
    .update(petInvites)
    .set({ expiresAt: Date.now() - 1000 })
    .where(eq(petInvites.tokenHash, await sha256Hex(token)));

  const res = await SELF.fetch(`https://app.local/api/invites/${token}/accept`, {
    method: "POST",
    headers: authHeaders(invitee.cookie, invitee.csrfToken),
  });
  expect(res.status).toBe(404);
});

it("POST accept by an existing member consumes the invite without changing the role", async () => {
  const owner = await seedUserWithSession();
  const editor = await seedUserWithSession({ email: "e@example.com" });
  const { petId } = await seedPet(owner.userId);
  await withMember(petId, editor.userId, "editor");
  const url = await createdInviteUrl(petId, owner, "viewer");

  const res = await SELF.fetch(`https://app.local/api/invites/${tokenOf(url)}/accept`, {
    method: "POST",
    headers: authHeaders(editor.cookie, editor.csrfToken),
  });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { data: unknown }).data).toEqual({
    petId,
    role: "editor", // their existing role, NOT the invite's viewer
    alreadyMember: true,
  });
});

it("two concurrent accepts: exactly one wins", async () => {
  const owner = await seedUserWithSession();
  const a = await seedUserWithSession({ email: "a@example.com" });
  const b = await seedUserWithSession({ email: "b@example.com" });
  const { petId } = await seedPet(owner.userId);
  const token = tokenOf(await createdInviteUrl(petId, owner));

  const [resA, resB] = await Promise.all([
    SELF.fetch(`https://app.local/api/invites/${token}/accept`, {
      method: "POST",
      headers: authHeaders(a.cookie, a.csrfToken),
    }),
    SELF.fetch(`https://app.local/api/invites/${token}/accept`, {
      method: "POST",
      headers: authHeaders(b.cookie, b.csrfToken),
    }),
  ]);
  const statuses = [resA.status, resB.status].sort();
  expect(statuses).toEqual([201, 404]);
});
