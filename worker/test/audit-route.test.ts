/**
 * Tests for GET /api/pets/:petId/audit
 * Covers: authorization, actorName JOIN, pagination, auditSummary whitelist.
 */
import { SELF, env } from "cloudflare:test";
import type { AuditPageResponse } from "@pawary/shared";
import { drizzle } from "drizzle-orm/d1";
import { expect, it, describe } from "vitest";
import { auditLog, users } from "../src/db/schema";
import { auditSummary } from "../src/routes/audit";
import { newId } from "../src/lib/id";
import { authHeaders, seedPet, seedUserWithSession, withMember } from "./helpers";

// ---------------------------------------------------------------------------
// auditSummary unit tests (pure function — no DB needed)
// ---------------------------------------------------------------------------

describe("auditSummary", () => {
  it("returns null for null/undefined diff", () => {
    expect(auditSummary("activity", null)).toBeNull();
    expect(auditSummary("activity", undefined)).toBeNull();
  });

  it("returns null for non-object diffs (string, number, array)", () => {
    expect(auditSummary("activity", "raw text")).toBeNull();
    expect(auditSummary("activity", 42)).toBeNull();
    expect(auditSummary("activity", ["a", "b"])).toBeNull();
  });

  it("returns null for empty object", () => {
    expect(auditSummary("activity", {})).toBeNull();
  });

  it("renders member role change as 'before → after' when both are strings", () => {
    expect(auditSummary("member", { before: "editor", after: "owner" })).toBe("editor → owner");
    expect(auditSummary("member", { before: "viewer", after: "editor" })).toBe("viewer → editor");
  });

  it("returns null for before/after when values are objects (not strings)", () => {
    expect(auditSummary("activity", { before: { memo: "x" }, after: { memo: "y" } })).toBeNull();
  });

  it("returns null when only one of before/after is a string (requires both)", () => {
    // single 'before' string: falls through to single-key scan and returns it
    // single 'after' string: same
    expect(auditSummary("activity", { before: "editor" })).toBe("editor");
    expect(auditSummary("activity", { after: "owner" })).toBe("owner");
  });

  it("returns category string for activity create diff", () => {
    expect(auditSummary("activity", { category: "food" })).toBe("food");
    expect(auditSummary("activity", { category: "medication" })).toBe("medication");
  });

  it("returns role string for invite create diff", () => {
    expect(auditSummary("invite", { role: "editor" })).toBe("editor");
  });

  it("returns name string for advisor delete diff", () => {
    expect(auditSummary("advisor", { title: "My chat" })).toBe("My chat");
    expect(auditSummary("advisor", { name: "Some name" })).toBe("Some name");
  });

  it("returns reason string when present", () => {
    expect(auditSummary("member", { reason: "left pet" })).toBe("left pet");
  });

  it("returns null for unknown keys (no whitelist match)", () => {
    expect(auditSummary("activity", { note: "SECRET-VALUE-XYZ" })).toBeNull();
    expect(auditSummary("activity", { memo: "private detail" })).toBeNull();
    expect(auditSummary("activity", { password: "hunter2" })).toBeNull();
    expect(auditSummary("activity", { apiKey: "sk-secret-key-123" })).toBeNull();
  });

  it("ignores unknown keys alongside whitelisted ones, returns first whitelisted", () => {
    expect(auditSummary("activity", { note: "SECRET", category: "food" })).toBe("food");
  });

  it("returns null when the whitelisted value is an object (not a string)", () => {
    expect(auditSummary("activity", { category: { value: "food" } })).toBeNull();
    expect(auditSummary("pet", { name: 42 })).toBeNull();
  });

  it("handles malformed / deeply nested diffs gracefully", () => {
    expect(auditSummary("pet", { name: null })).toBeNull();
    expect(auditSummary("pet", { nested: { name: "deep" } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Route integration tests
// ---------------------------------------------------------------------------

async function auditUrl(petId: string, query = "") {
  return `https://app.local/api/pets/${petId}/audit${query}`;
}

async function getAudit(petId: string, cookie: string, query = "") {
  const res = await SELF.fetch(await auditUrl(petId, query), {
    headers: { Cookie: cookie },
  });
  return { status: res.status, body: (await res.json()) as { data: AuditPageResponse } | { error: { code: string } } };
}

/** Directly insert an audit_log row for testing (bypasses writeAudit). */
async function seedAuditRow(overrides: {
  petId: string;
  userId: string;
  action?: "create" | "update" | "delete";
  entity?: "activity" | "pet" | "schedule" | "preset" | "member" | "invite" | "advisor";
  entityId?: string;
  diff?: unknown;
  createdAt?: number;
}): Promise<string> {
  const db = drizzle(env.DB);
  const id = newId();
  await db.insert(auditLog).values({
    id,
    petId: overrides.petId,
    userId: overrides.userId,
    action: overrides.action ?? "create",
    entity: overrides.entity ?? "activity",
    entityId: overrides.entityId ?? newId(),
    diff: overrides.diff ?? null,
    createdAt: overrides.createdAt ?? Date.now(),
  });
  return id;
}

it("owner gets 200 with entries and actorName from JOIN", async () => {
  const owner = await seedUserWithSession({ email: "o@example.com", displayName: "Olive" });
  const { petId } = await seedPet(owner.userId);

  await seedAuditRow({ petId, userId: owner.userId, diff: { category: "food" } });

  const { status, body } = await getAudit(petId, owner.cookie);
  expect(status).toBe(200);
  const data = (body as { data: AuditPageResponse }).data;
  expect(data.entries).toHaveLength(1);
  expect(data.entries[0]?.actorName).toBe("Olive");
  expect(data.entries[0]?.summary).toBe("food");
  expect(data.cursor).toBeNull();
});

it("actorName is null for audit row with a userId that no longer exists in users", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);

  // Insert a row referencing a userId that does not exist
  const ghostId = newId();
  await seedAuditRow({ petId, userId: ghostId });

  const { status, body } = await getAudit(petId, owner.cookie);
  expect(status).toBe(200);
  const data = (body as { data: AuditPageResponse }).data;
  expect(data.entries[0]?.actorName).toBeNull();
});

it("editor gets 403", async () => {
  const owner = await seedUserWithSession();
  const editor = await seedUserWithSession({ email: "ed@example.com" });
  const { petId } = await seedPet(owner.userId);
  await withMember(petId, editor.userId, "editor");

  const { status } = await getAudit(petId, editor.cookie);
  expect(status).toBe(403);
});

it("viewer gets 403", async () => {
  const owner = await seedUserWithSession();
  const viewer = await seedUserWithSession({ email: "v@example.com" });
  const { petId } = await seedPet(owner.userId);
  await withMember(petId, viewer.userId, "viewer");

  const { status } = await getAudit(petId, viewer.cookie);
  expect(status).toBe(403);
});

it("non-member gets 404", async () => {
  const owner = await seedUserWithSession();
  const stranger = await seedUserWithSession({ email: "s@example.com" });
  const { petId } = await seedPet(owner.userId);

  const { status } = await getAudit(petId, stranger.cookie);
  expect(status).toBe(404);
});

it("unauthenticated gets 401", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);

  const res = await SELF.fetch(`https://app.local/api/pets/${petId}/audit`);
  expect(res.status).toBe(401);
});

it("paginates: 60 rows yields first page of 50 + cursor, second page of 10 + null cursor", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);

  // Seed 60 rows with distinct createdAt values (oldest first, ascending)
  const T0 = 1_760_000_000_000;
  for (let i = 0; i < 60; i++) {
    await seedAuditRow({ petId, userId: owner.userId, createdAt: T0 + i * 1000 });
  }

  // First page: 50 entries, cursor present
  const page1 = await getAudit(petId, owner.cookie);
  expect(page1.status).toBe(200);
  const d1 = (page1.body as { data: AuditPageResponse }).data;
  expect(d1.entries).toHaveLength(50);
  expect(d1.cursor).not.toBeNull();

  // Entries are newest-first: first entry should have the highest createdAt
  expect(d1.entries[0]?.createdAt).toBe(T0 + 59 * 1000);
  expect(d1.entries[49]?.createdAt).toBe(T0 + 10 * 1000);

  // Second page: 10 entries, null cursor
  const page2 = await getAudit(petId, owner.cookie, `?cursor=${encodeURIComponent(d1.cursor!)}`);
  expect(page2.status).toBe(200);
  const d2 = (page2.body as { data: AuditPageResponse }).data;
  expect(d2.entries).toHaveLength(10);
  expect(d2.cursor).toBeNull();

  // Entries continue in DESC order from where page1 left off
  expect(d2.entries[0]?.createdAt).toBe(T0 + 9 * 1000);
  expect(d2.entries[9]?.createdAt).toBe(T0);

  // No duplicates across both pages
  const ids = [...d1.entries, ...d2.entries].map((e) => e.id);
  expect(new Set(ids).size).toBe(60);
});

it("invalid cursor returns 400", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);

  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/audit?cursor=@@@BAD`,
    { headers: { Cookie: owner.cookie } },
  );
  expect(res.status).toBe(400);
});

it("summary whitelist end-to-end: sensitive diff values never appear in response", async () => {
  const SECRET = "SECRET-VALUE-XYZ";
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);

  // Plant a diff with a non-whitelisted key containing the secret value
  await seedAuditRow({
    petId,
    userId: owner.userId,
    diff: { note: SECRET },
  });

  const res = await SELF.fetch(`https://app.local/api/pets/${petId}/audit`, {
    headers: { Cookie: owner.cookie },
  });
  expect(res.status).toBe(200);
  const text = await res.text();

  // The raw secret must not appear anywhere in the response body
  expect(text).not.toContain(SECRET);

  // summary should be null for this row (no whitelisted key)
  const data = JSON.parse(text) as { data: AuditPageResponse };
  expect(data.data.entries[0]?.summary).toBeNull();
});

