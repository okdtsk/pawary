import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { auditLog } from "../src/db/schema";
import { writeAudit } from "../src/domain/audit";

it("writeAudit inserts a row with a ulid id, timestamp, and json diff", async () => {
  const db = drizzle(env.DB);
  const before = Date.now();
  await writeAudit(db, {
    petId: "p1",
    userId: "u1",
    action: "create",
    entity: "pet",
    entityId: "p1",
    diff: { name: "Momo" },
  });
  const rows = await db.select().from(auditLog).all();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID
  expect(rows[0]?.action).toBe("create");
  expect(rows[0]?.entity).toBe("pet");
  expect(rows[0]?.entityId).toBe("p1");
  expect(rows[0]?.diff).toEqual({ name: "Momo" });
  expect(rows[0]?.createdAt).toBeGreaterThanOrEqual(before);
});

it("diff is optional and stored as null", async () => {
  const db = drizzle(env.DB);
  await writeAudit(db, {
    petId: "p1",
    userId: "u1",
    action: "delete",
    entity: "activity",
    entityId: "a1",
  });
  const rows = await db.select().from(auditLog).all();
  expect(rows[0]?.diff).toBeNull();
});
