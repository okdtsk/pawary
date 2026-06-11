import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import type { Role } from "@pawlog/shared";
import { petMembers, pets, users } from "../src/db/schema";
import { createSession } from "../src/domain/sessions";
import { newId } from "../src/lib/id";

export async function seedUserWithSession(
  overrides: { email?: string; displayName?: string } = {},
): Promise<{
  userId: string;
  cookie: string;
  csrfToken: string;
}> {
  const db = drizzle(env.DB);
  const userId = newId();
  await db.insert(users).values({
    id: userId,
    googleSub: `g_${userId}`,
    email: overrides.email ?? "pat@example.com",
    displayName: overrides.displayName ?? "Pat",
    createdAt: Date.now(),
  });
  const { token, csrfToken } = await createSession(db, userId);
  return { userId, cookie: `session=${token}`, csrfToken };
}

export async function seedPet(
  userId: string,
  role: Role = "owner",
  overrides: { name?: string; species?: "dog" | "cat" | "other" } = {},
): Promise<{ petId: string }> {
  const db = drizzle(env.DB);
  const now = Date.now();
  const petId = newId();
  await db.insert(pets).values({
    id: petId,
    name: overrides.name ?? "Momo",
    species: overrides.species ?? "cat",
    createdAt: now,
  });
  await db.insert(petMembers).values({ petId, userId, role, createdAt: now });
  return { petId };
}

export async function withMember(
  petId: string,
  userId: string,
  role: Role,
): Promise<void> {
  const db = drizzle(env.DB);
  await db
    .insert(petMembers)
    .values({ petId, userId, role, createdAt: Date.now() });
}

export function authHeaders(
  cookie: string,
  csrfToken?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Cookie: cookie,
    "Content-Type": "application/json",
  };
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  return headers;
}
