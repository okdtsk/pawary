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
