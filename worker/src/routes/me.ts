import type { MeResponse } from "@pawlog/shared";
import { deleteMeSchema, updateMeSchema } from "@pawlog/shared";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { petMembers, pets, users } from "../db/schema";
import { writeAudit } from "../domain/audit";
import { deletePetWithStorage } from "../domain/pet-deletion";
import type { AppEnv } from "../env";
import { clearSessionCookie } from "../lib/cookies";
import { rateLimit } from "../lib/rate-limit";
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

meRoutes.delete(
  "/",
  requireSession,
  requireCsrf,
  rateLimit("me-delete", 3, 60 * 60 * 1000, "user"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = deleteMeSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const user = c.get("user");
    if (parsed.data.confirmEmail !== user.email) {
      // exact, case-sensitive match required
      return err(c, 400, "confirm_mismatch", "Email confirmation does not match");
    }
    const db = drizzle(c.env.DB);
    const memberships = await db
      .select()
      .from(petMembers)
      .where(eq(petMembers.userId, user.id))
      .all();
    for (const membership of memberships) {
      let soleOwner = false;
      if (membership.role === "owner") {
        const owners = await db
          .select({ userId: petMembers.userId })
          .from(petMembers)
          .where(
            and(
              eq(petMembers.petId, membership.petId),
              eq(petMembers.role, "owner"),
            ),
          )
          .all();
        soleOwner = owners.length === 1;
      }
      if (soleOwner) {
        await deletePetWithStorage(db, c.env.PHOTOS, membership.petId);
      } else {
        // surviving shared pet: record the membership removal BEFORE the
        // user row (and its memberships) cascade away
        await writeAudit(db, {
          petId: membership.petId,
          userId: user.id,
          action: "delete",
          entity: "member",
          entityId: user.id,
          diff: { role: membership.role, reason: "account_deleted" },
        });
      }
    }
    await db.delete(users).where(eq(users.id, user.id)); // cascades sessions + memberships
    clearSessionCookie(c);
    return c.json({ data: { ok: true } });
  },
);
