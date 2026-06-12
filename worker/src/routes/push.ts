import type { PushPublicKeyResponse } from "@pawary/shared";
import { pushSubscribeSchema, pushUnsubscribeSchema } from "@pawary/shared";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { pushSubscriptions } from "../db/schema";
import type { AppEnv } from "../env";
import { newId } from "../lib/id";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requireSession } from "../middleware/session";

export const pushRoutes = new Hono<AppEnv>();

pushRoutes.get("/api/push/public-key", requireSession, (c) => {
  return c.json({ data: { publicKey: c.env.VAPID_PUBLIC_KEY } satisfies PushPublicKeyResponse });
});

pushRoutes.post("/api/push/subscriptions", requireSession, requireCsrf, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = pushSubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const user = c.get("user");
  const db = drizzle(c.env.DB);
  const now = Date.now();
  await db
    .insert(pushSubscriptions)
    .values({
      id: newId(),
      userId: user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.p256dh,
      auth: parsed.data.auth,
      tzOffsetMin: parsed.data.tz,
      lastDigestDay: null,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId: user.id,
        p256dh: parsed.data.p256dh,
        auth: parsed.data.auth,
        tzOffsetMin: parsed.data.tz,
        lastDigestDay: null,
      },
    });
  return c.json({ data: { ok: true } }, 201);
});

pushRoutes.delete("/api/push/subscriptions", requireSession, requireCsrf, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = pushUnsubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const user = c.get("user");
  const db = drizzle(c.env.DB);
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, parsed.data.endpoint),
        eq(pushSubscriptions.userId, user.id),
      ),
    );
  return c.json({ data: { ok: true } });
});
