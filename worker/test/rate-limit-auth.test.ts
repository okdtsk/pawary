import { SELF } from "cloudflare:test";
import { afterEach, beforeEach, expect, it } from "vitest";
import { resetRateLimits } from "../src/lib/rate-limit";

beforeEach(() => resetRateLimits());
afterEach(() => resetRateLimits());

it("11th hit on /api/auth/google within a minute is 429", async () => {
  for (let i = 0; i < 10; i++) {
    const res = await SELF.fetch("https://app.local/api/auth/google", {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
  }
  const blocked = await SELF.fetch("https://app.local/api/auth/google", {
    redirect: "manual",
  });
  expect(blocked.status).toBe(429);
  const body = (await blocked.json()) as { error: { code: string } };
  expect(body.error.code).toBe("rate_limited");
});

it("dev-login is rate limited per IP too", async () => {
  for (let i = 0; i < 10; i++) {
    await SELF.fetch("http://localhost/api/auth/dev-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  }
  const blocked = await SELF.fetch("http://localhost/api/auth/dev-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(blocked.status).toBe(429);
});
