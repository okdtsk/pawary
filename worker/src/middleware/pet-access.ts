import type { Role } from "@pawlog/shared";
import { and, eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { createMiddleware } from "hono/factory";
import { petMembers, pets, type Pet } from "../db/schema";
import type { AppEnv } from "../env";
import { err } from "../lib/respond";

const ROLE_ORDER: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

export function roleAtLeast(role: Role, minRole: Role): boolean {
  return ROLE_ORDER[role] >= ROLE_ORDER[minRole];
}

/** One query resolves membership + pet row. Null = no pet OR not a member. */
export async function resolvePetAccess(
  db: DrizzleD1Database,
  petId: string,
  userId: string,
): Promise<{ pet: Pet; role: Role } | null> {
  const row = await db
    .select({ pet: pets, role: petMembers.role })
    .from(petMembers)
    .innerJoin(pets, eq(petMembers.petId, pets.id))
    .where(and(eq(petMembers.petId, petId), eq(petMembers.userId, userId)))
    .get();
  return row ?? null;
}

/**
 * Resolves the session user's role on the `:petId` route param.
 * - Missing pet and non-member are both 404 (anti-probing, spec §5).
 * - Member with insufficient role is 403 `forbidden`.
 * Role order: viewer < editor < owner. Must run AFTER requireSession.
 */
export function requirePetRole(minRole: Role) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const petId = c.req.param("petId");
    if (!petId) return err(c, 404, "not_found", "Not found");
    const db = drizzle(c.env.DB);
    const access = await resolvePetAccess(db, petId, c.get("user").id);
    if (!access) return err(c, 404, "not_found", "Not found");
    if (!roleAtLeast(access.role, minRole)) {
      return err(c, 403, "forbidden", "Insufficient role");
    }
    c.set("pet", access.pet);
    c.set("petId", petId);
    c.set("petRole", access.role);
    await next();
  });
}
