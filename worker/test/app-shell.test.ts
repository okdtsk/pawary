import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("sets security headers on every response", async () => {
  const res = await SELF.fetch("https://app.local/api/health");
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
});

it("returns a json error envelope for unknown api routes", async () => {
  const res = await SELF.fetch("https://app.local/api/nope");
  expect(res.status).toBe(404);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("not_found");
});
