import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function err(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
) {
  return c.json({ error: { code, message } }, status);
}
