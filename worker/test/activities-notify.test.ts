import { env, fetchMock, SELF } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { pushSubscriptions } from "../src/db/schema";
import { newId } from "../src/lib/id";
import { seedPet, seedUserWithSession, withMember } from "./helpers";

const UA_P256DH =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const UA_AUTH = "BTBZMqHH6r4Tts7J_aSIgg";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

it("creating an activity immediately pushes other careteam members", async () => {
  const author = await seedUserWithSession({ email: "auth@x.com", displayName: "Alice" });
  const other = await seedUserWithSession({ email: "other@x.com", displayName: "Bob" });
  const { petId } = await seedPet(author.userId, "owner", { name: "Rex" });
  await withMember(petId, other.userId, "editor");
  await drizzle(env.DB).insert(pushSubscriptions).values({
    id: newId(),
    userId: other.userId,
    endpoint: "https://push.example/bob-create",
    p256dh: UA_P256DH,
    auth: UA_AUTH,
    tzOffsetMin: 0,
    lastDigestDay: null,
    createdAt: Date.now(),
  });

  // The push fires from the request's waitUntil; register the interceptor
  // BEFORE the POST and poll until it is consumed.
  fetchMock
    .get("https://push.example")
    .intercept({ path: "/bob-create", method: "POST" })
    .reply(201, "");

  const res = await SELF.fetch(`https://app.local/api/pets/${petId}/activities`, {
    method: "POST",
    headers: {
      Cookie: author.cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": author.csrfToken,
    },
    body: JSON.stringify({ category: "note", occurredAt: Date.now(), tzOffsetMin: 0 }),
  });
  expect(res.status).toBe(201);

  await vi.waitFor(() => fetchMock.assertNoPendingInterceptors());
});
