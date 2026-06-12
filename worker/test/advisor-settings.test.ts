import { env, SELF } from "cloudflare:test";
import type { AdvisorSettingsResponse } from "@pawary/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { userAiSettings } from "../src/db/schema";
import { decryptKey } from "../src/lib/keycrypt";
import { authHeaders, seedUserWithSession } from "./helpers";

const KEK = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

async function putSettings(auth: { cookie: string; csrfToken: string }, body: unknown) {
  return SELF.fetch("https://app.local/api/me/advisor", {
    method: "PUT",
    headers: authHeaders(auth.cookie, auth.csrfToken),
    body: JSON.stringify(body),
  });
}

it("PUT stores an encrypted key; GET never returns it; key is recoverable server-side", async () => {
  const auth = await seedUserWithSession();
  const res = await putSettings(auth, {
    provider: "anthropic",
    model: "claude-opus-4-8",
    apiKey: "sk-ant-test-12345",
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: AdvisorSettingsResponse };
  expect(body.data.settings).toEqual({ provider: "anthropic", model: "claude-opus-4-8" });
  expect(JSON.stringify(body)).not.toContain("sk-ant");

  const get = await SELF.fetch("https://app.local/api/me/advisor", {
    headers: { Cookie: auth.cookie },
  });
  const getBody = (await get.json()) as { data: AdvisorSettingsResponse };
  expect(getBody.data.settings).toEqual({ provider: "anthropic", model: "claude-opus-4-8" });
  expect(JSON.stringify(getBody)).not.toContain("sk-ant");

  const db = drizzle(env.DB);
  const row = await db
    .select()
    .from(userAiSettings)
    .where(eq(userAiSettings.userId, auth.userId))
    .get();
  expect(row!.encryptedKey).not.toContain("sk-ant");
  expect(await decryptKey(row!.encryptedKey, KEK)).toBe("sk-ant-test-12345");
});

it("PUT upserts (provider switch replaces) and validates the body", async () => {
  const auth = await seedUserWithSession();
  await putSettings(auth, { provider: "anthropic", model: "claude-opus-4-8", apiKey: "k1" });
  const res = await putSettings(auth, { provider: "gemini", model: "gemini-2.0-flash", apiKey: "k2" });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: AdvisorSettingsResponse };
  expect(body.data.settings!.provider).toBe("gemini");

  for (const bad of [
    { provider: "grok", model: "x", apiKey: "k" },
    { provider: "openai", model: "", apiKey: "k" },
    { provider: "openai", model: "gpt-4o", apiKey: "" },
    { provider: "openai", model: "gpt-4o", apiKey: "k", extra: true },
  ]) {
    expect((await putSettings(auth, bad)).status).toBe(400);
  }
});

it("GET returns null settings when unconfigured; DELETE removes; auth required", async () => {
  const auth = await seedUserWithSession();
  const empty = await SELF.fetch("https://app.local/api/me/advisor", {
    headers: { Cookie: auth.cookie },
  });
  expect(((await empty.json()) as { data: AdvisorSettingsResponse }).data.settings).toBeNull();

  await putSettings(auth, { provider: "openai", model: "gpt-4o", apiKey: "k" });
  const del = await SELF.fetch("https://app.local/api/me/advisor", {
    method: "DELETE",
    headers: authHeaders(auth.cookie, auth.csrfToken),
  });
  expect(del.status).toBe(200);
  const after = await SELF.fetch("https://app.local/api/me/advisor", {
    headers: { Cookie: auth.cookie },
  });
  expect(((await after.json()) as { data: AdvisorSettingsResponse }).data.settings).toBeNull();

  expect((await SELF.fetch("https://app.local/api/me/advisor")).status).toBe(401);
});
