import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { sessions, type Session } from "../db/schema";
import { generateToken, sha256Hex } from "../lib/crypto";
import { newId } from "../lib/id";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, sliding
export const SESSION_ABSOLUTE_MAX_MS = 90 * 24 * 60 * 60 * 1000; // hard cap
export const SESSION_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // refresh at most hourly

export async function createSession(
  db: DrizzleD1Database,
  userId: string,
): Promise<{ token: string; csrfToken: string }> {
  const token = generateToken();
  const csrfToken = generateToken();
  const now = Date.now();
  await db.insert(sessions).values({
    id: newId(),
    tokenHash: await sha256Hex(token),
    csrfToken,
    userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    lastSeenAt: now,
  });
  return { token, csrfToken };
}

export async function getValidSession(
  db: DrizzleD1Database,
  token: string,
  now: number,
): Promise<Session | null> {
  const tokenHash = await sha256Hex(token);
  const session = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .get();
  if (!session) return null;

  const expired =
    session.expiresAt < now || now - session.createdAt > SESSION_ABSOLUTE_MAX_MS;
  if (expired) {
    await db.delete(sessions).where(eq(sessions.id, session.id));
    return null;
  }

  if (now - session.lastSeenAt > SESSION_REFRESH_INTERVAL_MS) {
    const expiresAt = Math.min(
      now + SESSION_TTL_MS,
      session.createdAt + SESSION_ABSOLUTE_MAX_MS,
    );
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt })
      .where(eq(sessions.id, session.id));
    session.lastSeenAt = now;
    session.expiresAt = expiresAt;
  }
  return session;
}

export async function deleteSessionByToken(
  db: DrizzleD1Database,
  token: string,
): Promise<void> {
  const tokenHash = await sha256Hex(token);
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}
