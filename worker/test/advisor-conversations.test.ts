import { SELF, env } from "cloudflare:test";
import type { AdvisorConversationDetail, AdvisorConversationSummary } from "@pawary/shared";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { advisorConversations, advisorMessages, auditLog } from "../src/db/schema";
import { newId } from "../src/lib/id";
import { authHeaders, seedPet, seedUserWithSession, withMember } from "./helpers";

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedConversation(
  petId: string,
  createdBy: string | null,
  overrides: Partial<{ title: string; updatedAt: number }> = {},
): Promise<{ convId: string }> {
  const db = drizzle(env.DB);
  const now = Date.now();
  const convId = newId();
  await db.insert(advisorConversations).values({
    id: convId,
    petId,
    title: overrides.title ?? "Test conversation",
    createdBy,
    createdAt: now,
    updatedAt: overrides.updatedAt ?? now,
  });
  return { convId };
}

async function seedMessage(
  convId: string,
  role: "user" | "assistant",
  overrides: Partial<{
    content: string;
    authorId: string | null;
    provider: string | null;
    model: string | null;
    createdAt: number;
  }> = {},
): Promise<{ msgId: string }> {
  const db = drizzle(env.DB);
  const msgId = newId();
  await db.insert(advisorMessages).values({
    id: msgId,
    conversationId: convId,
    role,
    content: overrides.content ?? "Hello",
    authorId: overrides.authorId !== undefined ? overrides.authorId : null,
    provider: overrides.provider !== undefined ? overrides.provider : null,
    model: overrides.model !== undefined ? overrides.model : null,
    createdAt: overrides.createdAt ?? Date.now(),
  });
  return { msgId };
}

// ---------------------------------------------------------------------------
// Group 1: List conversations
// ---------------------------------------------------------------------------

