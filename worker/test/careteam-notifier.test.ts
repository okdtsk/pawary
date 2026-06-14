import { env, fetchMock, runDurableObjectAlarm } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { activities, pushSubscriptions, users } from "../src/db/schema";
import { newId } from "../src/lib/id";
import { seedActivity, seedPet, seedUserWithSession, withMember } from "./helpers";

const UA_P256DH =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const UA_AUTH = "BTBZMqHH6r4Tts7J_aSIgg";
const PUSH_ORIGIN = "https://push.example";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

function db() {
  return drizzle(env.DB);
}

async function seedSubscription(userId: string, path: string): Promise<void> {
  await db().insert(pushSubscriptions).values({
    id: newId(),
    userId,
    endpoint: `${PUSH_ORIGIN}${path}`,
    p256dh: UA_P256DH,
    auth: UA_AUTH,
    tzOffsetMin: 0,
    lastDigestDay: null,
    createdAt: Date.now(),
  });
}

/** Ping the per-pet DO then run its alarm; asserts an alarm was scheduled. */
async function pingAndFire(petId: string): Promise<void> {
  const id = env.CARETEAM_NOTIFIER.idFromName(petId);
  const stub = env.CARETEAM_NOTIFIER.get(id);
  await stub.ping(petId);
  const ran = await runDurableObjectAlarm(stub);
  expect(ran).toBe(true);
}

describe("CareteamNotifier", () => {
  it("pushes the other member when an author adds one activity", async () => {
    const author = await seedUserWithSession({ email: "a@x.com", displayName: "Alice" });
    const other = await seedUserWithSession({ email: "b@x.com", displayName: "Bob" });
    const { petId } = await seedPet(author.userId, "owner", { name: "Rex" });
    await withMember(petId, other.userId, "editor");
    await seedSubscription(other.userId, "/bob");
    await seedActivity(petId, author.userId, { category: "food" });

    fetchMock.get(PUSH_ORIGIN).intercept({ path: "/bob", method: "POST" }).reply(201, "");

    await pingAndFire(petId);
  });

  it("does not push the author about their own activity", async () => {
    const author = await seedUserWithSession({ email: "a2@x.com", displayName: "Alice" });
    const { petId } = await seedPet(author.userId, "owner", { name: "Rex" });
    await seedSubscription(author.userId, "/alice");
    await seedActivity(petId, author.userId, { category: "food" });

    await pingAndFire(petId); // no interceptor → a stray send would throw
  });

  it("skips members who opted out", async () => {
    const author = await seedUserWithSession({ email: "a3@x.com", displayName: "Alice" });
    const other = await seedUserWithSession({ email: "b3@x.com", displayName: "Bob" });
    const { petId } = await seedPet(author.userId, "owner", { name: "Rex" });
    await withMember(petId, other.userId, "editor");
    await seedSubscription(other.userId, "/bob3");
    await db().update(users).set({ notifyCareteamLogs: false }).where(eq(users.id, other.userId));
    await seedActivity(petId, author.userId, { category: "food" });

    await pingAndFire(petId); // no interceptor → no send expected
  });

  it("a second ping within the window does not arm a second alarm", async () => {
    const author = await seedUserWithSession({ email: "a4@x.com", displayName: "Alice" });
    const { petId } = await seedPet(author.userId, "owner", { name: "Rex" });
    const id = env.CARETEAM_NOTIFIER.idFromName(petId);
    const stub = env.CARETEAM_NOTIFIER.get(id);
    await stub.ping(petId);
    await stub.ping(petId);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await runDurableObjectAlarm(stub)).toBe(false);
  });

  it("does not drop a same-millisecond activity across an alarm boundary", async () => {
    const author = await seedUserWithSession({ email: "ms@x.com", displayName: "Alice" });
    const other = await seedUserWithSession({ email: "msb@x.com", displayName: "Bob" });
    const { petId } = await seedPet(author.userId, "owner", { name: "Rex" });
    await withMember(petId, other.userId, "editor");
    await seedSubscription(other.userId, "/bob-ms");

    const t = Date.now();
    await db().insert(activities).values({
      id: "act-aaa", petId, category: "note", occurredAt: t, tzOffsetMin: 0,
      memo: null, details: {}, createdBy: author.userId, createdAt: t, updatedAt: t, deletedAt: null,
    });

    // First alarm notifies about act-aaa, advancing the cursor to (t, "act-aaa").
    fetchMock.get(PUSH_ORIGIN).intercept({ path: "/bob-ms", method: "POST" }).reply(201, "");
    await pingAndFire(petId);

    // A second activity in the SAME millisecond, with a higher id.
    await db().insert(activities).values({
      id: "act-bbb", petId, category: "note", occurredAt: t, tzOffsetMin: 0,
      memo: null, details: {}, createdBy: author.userId, createdAt: t, updatedAt: t, deletedAt: null,
    });

    // Second alarm must still notify about act-bbb (id "act-bbb" > "act-aaa" at equal createdAt).
    fetchMock.get(PUSH_ORIGIN).intercept({ path: "/bob-ms", method: "POST" }).reply(201, "");
    await pingAndFire(petId);
  });

  it("advances the watermark so a re-fired alarm does not re-notify", async () => {
    const author = await seedUserWithSession({ email: "a5@x.com", displayName: "Alice" });
    const other = await seedUserWithSession({ email: "b5@x.com", displayName: "Bob" });
    const { petId } = await seedPet(author.userId, "owner", { name: "Rex" });
    await withMember(petId, other.userId, "editor");
    await seedSubscription(other.userId, "/bob5");
    await seedActivity(petId, author.userId, { category: "food" });

    fetchMock.get(PUSH_ORIGIN).intercept({ path: "/bob5", method: "POST" }).reply(201, "");
    await pingAndFire(petId);

    const id = env.CARETEAM_NOTIFIER.idFromName(petId);
    const stub = env.CARETEAM_NOTIFIER.get(id);
    await stub.ping(petId);
    expect(await runDurableObjectAlarm(stub)).toBe(true); // ran, but no new activity → no sends
  });
});
