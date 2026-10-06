import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { runPushCron } from "./domain/push/cron";
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
import { memberRoutes } from "./routes/members";
import { scheduleRoutes } from "./routes/schedules";
import { advisorSettingsRoutes } from "./routes/advisor-settings";
import { advisorRoutes } from "./routes/advisor";
import { pushRoutes } from "./routes/push";
import { auditRoutes } from "./routes/audit";
import { auditClassification, recordSecurityAudit, purgeSecurityAudit } from './lib/security-audit';
const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  await next();
  const classification = auditClassification(c.req.path, c.req.method);
  if (classification) await recordSecurityAudit(c.env.DB, {
    actorId: c.get('user')?.id ?? null,
    ...classification, status: c.res.status,
  });
});

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
app.route("/", memberRoutes);
app.route("/", advisorSettingsRoutes);
app.route("/", advisorRoutes);
app.route("/", pushRoutes);
app.route("/", auditRoutes);

app.notFound((c) => err(c, 404, "not_found", "Not found"));
app.onError((_e, c) => {
  console.error({ event: 'unhandled_worker_error' });
  return err(c, 500, "internal", "Internal server error");
});

export default {
  fetch: app.fetch,
  scheduled: (_controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(purgeSecurityAudit(env.DB));
    ctx.waitUntil(runPushCron(env, Date.now()).then((r) => console.log("push cron", r)));
  },
} satisfies ExportedHandler<Env>;
