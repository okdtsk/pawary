import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { constantTimeEqual } from "../lib/crypto";
import { err } from "../lib/respond";

/** Must run AFTER requireSession (relies on c.get("session")). */
export const requireCsrf = createMiddleware<AppEnv>(async (c, next) => {
  const session = c.get("session");
  const header = c.req.header("X-CSRF-Token");
  if (!header || !constantTimeEqual(header, session.csrfToken)) {
    return err(c, 403, "csrf_invalid", "Invalid or missing CSRF token");
  }
  await next();
});
