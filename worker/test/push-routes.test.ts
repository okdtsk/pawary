import { env, SELF } from "cloudflare:test";
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { pushSubscriptions } from "../src/db/schema";
import { authHeaders, seedUserWithSession } from "./helpers";

// The VAPID public key wired into vitest bindings
const TEST_PUBLIC_KEY =
  "BNGHLGFBSaLCJKkxF0F90WH-Owy-Fu-rQAESHwvM1f-3TJdNTk4ptFT8ccSrQ3OBoTumEmsEMY9VHsTVpTkGfhc";

// A fake push endpoint URL used in subscribe/unsubscribe requests
const ENDPOINT_A = "https://push.example/sub/aaaa";
const ENDPOINT_B = "https://push.example/sub/bbbb";

function subscribeBody(endpoint: string = ENDPOINT_A) {
  return {
    endpoint,
    p256dh: "BGk6G7nXp3QHgkVXsXpVJSgMzRH4wQ8mzPKnCmO3lBk",
    auth: "AbCdEfGhIjKlMnOp",
    tz: 540,
  };
}

async function postSubscribe(
  auth: { cookie: string; csrfToken: string },
  body: unknown,
) {
  return SELF.fetch("https://app.local/api/push/subscriptions", {
    method: "POST",
    headers: authHeaders(auth.cookie, auth.csrfToken),
    body: JSON.stringify(body),
  });
}

async function deleteSubscribe(
  auth: { cookie: string; csrfToken: string },
  body: unknown,
) {
  return SELF.fetch("https://app.local/api/push/subscriptions", {
    method: "DELETE",
    headers: authHeaders(auth.cookie, auth.csrfToken),
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// GET /api/push/public-key
// ---------------------------------------------------------------------------

it("GET /api/push/public-key returns the VAPID test constant", async () => {
  const auth = await seedUserWithSession();
  const res = await SELF.fetch("https://app.local/api/push/public-key", {
    headers: { Cookie: auth.cookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { publicKey: string } };
  expect(body.data.publicKey).toBe(TEST_PUBLIC_KEY);
});

it("GET /api/push/public-key returns 401 without session", async () => {
  const res = await SELF.fetch("https://app.local/api/push/public-key");
  expect(res.status).toBe(401);
});

// ---------------------------------------------------------------------------
// POST /api/push/subscriptions — subscribe
// ---------------------------------------------------------------------------

it("POST subscriptions inserts a row with correct fields", async () => {
  const auth = await seedUserWithSession();
  const res = await postSubscribe(auth, subscribeBody());
  expect(res.status).toBe(201);
  const body = (await res.json()) as { data: { ok: boolean } };
  expect(body.data.ok).toBe(true);

  const db = drizzle(env.DB);
  const row = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, ENDPOINT_A))
    .get();
  expect(row).toBeDefined();
  expect(row!.userId).toBe(auth.userId);
  expect(row!.p256dh).toBe("BGk6G7nXp3QHgkVXsXpVJSgMzRH4wQ8mzPKnCmO3lBk");
  expect(row!.auth).toBe("AbCdEfGhIjKlMnOp");
  expect(row!.tzOffsetMin).toBe(540);
  expect(row!.lastDigestDay).toBeNull();
});

it("POST subscriptions re-subscribing same endpoint from different user reassigns row and resets lastDigestDay", async () => {
  const authA = await seedUserWithSession({ email: "a@example.com" });
  const authB = await seedUserWithSession({ email: "b@example.com" });

  // User A subscribes first
  await postSubscribe(authA, subscribeBody(ENDPOINT_B));

  // Manually set lastDigestDay on the row to confirm it gets reset
  const db = drizzle(env.DB);
  await db
    .update(pushSubscriptions)
    .set({ lastDigestDay: "2026-06-12" })
    .where(eq(pushSubscriptions.endpoint, ENDPOINT_B));

  const beforeRow = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, ENDPOINT_B))
    .get();
  expect(beforeRow!.userId).toBe(authA.userId);
  expect(beforeRow!.lastDigestDay).toBe("2026-06-12");

  // User B re-subscribes the same endpoint
  const res = await postSubscribe(authB, {
    ...subscribeBody(ENDPOINT_B),
    p256dh: "newP256dh_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    auth: "newAuthBBBBBBBBB",
    tz: -300,
  });
  expect(res.status).toBe(201);

  const afterRow = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, ENDPOINT_B))
    .get();
  expect(afterRow!.userId).toBe(authB.userId);
  expect(afterRow!.p256dh).toBe("newP256dh_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
  expect(afterRow!.auth).toBe("newAuthBBBBBBBBB");
  expect(afterRow!.tzOffsetMin).toBe(-300);
  expect(afterRow!.lastDigestDay).toBeNull();
});