it("GET conversations: viewer can read; newest-updatedAt-first; createdByName joined from users", async () => {
  const owner = await seedUserWithSession({ email: "owner@example.com", displayName: "Owner One" });
  const viewer = await seedUserWithSession({ email: "viewer@example.com", displayName: "Viewer Two" });
  const { petId } = await seedPet(owner.userId);
  await withMember(petId, viewer.userId, "viewer");

  const now = Date.now();
  const { convId: convOld } = await seedConversation(petId, owner.userId, {
    title: "Older convo",
    updatedAt: now - 10000,
  });
  const { convId: convNew } = await seedConversation(petId, viewer.userId, {
    title: "Newer convo",
    updatedAt: now,
  });

  const res = await SELF.fetch(`https://app.local/api/pets/${petId}/advisor/conversations`, {
    headers: { Cookie: viewer.cookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: AdvisorConversationSummary[] };
  expect(body.data).toHaveLength(2);
  // newest updatedAt first
  expect(body.data[0]!.id).toBe(convNew);
  expect(body.data[0]!.title).toBe("Newer convo");
  expect(body.data[0]!.createdByName).toBe("Viewer Two");
  expect(body.data[1]!.id).toBe(convOld);
  expect(body.data[1]!.createdByName).toBe("Owner One");
  void convOld; // used above
});

it("GET conversations: conversation with null createdBy shows createdByName null", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  // seed a conversation with no creator (deleted user scenario)
  await seedConversation(petId, null, { title: "Orphaned convo" });

  const res = await SELF.fetch(`https://app.local/api/pets/${petId}/advisor/conversations`, {
    headers: { Cookie: owner.cookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: AdvisorConversationSummary[] };
  expect(body.data).toHaveLength(1);
  expect(body.data[0]!.createdByName).toBeNull();
});

it("GET conversations: non-member gets 404", async () => {
  const owner = await seedUserWithSession();
  const stranger = await seedUserWithSession({ email: "stranger@example.com" });
  const { petId } = await seedPet(owner.userId);
  await seedConversation(petId, owner.userId);

  const res = await SELF.fetch(`https://app.local/api/pets/${petId}/advisor/conversations`, {
    headers: { Cookie: stranger.cookie },
  });
  expect(res.status).toBe(404);
});

// ---------------------------------------------------------------------------
// Group 2: Get conversation detail
// ---------------------------------------------------------------------------

it("GET conversation detail: messages oldest-first with authorName, provider, model", async () => {
  const owner = await seedUserWithSession({ displayName: "Daisy" });
  const { petId } = await seedPet(owner.userId);
  const { convId } = await seedConversation(petId, owner.userId, { title: "Detail test" });

  const now = Date.now();
  const { msgId: m1 } = await seedMessage(convId, "user", {
    content: "Is Momo eating ok?",
    authorId: owner.userId,
    createdAt: now,
  });
  const { msgId: m2 } = await seedMessage(convId, "assistant", {
    content: "Yes, Momo is healthy.",
    authorId: owner.userId,
    provider: "anthropic",
    model: "claude-opus-4-8",
    createdAt: now + 1000,
  });

  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/advisor/conversations/${convId}`,
    { headers: { Cookie: owner.cookie } },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: AdvisorConversationDetail };
  expect(body.data.id).toBe(convId);
  expect(body.data.title).toBe("Detail test");
  expect(body.data.messages).toHaveLength(2);

  // oldest first
  expect(body.data.messages[0]!.id).toBe(m1);
  expect(body.data.messages[0]!.role).toBe("user");
  expect(body.data.messages[0]!.content).toBe("Is Momo eating ok?");
  expect(body.data.messages[0]!.authorName).toBe("Daisy");
  expect(body.data.messages[0]!.provider).toBeNull();
  expect(body.data.messages[0]!.model).toBeNull();

  expect(body.data.messages[1]!.id).toBe(m2);
  expect(body.data.messages[1]!.role).toBe("assistant");
  expect(body.data.messages[1]!.provider).toBe("anthropic");
  expect(body.data.messages[1]!.model).toBe("claude-opus-4-8");
});

it("GET conversation detail: unknown id returns 404", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);

  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/advisor/conversations/nonexistent-id`,
    { headers: { Cookie: owner.cookie } },
  );
  expect(res.status).toBe(404);
});

it("GET conversation detail: id belonging to a different pet returns 404", async () => {
  const owner = await seedUserWithSession();
  const { petId: petA } = await seedPet(owner.userId);
  const { petId: petB } = await seedPet(owner.userId);
  // convo belongs to petB
  const { convId } = await seedConversation(petB, owner.userId);

  // request via petA's URL — should 404 because the conv's petId != petA
  const res = await SELF.fetch(
    `https://app.local/api/pets/${petA}/advisor/conversations/${convId}`,
    { headers: { Cookie: owner.cookie } },
  );
  expect(res.status).toBe(404);
});

// ---------------------------------------------------------------------------
// Group 3: Delete conversation
// ---------------------------------------------------------------------------

it("DELETE conversation: editor → 200, conversation + messages gone, audit row correct", async () => {
  const owner = await seedUserWithSession();
  const editor = await seedUserWithSession({ email: "editor@example.com", displayName: "Ed" });
  const { petId } = await seedPet(owner.userId);
  await withMember(petId, editor.userId, "editor");

  const { convId } = await seedConversation(petId, owner.userId, {
    title: "To be deleted",
  });
  await seedMessage(convId, "user", { content: "secret message content", authorId: owner.userId });
  await seedMessage(convId, "assistant", {
    content: "advisor reply content",
    provider: "anthropic",
    model: "claude-opus-4-8",
  });

  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/advisor/conversations/${convId}`,
    {
      method: "DELETE",
      headers: authHeaders(editor.cookie, editor.csrfToken),
    },
  );
  expect(res.status).toBe(200);
  expect(((await res.json()) as { data: { ok: boolean } }).data.ok).toBe(true);

  // conversation is gone
  const db = drizzle(env.DB);
  const conv = await db
    .select()
    .from(advisorConversations)
    .where(eq(advisorConversations.id, convId))
    .get();
  expect(conv).toBeUndefined();

  // messages cascade-deleted — count is 0
  const msgs = await db
    .select()
    .from(advisorMessages)
    .where(eq(advisorMessages.conversationId, convId))
    .all();
  expect(msgs).toHaveLength(0);

  // audit row assertions
  const audits = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.petId, petId), eq(auditLog.entity, "advisor")))
    .all();
  expect(audits).toHaveLength(1);
  const audit = audits[0]!;
  expect(audit.action).toBe("delete");
  expect(audit.entity).toBe("advisor");
  expect(audit.entityId).toBe(convId);

  // diff must include title
  const diff = audit.diff as Record<string, unknown>;
  expect(diff).toHaveProperty("title", "To be deleted");

  // diff must NOT contain message content
  const diffStr = JSON.stringify(diff);
  expect(diffStr).not.toContain("secret message content");
  expect(diffStr).not.toContain("advisor reply content");
});

it("DELETE conversation: viewer → 403", async () => {
  const owner = await seedUserWithSession();
  const viewer = await seedUserWithSession({ email: "viewer@example.com" });
  const { petId } = await seedPet(owner.userId);
  await withMember(petId, viewer.userId, "viewer");

  const { convId } = await seedConversation(petId, owner.userId);

  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/advisor/conversations/${convId}`,
    {
      method: "DELETE",
      headers: authHeaders(viewer.cookie, viewer.csrfToken),
    },
  );
  expect(res.status).toBe(403);
});

it("DELETE conversation: unknown id → 404", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);

  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/advisor/conversations/does-not-exist`,
    {
      method: "DELETE",
      headers: authHeaders(owner.cookie, owner.csrfToken),
    },
  );
  expect(res.status).toBe(404);
});