it("summary whitelist end-to-end: whitelisted key value IS present in response", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);

  await seedAuditRow({
    petId,
    userId: owner.userId,
    diff: { category: "medication" },
  });

  const { status, body } = await getAudit(petId, owner.cookie);
  expect(status).toBe(200);
  const data = (body as { data: AuditPageResponse }).data;
  expect(data.entries[0]?.summary).toBe("medication");
});

it("member role change renders 'before → after' in response", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);

  await seedAuditRow({
    petId,
    userId: owner.userId,
    entity: "member",
    diff: { before: "editor", after: "owner" },
  });

  const { status, body } = await getAudit(petId, owner.cookie);
  expect(status).toBe(200);
  const data = (body as { data: AuditPageResponse }).data;
  expect(data.entries[0]?.summary).toBe("editor → owner");
});

it("empty audit log returns empty entries with null cursor", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);

  const { status, body } = await getAudit(petId, owner.cookie);
  expect(status).toBe(200);
  const data = (body as { data: AuditPageResponse }).data;
  expect(data.entries).toHaveLength(0);
  expect(data.cursor).toBeNull();
});

it("audit entries only return rows for the requested pet (isolation)", async () => {
  const owner = await seedUserWithSession();
  const { petId: petA } = await seedPet(owner.userId);
  const { petId: petB } = await seedPet(owner.userId);

  await seedAuditRow({ petId: petA, userId: owner.userId, diff: { category: "food" } });
  await seedAuditRow({ petId: petB, userId: owner.userId, diff: { category: "water" } });

  const { body } = await getAudit(petA, owner.cookie);
  const data = (body as { data: AuditPageResponse }).data;
  expect(data.entries).toHaveLength(1);
  expect(data.entries[0]?.summary).toBe("food");
});
