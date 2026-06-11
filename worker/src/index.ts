import { Hono } from "hono";
import type { Env } from "./env";
import { err } from "./lib/respond";
import { securityHeaders } from "./middleware/headers";
import { activityRoutes } from "./routes/activities";
import { authRoutes } from "./routes/auth";
import { meRoutes } from "./routes/me";
import { petRoutes } from "./routes/pets";
import { exportRoutes } from "./routes/export";
import { photoRoutes } from "./routes/photos";
import { presetRoutes } from "./routes/presets";
import { insightRoutes } from "./routes/insights";
import { scheduleRoutes } from "./routes/schedules";

const app = new Hono<{ Bindings: Env }>();

app.use("*", securityHeaders);

app.get("/api/health", (c) => c.json({ data: { status: "ok" } }));
app.route("/api/auth", authRoutes);
app.route("/api/me", meRoutes);
app.route("/", petRoutes);
app.route("/", activityRoutes);
app.route("/", presetRoutes);
app.route("/", photoRoutes);
app.route("/", exportRoutes);
app.route("/", scheduleRoutes);
app.route("/", insightRoutes);

app.notFound((c) => err(c, 404, "not_found", "Not found"));
app.onError((e, c) => {
  console.error("unhandled error", e);
  return err(c, 500, "internal", "Internal server error");
});

export default app;
