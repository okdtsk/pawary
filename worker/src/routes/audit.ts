import type { AuditEntryView, AuditPageResponse } from "@pawary/shared";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { auditLog, users } from "../db/schema";
import type { AppEnv } from "../env";
import { decodeCursor, encodeCursor } from "../lib/cursor";
import { err } from "../lib/respond";
import { requirePetRole } from "../middleware/pet-access";
import { requireSession } from "../middleware/session";

export const auditRoutes = new Hono<AppEnv>();

const PAGE_SIZE = 50;

/**
 * Derive a human-readable summary string from an audit diff record using a
 * STRICT whitelist of string-valued keys. Objects, arrays, and unknown keys
 * are never serialized — they produce null.
 *
 * Whitelisted keys: title, name, category, role, reason, before, after.
 * Special case: when both `before` and `after` are present and are strings,
 * they render as "before → after" (used for member role changes).
 *
 * @param entity - The entity type string (unused currently; reserved for
 *   future entity-specific rendering without changing the signature).
 * @param diff - The raw diff value stored in the audit_log table.
 */
export function auditSummary(entity: string, diff: unknown): string | null {
  if (diff === null || diff === undefined) return null;
  if (typeof diff !== "object" || Array.isArray(diff)) return null;

  const d = diff as Record<string, unknown>;

  // Member role change: before → after (both must be strings)
  if (typeof d.before === "string" && typeof d.after === "string") {
    return `${d.before} → ${d.after}`;
  }

  // Single whitelisted string-valued keys (checked in priority order)
  for (const key of ["title", "name", "category", "role", "reason", "before", "after"] as const) {
    const val = d[key];
    if (typeof val === "string") {
      return val;
    }
  }

  return null;
}

auditRoutes.get(
  "/api/pets/:petId/audit",
  requireSession,
  requirePetRole("owner"),
  async (c) => {
    const petId = c.get("petId");

    const cursorRaw = c.req.query("cursor");
    let cursor: { o: number; i: string } | undefined;
    if (cursorRaw !== undefined) {
      const decoded = decodeCursor(cursorRaw);
      if (!decoded) return err(c, 400, "validation", "Invalid cursor");
      cursor = decoded;
    }

    const db = drizzle(c.env.DB);

    const conds = [eq(auditLog.petId, petId)];
    if (cursor) {
      conds.push(
        or(
          lt(auditLog.createdAt, cursor.o),
          and(
            eq(auditLog.createdAt, cursor.o),
            lt(auditLog.id, cursor.i),
          ),
        )!,
      );
    }

    const rows = await db
      .select({
        id: auditLog.id,
        userId: auditLog.userId,
        action: auditLog.action,
        entity: auditLog.entity,
        entityId: auditLog.entityId,
        diff: auditLog.diff,
        createdAt: auditLog.createdAt,
        actorName: users.displayName,
      })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.userId, users.id))
      .where(and(...conds))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(PAGE_SIZE + 1) // sentinel row to detect whether more exist
      .all();

    const page = rows.slice(0, PAGE_SIZE);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > PAGE_SIZE && last
        ? encodeCursor(last.createdAt, last.id)
        : null;

    const entries: AuditEntryView[] = page.map((row) => ({
      id: row.id,
      actorName: row.actorName ?? null,
      action: row.action,
      entity: row.entity,
      entityId: row.entityId,
      summary: auditSummary(row.entity, row.diff),
      createdAt: row.createdAt,
    }));

    const data: AuditPageResponse = { entries, cursor: nextCursor };
    return c.json({ data });
  },
);
