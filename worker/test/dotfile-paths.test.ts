import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const BASE = "https://app.local";

describe("dotfile paths", () => {
  it.each(["/.env", "/.env.production", "/.git/config", "/.git/HEAD", "/app/.env", "/js../.git/config"])(
    "returns 404 instead of the SPA shell for %s",
    async (path) => {
      const res = await SELF.fetch(`${BASE}${path}`);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain('<div id="root">');
    },
  );

  it("still serves the SPA shell for client-side routes", async () => {
    const res = await SELF.fetch(`${BASE}/some/route`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });
});
