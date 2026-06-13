import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import { isProdLike } from "../lib/environment";

export const securityHeaders = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: https://lh3.googleusercontent.com; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    if (isProdLike(c.env)) {
      c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  },
);
