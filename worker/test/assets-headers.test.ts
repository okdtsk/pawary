import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("serves the SPA shell with security headers", async () => {
  const res = await SELF.fetch("https://app.local/");
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('<div id="root">');
  expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
});

it("applies SPA fallback with headers for unknown routes", async () => {
  const res = await SELF.fetch("https://app.local/some/route");
  expect(res.status).toBe(200);
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
});
