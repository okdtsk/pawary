import { env, SELF } from "cloudflare:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { advisorConversations, advisorMessages } from "../src/db/schema";
import { newId } from "../src/lib/id";
import {
  seedActivity,
  seedPet,
  seedUserWithSession,
  withMember,
} from "./helpers";

it("GET /api/me/export returns owner pets with flagged soft-deleted activities", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId, "owner", { name: "Momo" });
  await seedActivity(petId, userId, { memo: "alive" });
  await seedActivity(petId, userId, { memo: "ghost", deletedAt: Date.now() });

  // a pet where the caller is only a viewer must NOT be exported
  const other = await seedUserWithSession({ email: "o@example.com" });
  const { petId: viewedPet } = await seedPet(other.userId);
  await withMember(viewedPet, userId, "viewer");

  const res = await SELF.fetch("https://app.local/api/me/export", {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Disposition")).toContain("attachment");
  const body = (await res.json()) as {
    user: { id: string };
    pets: Array<{
      pet: { id: string; name: string };
      activities: Array<{ memo: string | null; deleted: boolean }>;
    }>;
  };
  expect(body.user.id).toBe(userId);
  expect(body.pets).toHaveLength(1);
  expect(body.pets[0]?.pet.name).toBe("Momo");
  const activities = body.pets[0]!.activities;
  expect(activities.find((a) => a.memo === "alive")?.deleted).toBe(false);
  expect(activities.find((a) => a.memo === "ghost")?.deleted).toBe(true);
});

it("GET /api/pets/:petId/export?format=json works for viewers", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  await seedActivity(petId, owner.userId, { memo: "hello" });

  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/export?format=json`,
    { headers: { Cookie: viewer.cookie } },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    pet: { id: string };
    activities: unknown[];
    photos: unknown[];
  };
  expect(body.pet.id).toBe(petId);
  expect(body.activities).toHaveLength(1);
  expect(body.photos).toEqual([]);
});

it("CSV export escapes fields and excludes soft-deleted rows", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  await seedActivity(petId, userId, {
    category: "note",
    occurredAt: Date.UTC(2026, 0, 1, 12, 0),
    tzOffsetMin: 540,
    memo: 'ate "everything", then napped',
  });
  await seedActivity(petId, userId, {
    memo: "ghost",
    deletedAt: Date.now(),
  });

  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/export?format=csv`,
    { headers: { Cookie: cookie } },
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toContain("text/csv");
  const text = await res.text();
  const lines = text.trim().split("\r\n");
  expect(lines[0]).toBe("id,category,occurred_at,memo,details");
  expect(lines).toHaveLength(2); // header + 1 live row
  expect(lines[1]).toContain('"ate ""everything"", then napped"');
  expect(lines[1]).toContain("2026-01-01T21:00:00.000+09:00");
  expect(text).not.toContain("ghost");
});

it("rejects unknown formats and non-members", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const bad = await SELF.fetch(
    `https://app.local/api/pets/${petId}/export?format=xml`,
    { headers: { Cookie: cookie } },
  );
  expect(bad.status).toBe(400);

  const outsider = await seedUserWithSession({ email: "eve@example.com" });
  const denied = await SELF.fetch(
    `https://app.local/api/pets/${petId}/export?format=json`,
    { headers: { Cookie: outsider.cookie } },
  );
  expect(denied.status).toBe(404);
});

it("export includes advisorConversations with messages for pet and me endpoints", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId, "owner");
  const db = drizzle(env.DB);
  const now = Date.now();

  // Seed a conversation with 2 messages via direct drizzle inserts
  const convId = newId();
  await db.insert(advisorConversations).values({
    id: convId,
    petId,
    title: "Is Momo doing well?",
    createdBy: userId,
    createdAt: now,
    updatedAt: now + 1,
  });
  const msg1Id = newId();
  const msg2Id = newId();
  await db.insert(advisorMessages).values({
    id: msg1Id,
    conversationId: convId,
    role: "user",
    content: "Is Momo doing well?",
    authorId: userId,
    createdAt: now,
  });
  await db.insert(advisorMessages).values({
    id: msg2Id,
    conversationId: convId,
    role: "assistant",
    content: "Momo looks great!",
    authorId: userId,
    provider: "anthropic",
    model: "claude-opus-4-8",
    createdAt: now + 1,
  });

  // Test GET /api/pets/:petId/export?format=json
  const petRes = await SELF.fetch(
    `https://app.local/api/pets/${petId}/export?format=json`,
    { headers: { Cookie: cookie } },
  );
  expect(petRes.status).toBe(200);
  const petBody = (await petRes.json()) as {
    advisorConversations: Array<{
      id: string;
      title: string;
      messages: Array<{ id: string; role: string; content: string }>;
    }>;
  };
  expect(petBody.advisorConversations).toHaveLength(1);
  expect(petBody.advisorConversations[0]?.id).toBe(convId);
  expect(petBody.advisorConversations[0]?.title).toBe("Is Momo doing well?");
  expect(petBody.advisorConversations[0]?.messages).toHaveLength(2);
  const roles = petBody.advisorConversations[0]!.messages.map((m) => m.role);
  expect(roles).toContain("user");
  expect(roles).toContain("assistant");

  // Test GET /api/me/export
  const meRes = await SELF.fetch("https://app.local/api/me/export", {
    headers: { Cookie: cookie },
  });
  expect(meRes.status).toBe(200);
  const meBody = (await meRes.json()) as {
    pets: Array<{
      pet: { id: string };
      advisorConversations: Array<{
        id: string;
        messages: Array<{ id: string }>;
      }>;
    }>;
  };
  const petEntry = meBody.pets.find((p) => p.pet.id === petId);
  expect(petEntry).toBeDefined();
  expect(petEntry!.advisorConversations).toHaveLength(1);
  expect(petEntry!.advisorConversations[0]?.id).toBe(convId);
  expect(petEntry!.advisorConversations[0]?.messages).toHaveLength(2);
});
