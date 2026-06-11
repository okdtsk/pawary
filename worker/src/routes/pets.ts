import type { PetResponse, PetTargets, Role } from "@pawlog/shared";
import { createPetSchema, petTargetsSchema, updatePetSchema } from "@pawlog/shared";
import { eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { Hono } from "hono";
import { petMembers, pets, petTargets, type Pet } from "../db/schema";
import { writeAudit } from "../domain/audit";
import type { AppEnv } from "../env";
import { newId } from "../lib/id";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requirePetRole } from "../middleware/pet-access";
import { requireSession } from "../middleware/session";

export const petRoutes = new Hono<AppEnv>();

async function getTargets(
  db: DrizzleD1Database,
  petId: string,
): Promise<PetTargets | null> {
  const row = await db
    .select({
      foodGPerDay: petTargets.foodGPerDay,
      waterMlPerDay: petTargets.waterMlPerDay,
    })
    .from(petTargets)
    .where(eq(petTargets.petId, petId))
    .get();
  return row ?? null;
}

function petToResponse(
  pet: Pet,
  role: Role,
  targets: PetTargets | null,
): PetResponse {
  return {
    id: pet.id,
    name: pet.name,
    species: pet.species,
    breed: pet.breed,
    sex: pet.sex,
    birthday: pet.birthday,
    avatarR2Key: pet.avatarR2Key,
    archived: pet.archivedAt !== null,
    createdAt: pet.createdAt,
    role,
    targets,
  };
}

petRoutes.post("/api/pets", requireSession, requireCsrf, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createPetSchema.safeParse(body);
  if (!parsed.success) {
    return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const user = c.get("user");
  const db = drizzle(c.env.DB);
  const now = Date.now();
  const pet: Pet = {
    id: newId(),
    name: parsed.data.name,
    species: parsed.data.species,
    breed: parsed.data.breed ?? null,
    sex: parsed.data.sex ?? null,
    birthday: parsed.data.birthday ?? null,
    avatarR2Key: null,
    archivedAt: null,
    createdAt: now,
  };
  await db.insert(pets).values(pet);
  await db.insert(petMembers).values({
    petId: pet.id,
    userId: user.id,
    role: "owner",
    createdAt: now,
  });
  await writeAudit(db, {
    petId: pet.id,
    userId: user.id,
    action: "create",
    entity: "pet",
    entityId: pet.id,
    diff: parsed.data,
  });
  return c.json({ data: petToResponse(pet, "owner", null) }, 201);
});

petRoutes.get(
  "/api/pets/:petId",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const pet = c.get("pet");
    const db = drizzle(c.env.DB);
    const targets = await getTargets(db, pet.id);
    return c.json({ data: petToResponse(pet, c.get("petRole"), targets) });
  },
);

petRoutes.patch(
  "/api/pets/:petId",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updatePetSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    if (Object.keys(parsed.data).length === 0) {
      return err(c, 400, "validation", "No fields to update");
    }
    const pet = c.get("pet");
    const user = c.get("user");
    const db = drizzle(c.env.DB);
    const { archived, ...fields } = parsed.data;
    const changes: Partial<Pet> = { ...fields };
    if (archived !== undefined) {
      // idempotent: re-archiving keeps the original archivedAt
      changes.archivedAt = archived ? (pet.archivedAt ?? Date.now()) : null;
    }
    await db.update(pets).set(changes).where(eq(pets.id, pet.id));
    const before: Record<string, unknown> = {};
    for (const key of Object.keys(changes) as Array<keyof Pet>) {
      before[key] = pet[key];
    }
    await writeAudit(db, {
      petId: pet.id,
      userId: user.id,
      action: "update",
      entity: "pet",
      entityId: pet.id,
      diff: { before, after: changes },
    });
    const updated: Pet = { ...pet, ...changes };
    const targets = await getTargets(db, pet.id);
    return c.json({ data: petToResponse(updated, c.get("petRole"), targets) });
  },
);

petRoutes.put(
  "/api/pets/:petId/targets",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = petTargetsSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const pet = c.get("pet");
    const db = drizzle(c.env.DB);
    await db
      .insert(petTargets)
      .values({ petId: pet.id, ...parsed.data })
      .onConflictDoUpdate({ target: petTargets.petId, set: parsed.data });
    await writeAudit(db, {
      petId: pet.id,
      userId: c.get("user").id,
      action: "update",
      entity: "pet",
      entityId: pet.id,
      diff: { targets: parsed.data },
    });
    return c.json({ data: parsed.data });
  },
);
