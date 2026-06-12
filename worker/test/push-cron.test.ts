import { env, fetchMock } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { careSchedules, pushSubscriptions, users } from "../src/db/schema";
import {
  buildDigestPayload,
  buildDuePayload,
  runPushCron,
} from "../src/domain/push/cron";
import { newId } from "../src/lib/id";
import { seedPet, seedSchedule, seedUserWithSession, withMember } from "./helpers";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

// Valid user-agent keys (RFC 8291 Appendix A) so sendPush encryption succeeds.
const UA_P256DH =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const UA_AUTH = "BTBZMqHH6r4Tts7J_aSIgg";

const PUSH_ORIGIN = "https://push.example";

// 12:00 UTC — with tz 0 this is far from the [08:00, 08:15) digest window,
// so due-now tests never trigger the digest job.
const NOW = Date.UTC(2026, 5, 12, 12, 0, 0);

function db() {
  return drizzle(env.DB);
}

async function seedSubscription(
  userId: string,
  path: string,
  tzOffsetMin = 0,
  lastDigestDay: string | null = null,
): Promise<string> {
  const id = newId();
  await db().insert(pushSubscriptions).values({
    id,
    userId,
    endpoint: `${PUSH_ORIGIN}${path}`,
    p256dh: UA_P256DH,
    auth: UA_AUTH,
    tzOffsetMin,
    lastDigestDay,
    createdAt: Date.now(),
  });
  return id;
}

async function setLocale(userId: string, locale: "system" | "en" | "ja") {
  await db().update(users).set({ locale }).where(eq(users.id, userId));
}

async function setNotifiedDueAt(scheduleId: string, value: number | null) {
  await db()
    .update(careSchedules)
    .set({ notifiedDueAt: value })
    .where(eq(careSchedules.id, scheduleId));
}

async function getSchedule(scheduleId: string) {
  return db().select().from(careSchedules).where(eq(careSchedules.id, scheduleId)).get();
}

async function getSubscription(subId: string) {
  return db()
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.id, subId))
    .get();
}

function interceptPush(path: string, status = 201) {
  fetchMock.get(PUSH_ORIGIN).intercept({ path, method: "POST" }).reply(status, "");
}

/** Consume an intentionally-unconsumed interceptor so afterEach stays clean. */
async function drain(path: string) {
  await fetch(`${PUSH_ORIGIN}${path}`, { method: "POST" });
}

function pendingPaths(): string[] {
  return fetchMock.pendingInterceptors().map((p) => String(p.path));
}

// ---------------------------------------------------------------------------
// Payload builders (pure)
// ---------------------------------------------------------------------------

describe("buildDuePayload", () => {
  it("builds the EN payload", () => {
    expect(JSON.parse(buildDuePayload("Heart pills", "Momo", "en"))).toEqual({
      title: "Momo",
      body: "Heart pills is due",
      url: "/health",
    });
  });

  it("builds the JA payload", () => {
    expect(JSON.parse(buildDuePayload("Heart pills", "Momo", "ja"))).toEqual({
      title: "Momo",
      body: "Heart pillsの時間です",
      url: "/health",
    });
  });

  it("falls back to EN for system locale", () => {
    const payload = JSON.parse(buildDuePayload("Walk", "Hachi", "system"));
    expect(payload.body).toBe("Walk is due");
  });
});

describe("buildDigestPayload", () => {
  it("builds the EN payload with count and names", () => {
    expect(JSON.parse(buildDigestPayload("Momo", ["Pill A", "Pill B"], "en"))).toEqual({
      title: "Momo",
      body: "2 overdue care item(s): Pill A, Pill B",
      url: "/health",
    });
  });

  it("builds the JA payload with count and names", () => {
    expect(JSON.parse(buildDigestPayload("Momo", ["Pill A", "Pill B"], "ja"))).toEqual({
      title: "Momo",
      body: "未完了のケアが2件: Pill A, Pill B",
      url: "/health",
    });
  });

  it("falls back to EN for system locale", () => {
    const payload = JSON.parse(buildDigestPayload("Momo", ["Pill A"], "system"));
    expect(payload.body).toBe("1 overdue care item(s): Pill A");
  });
});

