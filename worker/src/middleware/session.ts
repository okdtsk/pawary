import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createMiddleware } from "hono/factory";
import { users } from "../db/schema";
import { getValidSession } from "../domain/sessions";
import type { AppEnv } from "../env";
import { getSessionToken } from "../lib/cookies";
import { err } from "../lib/respond";

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = getSessionToken(c);
  if (!token) return err(c, 401, "unauthorized", "Sign in required");

  const db = drizzle(c.env.DB);
  const session = await getValidSession(db, token, Date.now());
  if (!session) return err(c, 401, "unauthorized", "Sign in required");

  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .get();
  if (!user) return err(c, 401, "unauthorized", "Sign in required");

  c.set("session", session);
  c.set("user", user);
  await next();
});
