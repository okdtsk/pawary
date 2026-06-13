import { createMiddleware } from "hono/factory";
import type { AppEnv, Env } from "../env";
import { err } from "./respond";

// Rate limiting is backed by the Workers `ratelimits` binding (GA): fixed
// 60-second windows enforced per-colo by the platform. One binding exists per
// distinct limit value (RL_5/RL_10/RL_30, declared in worker/wrangler.jsonc),
// shared across prefixes — keys are `${prefix}:${id}` so prefixes never
// collide. THIS TABLE GOVERNS the effective limit; the `limit`/`windowMs`
// middleware params are call-site documentation and are asserted against it
// at route-construction time.
const PREFIX_BINDING = {
  "auth-google": "RL_10",
  "auth-callback": "RL_10",
  "auth-dev-login": "RL_10",
  "invite-preview": "RL_30",
  "invite-accept": "RL_10",
  "advisor-test": "RL_5",
  "invite-create": "RL_5", // was 20/h; re-expressed as 5/60s (abuse-slowing intent)
  "advisor-chat": "RL_5", // was 20/5min; re-expressed as 5/60s
  "me-delete": "RL_5", // was 3/h; nearest per-minute binding
  upload: "RL_30", // was 20/60s; nearest binding value
} as const satisfies Record<string, RateLimitBinding>;

type RateLimitBinding = "RL_5" | "RL_10" | "RL_30";
type KnownPrefix = keyof typeof PREFIX_BINDING;

const BINDING_LIMIT: Record<RateLimitBinding, number> = {
  RL_5: 5,
  RL_10: 10,
  RL_30: 30,
};

const WINDOW_MS = 60_000;

/**
 * keyBy "ip": pre-auth routes (CF-Connecting-IP; "local" in dev/tests).
 * keyBy "user": authed routes — must run AFTER requireSession.
 *
 * `limit`/`windowMs` document the effective binding limit at the call site;
 * they must match PREFIX_BINDING or this throws when the route is built.
 */
export function rateLimit(
  keyPrefix: KnownPrefix,
  limit: number,
  windowMs: number,
  keyBy: "ip" | "user" = "ip",
) {
  // Fail fast at middleware-construction (module-load) time: a typo'd prefix
  // or stale documented limit must never silently weaken rate limiting.
  const binding: RateLimitBinding | undefined = PREFIX_BINDING[keyPrefix];
  if (binding === undefined) {
    throw new Error(`rateLimit: unknown key prefix "${keyPrefix as string}"`);
  }
  if (limit !== BINDING_LIMIT[binding] || windowMs !== WINDOW_MS) {
    throw new Error(
      `rateLimit("${keyPrefix}"): documented ${limit}/${windowMs}ms does not ` +
        `match binding ${binding} (${BINDING_LIMIT[binding]}/${WINDOW_MS}ms)`,
    );
  }
  return createMiddleware<AppEnv>(async (c, next) => {
    const id =
      keyBy === "user"
        ? c.get("user").id
        : (c.req.header("CF-Connecting-IP") ?? "local");
    const limiter: Env[RateLimitBinding] = c.env[binding];
    const { success } = await limiter.limit({ key: `${keyPrefix}:${id}` });
    if (!success) {
      return err(c, 429, "rate_limited", "Too many requests");
    }
    await next();
  });
}
