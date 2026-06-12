import type { DrizzleD1Database } from "drizzle-orm/d1";
import { auditLog } from "../db/schema";
import { newId } from "../lib/id";

export type AuditEntry = {
  petId: string;
  userId: string;
  action: "create" | "update" | "delete";
  entity: "activity" | "pet" | "schedule" | "preset" | "member" | "invite" | "advisor";
  entityId: string;
  diff?: unknown;
};

/**
 * MUST be called by every mutating pet-scoped handler (project convention —
 * this is how spec §4's "audit on every mutation" is enforced; tests assert
 * the rows). audit_log has no FKs on purpose: rows survive user/pet deletion.
 */
export async function writeAudit(
  db: DrizzleD1Database,
  entry: AuditEntry,
): Promise<void> {
  await db.insert(auditLog).values({
    id: newId(),
    petId: entry.petId,
    userId: entry.userId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    diff: entry.diff ?? null,
    createdAt: Date.now(),
  });
}
