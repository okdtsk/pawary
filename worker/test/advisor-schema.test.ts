import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { advisorConversations, advisorMessages, userAiSettings } from "../src/db/schema";
import { newId } from "../src/lib/id";
import { seedPet, seedUserWithSession } from "./helpers";

it("advisor tables round-trip through the migration", async () => {
  const { userId } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const db = drizzle(env.DB);
  const now = Date.now();

  await db.insert(userAiSettings).values({
    userId,
    provider: "anthropic",
    model: "claude-opus-4-8",
    encryptedKey: "b64data",
    createdAt: now,
    updatedAt: now,
  });
  const settings = await db
    .select()
    .from(userAiSettings)
    .where(eq(userAiSettings.userId, userId))
    .get();
  expect(settings).toMatchObject({ provider: "anthropic", model: "claude-opus-4-8" });

  const convId = newId();
  await db.insert(advisorConversations).values({
    id: convId,
    petId,
    title: "Is my cat eating enough?",
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(advisorMessages).values({
    id: newId(),
    conversationId: convId,
    role: "user",
    content: "Is my cat eating enough?",
    authorId: userId,
    createdAt: now,
  });
  await db.insert(advisorMessages).values({
    id: newId(),
    conversationId: convId,
    role: "assistant",
    content: "Based on the last 30 days...",
    authorId: userId,
    provider: "anthropic",
    model: "claude-opus-4-8",
    createdAt: now + 1,
  });
  const msgs = await db
    .select()
    .from(advisorMessages)
    .where(eq(advisorMessages.conversationId, convId))
    .all();
  expect(msgs).toHaveLength(2);
  expect(msgs.find((m) => m.role === "user")).toMatchObject({ provider: null, model: null });
});
