import { Hono } from "hono";
import type { Env } from "./env";
import { err } from "./lib/respond";
import { securityHeaders } from "./middleware/headers";

const app = new Hono<{ Bindings: Env }>();

app.use("*", securityHeaders);

app.get("/api/health", (c) => c.json({ data: { status: "ok" } }));

app.notFound((c) => err(c, 404, "not_found", "Not found"));
app.onError((e, c) => {
  console.error("unhandled error", e);
  return err(c, 500, "internal", "Internal server error");
});

export default app;
