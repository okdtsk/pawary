import { env, SELF } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { sessions } from "../src/db/schema";
import { sha256Hex } from "../src/lib/crypto";
import { SESSION_REFRESH_INTERVAL_MS } from "../src/domain/sessions";
import { seedUserWithSession } from "./helpers";

it("returns 401 without a session cookie", async () => {
  const res = await SELF.fetch("https://app.local/api/me");
  expect(res.status).toBe(401);
});

it("returns 401 for a garbage session cookie", async () => {
  const res = await SELF.fetch("https://app.local/api/me", {
    headers: { Cookie: "session=not-a-real-token" },
  });
  expect(res.status).toBe(401);
});

it("returns the user, empty pets, and a csrf token with a valid session", async () => {
  const { cookie, csrfToken } = await seedUserWithSession();
  const res = await SELF.fetch("https://app.local/api/me", {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    data: { user: { email: string }; pets: unknown[]; csrfToken: string };
  };
  expect(body.data.user.email).toBe("pat@example.com");
  expect(body.data.pets).toEqual([]);
  expect(body.data.csrfToken).toBe(csrfToken);
});

it("PATCH /api/me rejects without csrf header", async () => {
  const { cookie } = await seedUserWithSession();
  const res = await SELF.fetch("https://app.local/api/me", {
    method: "PATCH",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ locale: "ja" }),
  });
  expect(res.status).toBe(403);
});

it("PATCH /api/me updates locale and display name with csrf header", async () => {
  const { cookie, csrfToken } = await seedUserWithSession();
  const res = await SELF.fetch("https://app.local/api/me", {
    method: "PATCH",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ locale: "ja", displayName: "Pat T" }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    data: { user: { locale: string; displayName: string } };
  };
  expect(body.data.user.locale).toBe("ja");
  expect(body.data.user.displayName).toBe("Pat T");
});

it("PATCH /api/me rejects an empty body", async () => {
  const { cookie, csrfToken } = await seedUserWithSession();
  const res = await SELF.fetch("https://app.local/api/me", {
    method: "PATCH",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("validation");
});

it("PATCH /api/me rejects unknown fields", async () => {
  const { cookie, csrfToken } = await seedUserWithSession();
  const res = await SELF.fetch("https://app.local/api/me", {
    method: "PATCH",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ isAdmin: true }),
  });
  expect(res.status).toBe(400);
});

it("GET /api/me re-issues session cookie when sliding refresh triggers", async () => {
  const { cookie } = await seedUserWithSession();
  // Extract the raw token from "session=<token>"
  const token = cookie.split("=")[1]!;

  // Set lastSeenAt to 2h ago so the refresh interval (1h) is exceeded
  const db = drizzle(env.DB);
  const tokenHash = await sha256Hex(token);
  await db
    .update(sessions)
    .set({ lastSeenAt: Date.now() - 2 * 60 * 60 * 1000 })
    .where(eq(sessions.tokenHash, tokenHash));

  const res = await SELF.fetch("https://app.local/api/me", {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);

  // A Set-Cookie with a Max-Age must be present on the response
  const setCookies = res.headers.getSetCookie();
  const sessionSet = setCookies.find((v) => v.startsWith("session="));
  expect(sessionSet).toBeTruthy();
  expect(sessionSet).toMatch(/Max-Age=\d+/);
});

it("GET /api/me does NOT re-issue session cookie when no refresh is due", async () => {
  const { cookie } = await seedUserWithSession();
  // lastSeenAt is just now (set by seedUserWithSession), within the 1h refresh interval

  const res = await SELF.fetch("https://app.local/api/me", {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);

  // No session Set-Cookie should be on this response
  const setCookies = res.headers.getSetCookie();
  const sessionSet = setCookies.find((v) => v.startsWith("session="));
  expect(sessionSet).toBeUndefined();
});

it("GET /api/me returns notifyCareteamLogs defaulting to true", async () => {
  const { cookie } = await seedUserWithSession();
  const res = await SELF.fetch("https://app.local/api/me", {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    data: { user: { notifyCareteamLogs: boolean } };
  };
  expect(body.data.user.notifyCareteamLogs).toBe(true);
});

it("PATCH /api/me toggles notifyCareteamLogs", async () => {
  const { cookie, csrfToken } = await seedUserWithSession();
  const res = await SELF.fetch("https://app.local/api/me", {
    method: "PATCH",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ notifyCareteamLogs: false }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    data: { user: { notifyCareteamLogs: boolean } };
  };
  expect(body.data.user.notifyCareteamLogs).toBe(false);
});
