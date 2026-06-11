import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { users } from "../src/db/schema";
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
