import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { petMembers, pets, users } from "../src/db/schema";

it("migrations create the schema; basic insert/select works", async () => {
  const db = drizzle(env.DB);
  const now = Date.now();
  await db.insert(users).values({
    id: "u_test",
    googleSub: "g_test",
    email: "pat@example.com",
    displayName: "Pat",
    createdAt: now,
  });
  await db.insert(pets).values({
    id: "p_test",
    name: "Momo",
    species: "cat",
    createdAt: now,
  });
  await db.insert(petMembers).values({
    petId: "p_test",
    userId: "u_test",
    role: "owner",
    createdAt: now,
  });

  const rows = await db.select().from(petMembers).all();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.role).toBe("owner");
});
