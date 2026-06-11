import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("GET /api/health returns ok envelope", async () => {
  const res = await SELF.fetch("https://app.local/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ data: { status: "ok" } });
});
