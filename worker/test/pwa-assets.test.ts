import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

// These tests assert the PWA artifacts ship through the assets binding.
// The SPA fallback answers 200 text/html for unknown paths, so each test
// checks content, not just status.

it("serves the service worker as javascript with no-cache", async () => {
  const res = await SELF.fetch("https://app.local/sw.js");
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type") ?? "").toContain("javascript");
  expect(res.headers.get("Cache-Control")).toContain("no-cache");
});

it("serves the web app manifest with the Pawlog identity", async () => {
  const res = await SELF.fetch("https://app.local/manifest.webmanifest");
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toContain("no-cache");
  const manifest = (await res.json()) as {
    name: string;
    display: string;
    icons: { src: string }[];
  };
  expect(manifest.name).toBe("Pawlog");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
});

it("serves the app icons as png", async () => {
  const res = await SELF.fetch("https://app.local/icons/icon-192.png");
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toContain("image/png");
});
