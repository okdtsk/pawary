import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { users } from "../src/db/schema";
import { createSession } from "../src/domain/sessions";
import { newId } from "../src/lib/id";
import app from "../src/index";

async function seedUserWithProductionSession(): Promise<{
  token: string;
  csrfToken: string;
}> {
  const db = drizzle(env.DB);
  const userId = newId();
  await db.insert(users).values({
    id: userId,
    googleSub: `g_${userId}`,
    email: "prod@example.com",
    displayName: "Prod User",
    createdAt: Date.now(),
  });
  const { token, csrfToken } = await createSession(db, userId);
  return { token, csrfToken };
}

it("production logout: clearSessionCookie uses __Host- prefix without throwing", async () => {
  const { token, csrfToken } = await seedUserWithProductionSession();

  const prodEnv = { ...env, ENVIRONMENT: "production" as const, ALLOWED_EMAILS: "prod@example.com" };
  const req = new Request("https://app.example.com/api/auth/logout", {
    method: "POST",
    headers: {
      Cookie: `__Host-session=${token}`,
      "X-CSRF-Token": csrfToken,
    },
  });
  const ctx = createExecutionContext();
  const res = await app.fetch(req, prodEnv, ctx);
  await waitOnExecutionContext(ctx);

  expect(res.status).toBe(200);
  const cleared = res.headers.getSetCookie().find((v) => v.startsWith("__Host-session="));
  expect(cleared).toBeTruthy();       // deletion cookie present
  expect(cleared).toContain("Max-Age=0"); // expired
});
