import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { rateLimit } from "../src/lib/rate-limit";
import { avoidRateLimitWindowBoundary } from "./helpers";

// Each binding allows exactly its limit per 60s window for a given key.
const BINDINGS = [
  { binding: env.RL_5, limit: 5 },
  { binding: env.RL_10, limit: 10 },
  { binding: env.RL_30, limit: 30 },
];

it(
  "bindings allow up to their limit per window for a key, then block",
  { timeout: 15_000 },
  async () => {
    await avoidRateLimitWindowBoundary();
    for (const { binding, limit } of BINDINGS) {
      const key = `test:${crypto.randomUUID()}`;
      for (let i = 0; i < limit; i++) {
        expect((await binding.limit({ key })).success).toBe(true);
      }
      expect((await binding.limit({ key })).success).toBe(false);
    }
  },
);

it("keys are independent", { timeout: 15_000 }, async () => {
  await avoidRateLimitWindowBoundary();
  const a = `test:${crypto.randomUUID()}`;
  const b = `test:${crypto.randomUUID()}`;
  for (let i = 0; i < 5; i++) await env.RL_5.limit({ key: a });
  expect((await env.RL_5.limit({ key: a })).success).toBe(false);
  expect((await env.RL_5.limit({ key: b })).success).toBe(true);
});

it("unknown prefix throws at middleware construction time", () => {
  expect(() => rateLimit("typo-prefix" as never, 5, 60_000)).toThrow(
    /unknown key prefix/,
  );
});

it("documented limit/window must match the binding table", () => {
  // stale pre-binding numbers (advisor-chat used to be 20/5min)
  expect(() => rateLimit("advisor-chat", 20, 300_000, "user")).toThrow(
    /does not match binding/,
  );
  expect(() => rateLimit("advisor-chat", 5, 60_000, "user")).not.toThrow();
});
