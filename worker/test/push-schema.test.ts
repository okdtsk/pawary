import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { careSchedules, pushSubscriptions } from "../src/db/schema";
import { newId } from "../src/lib/id";
import { seedPet, seedSchedule, seedUserWithSession } from "./helpers";

it("push_subscriptions round-trips through the migration", async () => {
  const { userId } = await seedUserWithSession();
  const db = drizzle(env.DB);
  const now = Date.now();
  const subId = newId();

  await db.insert(pushSubscriptions).values({
    id: subId,
    userId,
    endpoint: "https://push.example.com/v1/sub/abc123",
    p256dh: "BNGHLGFBSaLCJKkxF0F90WH-Owy-Fu-rQAESHwvM1f-3TJdNTk4ptFT8ccSrQ3OBoTumEmsEMY9VHsTVpTkGfhc",
    auth: "QfpxMhtfrV8KQFnl8K5kYTvPk2VyurzuZnq4jDPGKAc",
    tzOffsetMin: 540,
    lastDigestDay: null,
    createdAt: now,
  });

  const row = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.id, subId))
    .get();

  expect(row).toMatchObject({
    id: subId,
    userId,
    endpoint: "https://push.example.com/v1/sub/abc123",
    tzOffsetMin: 540,
    lastDigestDay: null,
  });

  // Update lastDigestDay
  await db
    .update(pushSubscriptions)
    .set({ lastDigestDay: "2026-06-12" })
    .where(eq(pushSubscriptions.id, subId));

  const updated = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.id, subId))
    .get();

  expect(updated?.lastDigestDay).toBe("2026-06-12");
});

it("careSchedules.notifiedDueAt is nullable and updatable", async () => {
  const { userId } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const { scheduleId } = await seedSchedule(petId);
  const db = drizzle(env.DB);

  // Initially null
  const row = await db
    .select()
    .from(careSchedules)
    .where(eq(careSchedules.id, scheduleId))
    .get();

  expect(row?.notifiedDueAt).toBeNull();

  // Update notifiedDueAt to nextDueAt value
  const nextDueAt = row!.nextDueAt;
  await db
    .update(careSchedules)
    .set({ notifiedDueAt: nextDueAt })
    .where(eq(careSchedules.id, scheduleId));

  const updated = await db
    .select()
    .from(careSchedules)
    .where(eq(careSchedules.id, scheduleId))
    .get();

  expect(updated?.notifiedDueAt).toBe(nextDueAt);
});
