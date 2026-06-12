import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { petInvites } from "../src/db/schema";
import { newId } from "../src/lib/id";
import { seedPet, seedUserWithSession } from "./helpers";

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
