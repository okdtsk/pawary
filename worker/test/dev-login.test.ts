import {
  createExecutionContext,
  env,
  SELF,
  waitOnExecutionContext,
} from "cloudflare:test";
import { expect, it } from "vitest";
import app from "../src/index";

it("dev-login works on localhost in development", async () => {
  const res = await SELF.fetch("http://localhost/api/auth/dev-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "dev@example.com", name: "Dev" }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .find((v) => v.startsWith("session="));
  expect(cookie).toBeTruthy();

  const me = await SELF.fetch("http://localhost/api/me", {
    headers: { Cookie: cookie!.split(";")[0]! },
  });
  expect(me.status).toBe(200);
});

it("dev-login is 404 on non-localhost hosts even in development", async () => {
  const res = await SELF.fetch("https://app.local/api/auth/dev-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(404);
});

it("dev-login is 404 in production environment", async () => {
  const ctx = createExecutionContext();
  const res = await app.fetch(
    new Request("http://localhost/api/auth/dev-login", { method: "POST" }),
    { ...env, ENVIRONMENT: "production" as const },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(404);
});
