import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";
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
