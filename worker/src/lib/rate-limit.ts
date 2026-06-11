import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { err } from "./respond";

// Fixed-window counter in module scope. LIMITATION: this is per-isolate and
// best-effort — counters reset when the isolate recycles and are not shared
// across colos. Good enough for local dev and for slowing abuse in v1.
// DEPLOY-TIME SWAP: replace checkRateLimit with the Cloudflare rate-limiting
// binding (wrangler `unsafe.bindings` ratelimit) keeping this middleware's
// signature; nothing else changes.
type Bucket = { count: number; windowStart: number };
const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/** Test helper: clears all counters (tests share the worker's module state). */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * keyBy "ip": pre-auth routes (CF-Connecting-IP; "local" in dev/tests).
 * keyBy "user": authed routes — must run AFTER requireSession.
 */
export function rateLimit(
  keyPrefix: string,
  limit: number,
  windowMs: number,
  keyBy: "ip" | "user" = "ip",
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const id =
      keyBy === "user"
        ? c.get("user").id
        : (c.req.header("CF-Connecting-IP") ?? "local");
    if (!checkRateLimit(`${keyPrefix}:${id}`, limit, windowMs)) {
      return err(c, 429, "rate_limited", "Too many requests");
    }
    await next();
  });
}
