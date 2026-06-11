import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createMiddleware } from "hono/factory";
import { users } from "../db/schema";
import { getValidSession } from "../domain/sessions";
import type { AppEnv } from "../env";
import { getSessionToken, setSessionCookie } from "../lib/cookies";
import { err } from "../lib/respond";

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = getSessionToken(c);
  if (!token) return err(c, 401, "unauthorized", "Sign in required");

  const db = drizzle(c.env.DB);
  const result = await getValidSession(db, token, Date.now());
  if (!result) return err(c, 401, "unauthorized", "Sign in required");

  const { session, refreshed } = result;

  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .get();
  if (!user) return err(c, 401, "unauthorized", "Sign in required");

  c.set("session", session);
  c.set("user", user);
  await next();

  if (refreshed) {
    setSessionCookie(c, token, Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)));
  }
});
