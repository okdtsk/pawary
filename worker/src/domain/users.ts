import type { DrizzleD1Database } from "drizzle-orm/d1";
import { users, type User } from "../db/schema";
import { newId } from "../lib/id";
import type { GoogleClaims } from "../lib/oauth";

export async function upsertUserFromGoogle(
  db: DrizzleD1Database,
  claims: GoogleClaims,
): Promise<User> {
  const row = await db
    .insert(users)
    .values({
      id: newId(),
      googleSub: claims.sub,
      email: claims.email,
      displayName: claims.name,
      avatarUrl: claims.picture,
      createdAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: users.googleSub,
      set: {
        email: claims.email,
        avatarUrl: claims.picture,
      },
    })
    .returning()
    .get();
  return row;
}
