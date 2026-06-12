import type {
  CreateInviteResponse,
  MembersResponse,
  PetInviteResponse,
  PetMemberResponse,
} from "@pawary/shared";
import { createInviteSchema, updateMemberRoleSchema } from "@pawary/shared";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { petInvites, petMembers, users } from "../db/schema";
import { writeAudit } from "../domain/audit";
import type { AppEnv } from "../env";
import { generateToken, sha256Hex } from "../lib/crypto";
import { newId } from "../lib/id";
import { rateLimit } from "../lib/rate-limit";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requirePetRole } from "../middleware/pet-access";
import { requireSession } from "../middleware/session";

export const memberRoutes = new Hono<AppEnv>();

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

memberRoutes.post(
  "/api/pets/:petId/invites",
  requireSession,
  requireCsrf,
  requirePetRole("owner"),
  rateLimit("invite-create", 20, 3_600_000, "user"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createInviteSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const db = drizzle(c.env.DB);
    const petId = c.get("petId");
    const user = c.get("user");
    const token = generateToken();
    const now = Date.now();
    const id = newId();
    await db.insert(petInvites).values({
      id,
      petId,
      role: parsed.data.role,
      tokenHash: await sha256Hex(token),
      createdBy: user.id,
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
    });
    await writeAudit(db, {
      petId,
      userId: user.id,
      action: "create",
      entity: "invite",
      entityId: id,
      diff: { role: parsed.data.role },
    });
    const url = `${new URL(c.req.url).origin}/join/${token}`;
    return c.json(
      { data: { id, url, expiresAt: now + INVITE_TTL_MS } satisfies CreateInviteResponse },
      201,
    );
  },
);

memberRoutes.delete(
  "/api/pets/:petId/invites/:inviteId",
  requireSession,
  requireCsrf,
  requirePetRole("owner"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const petId = c.get("petId");
    const inviteId = c.req.param("inviteId");
    const result = await db
      .delete(petInvites)
      .where(
        and(
          eq(petInvites.id, inviteId),
          eq(petInvites.petId, petId),
          isNull(petInvites.usedAt),
        ),
      )
      .run();
    if (result.meta.changes === 0) return err(c, 404, "not_found", "Not found");
    await writeAudit(db, {
      petId,
      userId: c.get("user").id,
      action: "delete",
      entity: "invite",
      entityId: inviteId,
    });
    return c.json({ data: { ok: true } });
  },
);

memberRoutes.patch(
  "/api/pets/:petId/members/:userId",
  requireSession,
  requireCsrf,
  requirePetRole("owner"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateMemberRoleSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const db = drizzle(c.env.DB);
    const petId = c.get("petId");
    const targetId = c.req.param("userId");
    const target = await db
      .select()
      .from(petMembers)
      .where(and(eq(petMembers.petId, petId), eq(petMembers.userId, targetId)))
      .get();
    if (!target) return err(c, 404, "not_found", "Not found");
    if (target.role === parsed.data.role) return c.json({ data: { ok: true } });
    // last-owner invariant enforced inside the statement — immune to check-then-act races
    const result = await db
      .update(petMembers)
      .set({ role: parsed.data.role })
      .where(
        and(
          eq(petMembers.petId, petId),
          eq(petMembers.userId, targetId),
          sql`(${petMembers.role} != 'owner' OR (SELECT COUNT(*) FROM pet_members WHERE pet_id = ${petId} AND role = 'owner') > 1)`,
        ),
      )
      .run();
    if (result.meta.changes === 0) {
      return err(c, 409, "last_owner", "A pet must keep at least one owner");
    }
    await writeAudit(db, {
      petId,
      userId: c.get("user").id,
      action: "update",
      entity: "member",
      entityId: targetId,
      diff: { before: target.role, after: parsed.data.role },
    });
    return c.json({ data: { ok: true } });
  },
);

memberRoutes.delete(
  "/api/pets/:petId/members/:userId",
  requireSession,
  requireCsrf,
  requirePetRole("viewer"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const petId = c.get("petId");
    const me = c.get("user");
    const targetId = c.req.param("userId");
    const isSelf = targetId === me.id;
    // owners remove anyone; everyone may remove themself (= leave)
    if (!isSelf && c.get("petRole") !== "owner") {
      return err(c, 403, "forbidden", "Insufficient role");
    }
    const target = await db
      .select()
      .from(petMembers)
      .where(and(eq(petMembers.petId, petId), eq(petMembers.userId, targetId)))
      .get();
    if (!target) return err(c, 404, "not_found", "Not found");
    // last-owner invariant enforced inside the statement — immune to check-then-act races
    const result = await db
      .delete(petMembers)
      .where(
        and(
          eq(petMembers.petId, petId),
          eq(petMembers.userId, targetId),
          sql`(${petMembers.role} != 'owner' OR (SELECT COUNT(*) FROM pet_members WHERE pet_id = ${petId} AND role = 'owner') > 1)`,
        ),
      )
      .run();
    if (result.meta.changes === 0) {
      return err(c, 409, "last_owner", "A pet must keep at least one owner");
    }
    await writeAudit(db, {
      petId,
      userId: me.id,
      action: "delete",
      entity: "member",
      entityId: targetId,
      diff: { role: target.role, reason: isSelf ? "left" : "removed" },
    });
    return c.json({ data: { ok: true } });
  },
);