it("POST subscriptions returns 401 without session", async () => {
  const res = await SELF.fetch("https://app.local/api/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscribeBody()),
  });
  expect(res.status).toBe(401);
});

// ---------------------------------------------------------------------------
// POST /api/push/subscriptions — validation
// ---------------------------------------------------------------------------

it("POST subscriptions returns 400 on validation errors", async () => {
  const auth = await seedUserWithSession();

  // missing endpoint
  expect((await postSubscribe(auth, { p256dh: "x", auth: "y", tz: 0 })).status).toBe(400);
  // invalid endpoint (not URL)
  expect(
    (await postSubscribe(auth, { endpoint: "not-a-url", p256dh: "x", auth: "y", tz: 0 })).status,
  ).toBe(400);
  // endpoint too long
  expect(
    (
      await postSubscribe(auth, {
        endpoint: "https://push.example/" + "x".repeat(1020),
        p256dh: "x",
        auth: "y",
        tz: 0,
      })
    ).status,
  ).toBe(400);
  // missing p256dh
  expect(
    (await postSubscribe(auth, { endpoint: ENDPOINT_A, auth: "y", tz: 0 })).status,
  ).toBe(400);
  // missing auth
  expect(
    (await postSubscribe(auth, { endpoint: ENDPOINT_A, p256dh: "x", tz: 0 })).status,
  ).toBe(400);
  // missing tz
  expect(
    (await postSubscribe(auth, { endpoint: ENDPOINT_A, p256dh: "x", auth: "y" })).status,
  ).toBe(400);
  // tz out of range
  expect(
    (await postSubscribe(auth, { endpoint: ENDPOINT_A, p256dh: "x", auth: "y", tz: 900 })).status,
  ).toBe(400);
  // extra key (strict mode)
  expect(
    (
      await postSubscribe(auth, {
        endpoint: ENDPOINT_A,
        p256dh: "x",
        auth: "y",
        tz: 0,
        extra: true,
      })
    ).status,
  ).toBe(400);
});

// ---------------------------------------------------------------------------
// DELETE /api/push/subscriptions — unsubscribe
// ---------------------------------------------------------------------------

it("DELETE subscriptions removes own row", async () => {
  const auth = await seedUserWithSession();
  await postSubscribe(auth, subscribeBody());

  const res = await deleteSubscribe(auth, { endpoint: ENDPOINT_A });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { ok: boolean } };
  expect(body.data.ok).toBe(true);

  const db = drizzle(env.DB);
  const row = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, ENDPOINT_A))
    .get();
  expect(row).toBeUndefined();
});

it("DELETE subscriptions does not delete another user's endpoint — row survives", async () => {
  const authA = await seedUserWithSession({ email: "aa@example.com" });
  const authB = await seedUserWithSession({ email: "bb@example.com" });

  // User A subscribes
  const ep = "https://push.example/sub/shared-ep-no-delete";
  await postSubscribe(authA, subscribeBody(ep));

  // User B tries to delete user A's endpoint
  const res = await deleteSubscribe(authB, { endpoint: ep });
  // 200 is returned (idempotent no-op) but row must still exist
  expect(res.status).toBe(200);

  const db = drizzle(env.DB);
  const row = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, ep))
    .get();
  expect(row).toBeDefined();
  expect(row!.userId).toBe(authA.userId);
});

it("DELETE subscriptions returns 401 without session", async () => {
  const res = await SELF.fetch("https://app.local/api/push/subscriptions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: ENDPOINT_A }),
  });
  expect(res.status).toBe(401);
});

// ---------------------------------------------------------------------------
// DELETE /api/push/subscriptions — validation
// ---------------------------------------------------------------------------

it("DELETE subscriptions returns 400 on validation errors", async () => {
  const auth = await seedUserWithSession();

  // missing endpoint
  expect((await deleteSubscribe(auth, {})).status).toBe(400);
  // invalid endpoint (not URL)
  expect((await deleteSubscribe(auth, { endpoint: "not-a-url" })).status).toBe(400);
  // extra key (strict mode)
  expect(
    (await deleteSubscribe(auth, { endpoint: ENDPOINT_A, extra: true })).status,
  ).toBe(400);
});
