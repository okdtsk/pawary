import type { AdvisorSettingsResponse } from "@pawary/shared";
import { putAdvisorSettingsSchema } from "@pawary/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { userAiSettings } from "../db/schema";
import type { AppEnv } from "../env";
import { encryptKey } from "../lib/keycrypt";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requireSession } from "../middleware/session";

export const advisorSettingsRoutes = new Hono<AppEnv>();

advisorSettingsRoutes.get("/api/me/advisor", requireSession, async (c) => {
  const db = drizzle(c.env.DB);
  const row = await db
    .select({ provider: userAiSettings.provider, model: userAiSettings.model })
    .from(userAiSettings)
    .where(eq(userAiSettings.userId, c.get("user").id))
    .get();
  return c.json({ data: { settings: row ?? null } satisfies AdvisorSettingsResponse });
});

advisorSettingsRoutes.put("/api/me/advisor", requireSession, requireCsrf, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = putAdvisorSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const user = c.get("user");
  const db = drizzle(c.env.DB);
  const now = Date.now();
  const encryptedKey = await encryptKey(parsed.data.apiKey, c.env.ADVISOR_KEK);
  await db
    .insert(userAiSettings)
    .values({
      userId: user.id,
      provider: parsed.data.provider,
      model: parsed.data.model,
      encryptedKey,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userAiSettings.userId,
      set: {
        provider: parsed.data.provider,
        model: parsed.data.model,
        encryptedKey,
        updatedAt: now,
      },
    });
  return c.json({
    data: {
      settings: { provider: parsed.data.provider, model: parsed.data.model },
    } satisfies AdvisorSettingsResponse,
  });
});

advisorSettingsRoutes.delete("/api/me/advisor", requireSession, requireCsrf, async (c) => {
  const db = drizzle(c.env.DB);
  await db.delete(userAiSettings).where(eq(userAiSettings.userId, c.get("user").id));
  return c.json({ data: { ok: true } });
});
