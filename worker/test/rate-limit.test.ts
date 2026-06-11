import { beforeEach, expect, it } from "vitest";
import { checkRateLimit, resetRateLimits } from "../src/lib/rate-limit";

beforeEach(() => resetRateLimits());

it("allows up to `limit` hits inside one window, then blocks", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) {
    expect(checkRateLimit("k:a", 5, 60_000, t0 + i)).toBe(true);
  }
  expect(checkRateLimit("k:a", 5, 60_000, t0 + 5)).toBe(false);
});

it("opens a fresh window after windowMs", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) checkRateLimit("k:a", 5, 60_000, t0);
  expect(checkRateLimit("k:a", 5, 60_000, t0 + 59_999)).toBe(false);
  expect(checkRateLimit("k:a", 5, 60_000, t0 + 60_000)).toBe(true);
});

it("keys are independent", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) checkRateLimit("k:a", 5, 60_000, t0);
  expect(checkRateLimit("k:b", 5, 60_000, t0)).toBe(true);
});