// ---------------------------------------------------------------------------
// Due-now job
// ---------------------------------------------------------------------------

describe("runPushCron due-now", () => {
  it("sends to every member subscription and sets notifiedDueAt", async () => {
    const owner = await seedUserWithSession({ email: "owner@example.com" });
    const editor = await seedUserWithSession({ email: "editor@example.com" });
    await setLocale(editor.userId, "ja");
    const { petId } = await seedPet(owner.userId, "owner", { name: "Momo" });
    await withMember(petId, editor.userId, "editor");
    const dueAt = NOW - 60_000;
    const { scheduleId } = await seedSchedule(petId, { nextDueAt: dueAt });

    await seedSubscription(owner.userId, "/owner-1");
    await seedSubscription(owner.userId, "/owner-2");
    await seedSubscription(editor.userId, "/editor-1");
    interceptPush("/owner-1");
    interceptPush("/owner-2");
    interceptPush("/editor-1");

    const result = await runPushCron(env, NOW);
    expect(result).toEqual({ dueSent: 3, digestSent: 0, deleted: 0 });

    const schedule = await getSchedule(scheduleId);
    expect(schedule!.notifiedDueAt).toBe(dueAt);
  });

  it("is idempotent: the second run sends nothing", async () => {
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    const dueAt = NOW - 60_000;
    const { scheduleId } = await seedSchedule(petId, { nextDueAt: dueAt });
    await seedSubscription(owner.userId, "/sub-1");

    interceptPush("/sub-1");
    const first = await runPushCron(env, NOW);
    expect(first.dueSent).toBe(1);

    // Register a sentinel interceptor: it must remain unconsumed.
    interceptPush("/sub-1");
    const second = await runPushCron(env, NOW + 15 * 60_000);
    expect(second.dueSent).toBe(0);
    expect(pendingPaths()).toEqual(["/sub-1"]);
    await drain("/sub-1");

    const schedule = await getSchedule(scheduleId);
    expect(schedule!.notifiedDueAt).toBe(dueAt);
  });

  it("re-arms after nextDueAt advances", async () => {
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    const firstDue = NOW - 120_000;
    const { scheduleId } = await seedSchedule(petId, { nextDueAt: firstDue });
    await seedSubscription(owner.userId, "/sub-1");

    interceptPush("/sub-1");
    await runPushCron(env, NOW);

    // Simulate recurrence advance to a new (already elapsed) occurrence.
    const secondDue = NOW - 30_000;
    await db()
      .update(careSchedules)
      .set({ nextDueAt: secondDue })
      .where(eq(careSchedules.id, scheduleId));

    interceptPush("/sub-1");
    const result = await runPushCron(env, NOW);
    expect(result.dueSent).toBe(1);
    const schedule = await getSchedule(scheduleId);
    expect(schedule!.notifiedDueAt).toBe(secondDue);
  });

  it("does not send to non-member users", async () => {
    const owner = await seedUserWithSession({ email: "owner@example.com" });
    const outsider = await seedUserWithSession({ email: "outsider@example.com" });
    const { petId } = await seedPet(owner.userId);
    await seedSchedule(petId, { nextDueAt: NOW - 60_000 });
    await seedSubscription(owner.userId, "/member");
    await seedSubscription(outsider.userId, "/outsider");

    interceptPush("/member");
    interceptPush("/outsider"); // must remain unconsumed

    const result = await runPushCron(env, NOW);
    expect(result.dueSent).toBe(1);
    expect(pendingPaths()).toEqual(["/outsider"]);
    await drain("/outsider");
  });

  it("excludes inactive schedules and future nextDueAt", async () => {
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    const { scheduleId: inactiveId } = await seedSchedule(petId, {
      nextDueAt: NOW - 60_000,
      active: false,
    });
    const { scheduleId: futureId } = await seedSchedule(petId, {
      nextDueAt: NOW + 60_000,
    });
    await seedSubscription(owner.userId, "/sub-1");

    const result = await runPushCron(env, NOW);
    expect(result).toEqual({ dueSent: 0, digestSent: 0, deleted: 0 });
    expect((await getSchedule(inactiveId))!.notifiedDueAt).toBeNull();
    expect((await getSchedule(futureId))!.notifiedDueAt).toBeNull();
  });

  it("deletes the subscription on 410 and still sets notifiedDueAt", async () => {
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    const dueAt = NOW - 60_000;
    const { scheduleId } = await seedSchedule(petId, { nextDueAt: dueAt });
    const goneId = await seedSubscription(owner.userId, "/gone");
    const aliveId = await seedSubscription(owner.userId, "/alive");

    interceptPush("/gone", 410);
    interceptPush("/alive", 201);

    const result = await runPushCron(env, NOW);
    expect(result.dueSent).toBe(1);
    expect(result.deleted).toBe(1);
    expect(await getSubscription(goneId)).toBeUndefined();
    expect(await getSubscription(aliveId)).toBeDefined();
    expect((await getSchedule(scheduleId))!.notifiedDueAt).toBe(dueAt);
  });

  it("deletes the subscription on 404 too", async () => {
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    await seedSchedule(petId, { nextDueAt: NOW - 60_000 });
    const subId = await seedSubscription(owner.userId, "/not-found");

    interceptPush("/not-found", 404);

    const result = await runPushCron(env, NOW);
    expect(result.dueSent).toBe(0);
    expect(result.deleted).toBe(1);
    expect(await getSubscription(subId)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Digest job
// ---------------------------------------------------------------------------

// 2026-06-12T23:05:00Z: tz +540 (JST) → 2026-06-13 08:05 local (IN window);
// tz 0 → 23:05 local (OUT).
const DIGEST_NOW = Date.UTC(2026, 5, 12, 23, 5, 0);

/** Seed an overdue schedule whose due-now push is already deduped, so only
 *  the digest job acts on it. */
async function seedOverdueSchedule(petId: string, name: string, nextDueAt: number) {
  const { scheduleId } = await seedSchedule(petId, { name, nextDueAt });
  await setNotifiedDueAt(scheduleId, nextDueAt);
  return scheduleId;
}

describe("runPushCron digest", () => {
  it("fires only for subscriptions whose local time is in [08:00, 08:15)", async () => {
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId, "owner", { name: "Momo" });
    await seedOverdueSchedule(petId, "Heart pills", DIGEST_NOW - 3_600_000);

    const jstSubId = await seedSubscription(owner.userId, "/digest-jst", 540);
    const utcSubId = await seedSubscription(owner.userId, "/digest-utc", 0);

    interceptPush("/digest-jst");

    const result = await runPushCron(env, DIGEST_NOW);
    expect(result.digestSent).toBe(1);
    expect(result.dueSent).toBe(0);

    expect((await getSubscription(jstSubId))!.lastDigestDay).toBe("2026-06-13");
    expect((await getSubscription(utcSubId))!.lastDigestDay).toBeNull();
  });

  it("treats the window boundaries as half-open: 08:00 in, 07:59 and 08:15 out", async () => {
    const midnightUtc = Date.UTC(2026, 5, 13, 0, 0, 0);
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    await seedOverdueSchedule(petId, "Pill", midnightUtc - 3_600_000);

    const inId = await seedSubscription(owner.userId, "/b-in", 480); // 08:00
    const beforeId = await seedSubscription(owner.userId, "/b-before", 479); // 07:59
    const afterId = await seedSubscription(owner.userId, "/b-after", 495); // 08:15

    interceptPush("/b-in");

    const result = await runPushCron(env, midnightUtc);
    expect(result.digestSent).toBe(1);
    expect((await getSubscription(inId))!.lastDigestDay).toBe("2026-06-13");
    expect((await getSubscription(beforeId))!.lastDigestDay).toBeNull();
    expect((await getSubscription(afterId))!.lastDigestDay).toBeNull();
  });

  it("handles negative tz offsets", async () => {
    // 13:05 UTC, tz -300 (UTC-5) → 08:05 local on 2026-06-12.
    const now = Date.UTC(2026, 5, 12, 13, 5, 0);
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    await seedOverdueSchedule(petId, "Pill", now - 3_600_000);
    const subId = await seedSubscription(owner.userId, "/digest-neg", -300);

    interceptPush("/digest-neg");

    const result = await runPushCron(env, now);
    expect(result.digestSent).toBe(1);
    expect((await getSubscription(subId))!.lastDigestDay).toBe("2026-06-12");
  });

  it("sends only once per local day (lastDigestDay dedup)", async () => {
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    await seedOverdueSchedule(petId, "Pill", DIGEST_NOW - 3_600_000);
    await seedSubscription(owner.userId, "/digest-once", 540);

    interceptPush("/digest-once");
    const first = await runPushCron(env, DIGEST_NOW);
    expect(first.digestSent).toBe(1);

    // Next cron tick, still inside the window (08:05 → 08:15 boundary is at
    // +10min; use +5min → 08:10 local).
    interceptPush("/digest-once"); // sentinel, must remain unconsumed
    const second = await runPushCron(env, DIGEST_NOW + 5 * 60_000);
    expect(second.digestSent).toBe(0);
    expect(pendingPaths()).toEqual(["/digest-once"]);
    await drain("/digest-once");
  });

  it("respects a pre-existing lastDigestDay for today", async () => {
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    await seedOverdueSchedule(petId, "Pill", DIGEST_NOW - 3_600_000);
    await seedSubscription(owner.userId, "/digest-preset", 540, "2026-06-13");

    const result = await runPushCron(env, DIGEST_NOW);
    expect(result.digestSent).toBe(0);
  });

  it("sends one digest per pet and skips pets with no overdue items", async () => {
    const owner = await seedUserWithSession();
    const { petId: pet1 } = await seedPet(owner.userId, "owner", { name: "Momo" });
    const { petId: pet2 } = await seedPet(owner.userId, "owner", { name: "Hachi" });
    const { petId: pet3 } = await seedPet(owner.userId, "owner", { name: "Tama" });
    // pet1: two overdue items → one digest push
    await seedOverdueSchedule(pet1, "Pill A", DIGEST_NOW - 7_200_000);
    await seedOverdueSchedule(pet1, "Pill B", DIGEST_NOW - 3_600_000);
    // pet2: one overdue item → one digest push
    await seedOverdueSchedule(pet2, "Drops", DIGEST_NOW - 3_600_000);
    // pet3: only a future item → no push
    await seedSchedule(pet3, { nextDueAt: DIGEST_NOW + 3_600_000 });

    const subId = await seedSubscription(owner.userId, "/digest-pets", 540);

    fetchMock
      .get(PUSH_ORIGIN)
      .intercept({ path: "/digest-pets", method: "POST" })
      .reply(201, "")
      .times(2);

    const result = await runPushCron(env, DIGEST_NOW);
    expect(result.digestSent).toBe(2);
    expect((await getSubscription(subId))!.lastDigestDay).toBe("2026-06-13");
  });

  it("excludes other users' pets from the digest", async () => {
    const owner = await seedUserWithSession({ email: "owner@example.com" });
    const other = await seedUserWithSession({ email: "other@example.com" });
    const { petId: otherPet } = await seedPet(other.userId);
    await seedOverdueSchedule(otherPet, "Pill", DIGEST_NOW - 3_600_000);

    // owner is in the digest window but is not a member of otherPet
    await seedSubscription(owner.userId, "/digest-foreign", 540);

    const result = await runPushCron(env, DIGEST_NOW);
    expect(result.digestSent).toBe(0);
  });

  it("deletes the subscription when the digest push returns 410", async () => {
    const owner = await seedUserWithSession();
    const { petId } = await seedPet(owner.userId);
    await seedOverdueSchedule(petId, "Pill", DIGEST_NOW - 3_600_000);
    const subId = await seedSubscription(owner.userId, "/digest-gone", 540);

    interceptPush("/digest-gone", 410);

    const result = await runPushCron(env, DIGEST_NOW);
    expect(result.digestSent).toBe(0);
    expect(result.deleted).toBe(1);
    expect(await getSubscription(subId)).toBeUndefined();
  });
});
