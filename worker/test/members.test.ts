import { SELF, env } from "cloudflare:test";
import type { MembersResponse } from "@pawary/shared";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { auditLog, petMembers } from "../src/db/schema";
import { authHeaders, seedPet, seedUserWithSession, withMember } from "./helpers";

it("GET members returns all members with isMe; invites only for owners", async () => {
  const owner = await seedUserWithSession({ email: "o@example.com", displayName: "Olive" });
  const editor = await seedUserWithSession({ email: "e@example.com", displayName: "Eddy" });
  const { petId } = await seedPet(owner.userId);
  await withMember(petId, editor.userId, "editor");

  const ownerRes = await SELF.fetch(`https://app.local/api/pets/${petId}/members`, {
    headers: { Cookie: owner.cookie },
  });
  expect(ownerRes.status).toBe(200);
  const ownerBody = (await ownerRes.json()) as { data: MembersResponse };
  expect(ownerBody.data.members).toHaveLength(2);
  expect(ownerBody.data.members[0]).toMatchObject({
    userId: owner.userId,
    displayName: "Olive",
    role: "owner",
    isMe: true,
  });
  expect(ownerBody.data.members[1]).toMatchObject({
    userId: editor.userId,
    role: "editor",
    isMe: false,
  });
  expect(ownerBody.data.invites).toEqual([]); // owner sees the (empty) list

  const editorRes = await SELF.fetch(`https://app.local/api/pets/${petId}/members`, {
    headers: { Cookie: editor.cookie },
  });
  const editorBody = (await editorRes.json()) as { data: MembersResponse };
  expect(editorBody.data.members).toHaveLength(2);
  expect(editorBody.data.invites).toBeNull(); // non-owner never sees invites
  expect(editorBody.data.members.find((m) => m.isMe)?.userId).toBe(editor.userId);
});

it("GET members is 404 for non-members", async () => {
  const owner = await seedUserWithSession();
  const stranger = await seedUserWithSession({ email: "s@example.com" });
  const { petId } = await seedPet(owner.userId);
  const res = await SELF.fetch(`https://app.local/api/pets/${petId}/members`, {
    headers: { Cookie: stranger.cookie },
  });
  expect(res.status).toBe(404);
});

function memberUrl(petId: string, userId: string) {
  return `https://app.local/api/pets/${petId}/members/${userId}`;
}

it("PATCH member role promotes/demotes with audit; guards the last owner", async () => {
  const owner = await seedUserWithSession();
  const editor = await seedUserWithSession({ email: "e@example.com" });
  const { petId } = await seedPet(owner.userId);
  await withMember(petId, editor.userId, "editor");

  const promote = await SELF.fetch(memberUrl(petId, editor.userId), {
    method: "PATCH",
    headers: authHeaders(owner.cookie, owner.csrfToken),
    body: JSON.stringify({ role: "owner" }),
  });
  expect(promote.status).toBe(200);

  // two owners now — demoting the original owner is allowed
  const demote = await SELF.fetch(memberUrl(petId, owner.userId), {
    method: "PATCH",
    headers: authHeaders(editor.cookie, editor.csrfToken),
    body: JSON.stringify({ role: "viewer" }),
  });
  expect(demote.status).toBe(200);

  // editor (now sole owner) cannot demote themself
  const lastOwner = await SELF.fetch(memberUrl(petId, editor.userId), {
    method: "PATCH",
    headers: authHeaders(editor.cookie, editor.csrfToken),
    body: JSON.stringify({ role: "editor" }),
  });
  expect(lastOwner.status).toBe(409);
  expect(((await lastOwner.json()) as { error: { code: string } }).error.code).toBe("last_owner");

  const db = drizzle(env.DB);
  const audits = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.petId, petId), eq(auditLog.entity, "member")))
    .all();
  expect(audits.filter((a) => a.action === "update")).toHaveLength(2);
});

it("PATCH member role is owner-only and 404s on non-members", async () => {
  const owner = await seedUserWithSession();
  const editor = await seedUserWithSession({ email: "e@example.com" });
  const stranger = await seedUserWithSession({ email: "s@example.com" });
  const { petId } = await seedPet(owner.userId);
  await withMember(petId, editor.userId, "editor");

  const forbidden = await SELF.fetch(memberUrl(petId, owner.userId), {
    method: "PATCH",
    headers: authHeaders(editor.cookie, editor.csrfToken),
    body: JSON.stringify({ role: "viewer" }),
  });
  expect(forbidden.status).toBe(403);

  const notMember = await SELF.fetch(memberUrl(petId, stranger.userId), {
    method: "PATCH",
    headers: authHeaders(owner.cookie, owner.csrfToken),
    body: JSON.stringify({ role: "viewer" }),
  });
  expect(notMember.status).toBe(404);
});

it("DELETE member: owner removes others; anyone can leave; last owner cannot", async () => {
  const owner = await seedUserWithSession();
  const editor = await seedUserWithSession({ email: "e@example.com" });
  const viewer = await seedUserWithSession({ email: "v@example.com" });
  const { petId } = await seedPet(owner.userId);
  await withMember(petId, editor.userId, "editor");
  await withMember(petId, viewer.userId, "viewer");

  // editor cannot remove someone else
  const forbidden = await SELF.fetch(memberUrl(petId, viewer.userId), {
    method: "DELETE",
    headers: authHeaders(editor.cookie, editor.csrfToken),
  });
  expect(forbidden.status).toBe(403);

  // viewer leaves themself
  const leave = await SELF.fetch(memberUrl(petId, viewer.userId), {
    method: "DELETE",
    headers: authHeaders(viewer.cookie, viewer.csrfToken),
  });
  expect(leave.status).toBe(200);

  // owner removes the editor
  const remove = await SELF.fetch(memberUrl(petId, editor.userId), {
    method: "DELETE",
    headers: authHeaders(owner.cookie, owner.csrfToken),
  });
  expect(remove.status).toBe(200);

  // sole owner cannot leave
  const lastOwner = await SELF.fetch(memberUrl(petId, owner.userId), {
    method: "DELETE",
    headers: authHeaders(owner.cookie, owner.csrfToken),
  });
  expect(lastOwner.status).toBe(409);

  const db = drizzle(env.DB);
  const remaining = await db
    .select()
    .from(petMembers)
    .where(eq(petMembers.petId, petId))
    .all();
  expect(remaining).toHaveLength(1);
  expect(remaining[0]!.userId).toBe(owner.userId);

  // removed member can no longer see the pet (anti-probing 404)
  const gone = await SELF.fetch(`https://app.local/api/pets/${petId}`, {
    headers: { Cookie: editor.cookie },
  });
  expect(gone.status).toBe(404);
});
