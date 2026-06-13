import type { Env } from "../env";

/**
 * True for any deployed environment (preview, production) — i.e. served over
 * HTTPS where cookies must be Secure/__Host-prefixed and HSTS applies. False
 * only for local `development`. Use this instead of comparing ENVIRONMENT to a
 * single literal, so preview never silently drops production security.
 */
export function isProdLike(env: Pick<Env, "ENVIRONMENT">): boolean {
  return env.ENVIRONMENT !== "development";
}
