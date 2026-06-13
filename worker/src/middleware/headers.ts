import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import { isProdLike } from "../lib/environment";

export const securityHeaders = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    // Keep the app out of search indexes while it is private (test phase).
    // Remove this line (and the matching `_headers`, robots.txt, meta tag)
    // to allow indexing when going public.
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: https://lh3.googleusercontent.com; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    if (isProdLike(c.env)) {
      c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  },
);
