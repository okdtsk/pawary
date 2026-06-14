import { env, fetchMock } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { pushSubscriptions, users } from "../src/db/schema";
import { notifyCareteamNewLog } from "../src/domain/push/careteam-notify";
import { newId } from "../src/lib/id";
import { seedPet, seedUserWithSession, withMember } from "./helpers";

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

async function seedSubscription(userId: string, path: string): Promise<string> {
  const id = newId();
  await db().insert(pushSubscriptions).values({
    id,
    userId,
    endpoint: `${PUSH_ORIGIN}${path}`,
    p256dh: UA_P256DH,
    auth: UA_AUTH,
    tzOffsetMin: 0,
    lastDigestDay: null,
    createdAt: Date.now(),
  });
  return id;
}

describe("notifyCareteamNewLog", () => {
  it("pushes the other opted-in member (consuming the interceptor)", async () => {
    const author = await seedUserWithSession({ email: "a@x.com", displayName: "Alice" });
    const other = await seedUserWithSession({ email: "b@x.com", displayName: "Bob" });
    const { petId } = await seedPet(author.userId, "owner", { name: "Rex" });
    await withMember(petId, other.userId, "editor");
    await seedSubscription(other.userId, "/bob");

    fetchMock.get(PUSH_ORIGIN).intercept({ path: "/bob", method: "POST" }).reply(201, "");
    await notifyCareteamNewLog(env, petId, { createdBy: author.userId, category: "food" });
  });

  it("never notifies the author", async () => {
    const author = await seedUserWithSession({ email: "a2@x.com", displayName: "Alice" });
    const { petId } = await seedPet(author.userId, "owner", { name: "Rex" });
    await seedSubscription(author.userId, "/alice");

    await notifyCareteamNewLog(env, petId, { createdBy: author.userId, category: "food" });
  });

  it("skips members who opted out", async () => {
    const author = await seedUserWithSession({ email: "a3@x.com", displayName: "Alice" });
    const other = await seedUserWithSession({ email: "b3@x.com", displayName: "Bob" });
    const { petId } = await seedPet(author.userId, "owner", { name: "Rex" });
    await withMember(petId, other.userId, "editor");
    await seedSubscription(other.userId, "/bob3");
    await db().update(users).set({ notifyCareteamLogs: false }).where(eq(users.id, other.userId));

    await notifyCareteamNewLog(env, petId, { createdBy: author.userId, category: "food" });
  });

  it("deletes a dead (410) subscription", async () => {
    const author = await seedUserWithSession({ email: "a4@x.com", displayName: "Alice" });
    const other = await seedUserWithSession({ email: "b4@x.com", displayName: "Bob" });
    const { petId } = await seedPet(author.userId, "owner", { name: "Rex" });
    await withMember(petId, other.userId, "editor");
    const subId = await seedSubscription(other.userId, "/bob4");

    fetchMock.get(PUSH_ORIGIN).intercept({ path: "/bob4", method: "POST" }).reply(410, "");
    await notifyCareteamNewLog(env, petId, { createdBy: author.userId, category: "food" });

    const remaining = await db()
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, subId))
      .all();
    expect(remaining.length).toBe(0);
  });
});
