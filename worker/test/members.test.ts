import { SELF } from "cloudflare:test";
import type { MembersResponse } from "@pawary/shared";
import { expect, it } from "vitest";
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
