import type { MeResponse } from "@pawlog/shared";
import { updateMeSchema } from "@pawlog/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { petMembers, pets, users } from "../db/schema";
import type { AppEnv } from "../env";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requireSession } from "../middleware/session";

export const meRoutes = new Hono<AppEnv>();

meRoutes.get("/", requireSession, async (c) => {
  const user = c.get("user");
  const session = c.get("session");
  const db = drizzle(c.env.DB);

  const memberships = await db
    .select({
      id: pets.id,
      name: pets.name,
      species: pets.species,
      avatarR2Key: pets.avatarR2Key,
      role: petMembers.role,
    })
    .from(petMembers)
    .innerJoin(pets, eq(petMembers.petId, pets.id))
    .where(eq(petMembers.userId, user.id))
    .all();

  const data: MeResponse = {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      locale: user.locale,
    },
    pets: memberships,
    csrfToken: session.csrfToken,
  };
  return c.json({ data });
});

meRoutes.patch("/", requireSession, requireCsrf, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateMeSchema.safeParse(body);
  if (!parsed.success) {
    return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  if (Object.keys(parsed.data).length === 0) {
    return err(c, 400, "validation", "No fields to update");
  }
  const user = c.get("user");
  const db = drizzle(c.env.DB);
  await db.update(users).set(parsed.data).where(eq(users.id, user.id));
  const updated = { ...user, ...parsed.data };
  return c.json({
    data: {
      user: {
        id: updated.id,
        email: updated.email,
        displayName: updated.displayName,
        avatarUrl: updated.avatarUrl,
        locale: updated.locale,
      },
    },
  });
});
