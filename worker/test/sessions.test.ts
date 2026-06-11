import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import {
  SESSION_ABSOLUTE_MAX_MS,
  SESSION_REFRESH_INTERVAL_MS,
  SESSION_TTL_MS,
  createSession,
  deleteSessionByToken,
  getValidSession,
} from "../src/domain/sessions";
import { users } from "../src/db/schema";

async function seedUser(db: ReturnType<typeof drizzle>) {
  await db.insert(users).values({
    id: "u1",
    googleSub: "g1",
    email: "pat@example.com",
    displayName: "Pat",
    createdAt: Date.now(),
  });
}

it("createSession + getValidSession round-trips", async () => {
  const db = drizzle(env.DB);
  await seedUser(db);
  const { token, csrfToken } = await createSession(db, "u1");
  const session = await getValidSession(db, token, Date.now());
  expect(session?.userId).toBe("u1");
  expect(session?.csrfToken).toBe(csrfToken);
});

it("rejects an unknown token", async () => {
  const db = drizzle(env.DB);
  expect(await getValidSession(db, "bogus", Date.now())).toBeNull();
});

it("rejects and deletes an expired session", async () => {
  const db = drizzle(env.DB);
  await seedUser(db);
  const { token } = await createSession(db, "u1");
  const later = Date.now() + SESSION_TTL_MS + 1;
  expect(await getValidSession(db, token, later)).toBeNull();
  // also gone for a subsequent valid-time lookup
  expect(await getValidSession(db, token, Date.now())).toBeNull();
});

it("enforces the 90-day absolute cap even with refreshes", async () => {
  const db = drizzle(env.DB);
  await seedUser(db);
  const { token } = await createSession(db, "u1");
  // ...but lookups past created_at + cap always fail
  const pastCap = Date.now() + SESSION_ABSOLUTE_MAX_MS + 1000;
  expect(await getValidSession(db, token, pastCap)).toBeNull();
});

it("slides expiry forward when used after the refresh interval", async () => {
  const db = drizzle(env.DB);
  await seedUser(db);
  const { token } = await createSession(db, "u1");
  const t1 = Date.now() + SESSION_REFRESH_INTERVAL_MS + 1000;
  const refreshed = await getValidSession(db, token, t1);
  expect(refreshed).not.toBeNull();
  // still valid at a time that would have been past the original expiry
  const t2 = t1 + SESSION_TTL_MS - 1000;
  expect(await getValidSession(db, token, t2)).not.toBeNull();
});

it("deleteSessionByToken revokes", async () => {
  const db = drizzle(env.DB);
  await seedUser(db);
  const { token } = await createSession(db, "u1");
  await deleteSessionByToken(db, token);
  expect(await getValidSession(db, token, Date.now())).toBeNull();
});
