import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import type { Category, Role } from "@pawary/shared";
import { activities, careSchedules, petMembers, pets, users } from "../src/db/schema";
import { createSession } from "../src/domain/sessions";
import { newId } from "../src/lib/id";

export async function seedUserWithSession(
  overrides: { email?: string; displayName?: string } = {},
): Promise<{
  userId: string;
  cookie: string;
  csrfToken: string;
}> {
  const db = drizzle(env.DB);
  const userId = newId();
  await db.insert(users).values({
    id: userId,
    googleSub: `g_${userId}`,
    email: overrides.email ?? "pat@example.com",
    displayName: overrides.displayName ?? "Pat",
    createdAt: Date.now(),
  });
  const { token, csrfToken } = await createSession(db, userId);
  return { userId, cookie: `session=${token}`, csrfToken };
}

export async function seedPet(
  userId: string,
  role: Role = "owner",
  overrides: { name?: string; species?: "dog" | "cat" | "other" } = {},
): Promise<{ petId: string }> {
  const db = drizzle(env.DB);
  const now = Date.now();
  const petId = newId();
  await db.insert(pets).values({
    id: petId,
    name: overrides.name ?? "Momo",
    species: overrides.species ?? "cat",
    createdAt: now,
  });
  await db.insert(petMembers).values({ petId, userId, role, createdAt: now });
  return { petId };
}

export async function withMember(
  petId: string,
  userId: string,
  role: Role,
): Promise<void> {
  const db = drizzle(env.DB);
  await db
    .insert(petMembers)
    .values({ petId, userId, role, createdAt: Date.now() });
}

/**
 * The Workers ratelimit binding (and miniflare's local implementation) uses
 * epoch-aligned 60s fixed windows whose counters reset at the boundary.
 * Tests that assert "limit+1th request is 429" would flake when a boundary
 * crosses mid-loop, so wait the boundary out when one is imminent.
 */
export async function avoidRateLimitWindowBoundary(
  marginMs = 5_000,
): Promise<void> {
  const periodMs = 60_000;
  const remainingMs = periodMs - (Date.now() % periodMs);
  if (remainingMs < marginMs) {
    await new Promise((resolve) => setTimeout(resolve, remainingMs + 100));
  }
}

export function authHeaders(
  cookie: string,
  csrfToken?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Cookie: cookie,
    "Content-Type": "application/json",
  };
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  return headers;
}

export async function seedSchedule(
  petId: string,
  overrides: Partial<{
    type: "medication" | "vaccination" | "vet_visit" | "deworming" | "grooming" | "custom";
    name: string;
    categoryLink: Category;
    detailsTemplate: unknown;
    recurrenceUnit: "once" | "hour" | "day" | "week" | "month";
    recurrenceN: number | null;
    nextDueAt: number;
    endAt: number | null;
    active: boolean;
  }> = {},
): Promise<{ scheduleId: string }> {
  const db = drizzle(env.DB);
  const scheduleId = newId();
  await db.insert(careSchedules).values({
    id: scheduleId,
    petId,
    type: overrides.type ?? "medication",
    name: overrides.name ?? "Heart pills",
    categoryLink: overrides.categoryLink ?? "medication",
    detailsTemplate: overrides.detailsTemplate ?? { name: "Heart pills" },
    recurrenceUnit: overrides.recurrenceUnit ?? "day",
    recurrenceN: overrides.recurrenceN === undefined ? 1 : overrides.recurrenceN,
    nextDueAt: overrides.nextDueAt ?? Date.now(),
    endAt: overrides.endAt ?? null,
    active: overrides.active ?? true,
    createdAt: Date.now(),
  });
  return { scheduleId };
}

export async function seedActivity(
  petId: string,
  userId: string,
  overrides: Partial<{
    category: Category;
    occurredAt: number;
    tzOffsetMin: number;
    memo: string | null;
    details: unknown;
    deletedAt: number | null;
  }> = {},
): Promise<{ activityId: string }> {
  const db = drizzle(env.DB);
  const now = Date.now();
  const activityId = newId();
  await db.insert(activities).values({
    id: activityId,
    petId,
    category: overrides.category ?? "note",
    occurredAt: overrides.occurredAt ?? now,
    tzOffsetMin: overrides.tzOffsetMin ?? 0,
    memo: overrides.memo ?? null,
    details: overrides.details ?? {},
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    deletedAt: overrides.deletedAt ?? null,
  });
  return { activityId };
}
