import { SELF } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { avoidRateLimitWindowBoundary } from "./helpers";

// Real ratelimit bindings: per-IP counters ("local" in tests) persist across
// tests within this file, but each prefix has its own key so the two tests
// below do not interfere.
beforeEach(() => avoidRateLimitWindowBoundary());

it(
  "11th hit on /api/auth/google within a minute is 429",
  { timeout: 15_000 },
  async () => {
    const headers = { "CF-Connecting-IP": `auth-test-${crypto.randomUUID()}` };
    for (let i = 0; i < 10; i++) {
      const res = await SELF.fetch("https://app.local/api/auth/google", {
        redirect: "manual",
        headers,
      });
      expect(res.status).toBe(302);
    }
    const blocked = await SELF.fetch("https://app.local/api/auth/google", {
      redirect: "manual",
      headers,
    });
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
  },
);

it("dev-login is rate limited per IP too", { timeout: 15_000 }, async () => {
  const headers = { "Content-Type": "application/json", "CF-Connecting-IP": `dev-login-test-${crypto.randomUUID()}` };
  for (let i = 0; i < 10; i++) {
    await SELF.fetch("http://localhost/api/auth/dev-login", {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
  }
  const blocked = await SELF.fetch("http://localhost/api/auth/dev-login", {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  expect(blocked.status).toBe(429);
});
