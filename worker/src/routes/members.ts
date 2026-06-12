import type {
  MembersResponse,
  PetInviteResponse,
  PetMemberResponse,
} from "@pawary/shared";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { petInvites, petMembers, users } from "../db/schema";
import type { AppEnv } from "../env";
import { requirePetRole } from "../middleware/pet-access";
import { requireSession } from "../middleware/session";

export const memberRoutes = new Hono<AppEnv>();

memberRoutes.get(
  "/api/pets/:petId/members",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const petId = c.get("petId");
    const me = c.get("user");
    const rows = await db
      .select({
        userId: petMembers.userId,
        role: petMembers.role,
        createdAt: petMembers.createdAt,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(petMembers)
      .innerJoin(users, eq(petMembers.userId, users.id))
      .where(eq(petMembers.petId, petId))
      .orderBy(asc(petMembers.createdAt), asc(petMembers.userId))
      .all();
    const members: PetMemberResponse[] = rows.map((r) => ({
      ...r,
      isMe: r.userId === me.id,
    }));

    let invites: PetInviteResponse[] | null = null;
    if (c.get("petRole") === "owner") {
      invites = await db
        .select({
          id: petInvites.id,
          role: petInvites.role,
          expiresAt: petInvites.expiresAt,
          createdByName: users.displayName,
        })
        .from(petInvites)
        .innerJoin(users, eq(petInvites.createdBy, users.id))
        .where(
          and(
            eq(petInvites.petId, petId),
            isNull(petInvites.usedAt),
            gt(petInvites.expiresAt, Date.now()),
          ),
        )
        .all();
    }
    return c.json({ data: { members, invites } satisfies MembersResponse });
  },
);
