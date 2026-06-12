import { fetchMock, SELF } from "cloudflare:test";
import { afterEach, beforeAll, expect, it } from "vitest";
import { authHeaders, seedUserWithSession } from "./helpers";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

async function configure(auth: { cookie: string; csrfToken: string }) {
  const res = await SELF.fetch("https://app.local/api/me/advisor", {
    method: "PUT",
    headers: authHeaders(auth.cookie, auth.csrfToken),
    body: JSON.stringify({
      provider: "anthropic",
      model: "claude-opus-4-8",
      apiKey: "sk-test",
    }),
  });
  expect(res.status).toBe(200);
}

function runTest(auth: { cookie: string; csrfToken: string }) {
  return SELF.fetch("https://app.local/api/me/advisor/test", {
    method: "POST",
    headers: authHeaders(auth.cookie, auth.csrfToken),
  });
}

it("returns ok when the provider accepts the probe", async () => {
  const auth = await seedUserWithSession();
  await configure(auth);
  fetchMock
    .get("https://api.anthropic.com")
    .intercept({ path: "/v1/messages", method: "POST" })
    .reply(
      200,
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"OK"}}\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
  const res = await runTest(auth);
  expect(res.status).toBe(200);
  expect(((await res.json()) as { data: unknown }).data).toEqual({ ok: true });
});

it("maps provider 401 to 502 provider_auth", async () => {
  const auth = await seedUserWithSession();
  await configure(auth);
  fetchMock
    .get("https://api.anthropic.com")
    .intercept({ path: "/v1/messages", method: "POST" })
    .reply(401, '{"error":{"type":"authentication_error"}}');
  const res = await runTest(auth);
  expect(res.status).toBe(502);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("provider_auth");
});

it("maps provider 404 (unknown model) to 502 provider_model", async () => {
  const auth = await seedUserWithSession();
  await configure(auth);
  fetchMock
    .get("https://api.anthropic.com")
    .intercept({ path: "/v1/messages", method: "POST" })
    .reply(404, '{"error":{"type":"not_found_error"}}');
  const res = await runTest(auth);
  expect(res.status).toBe(502);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("provider_model");
});

it("returns 409 advisor_not_configured without settings", async () => {
  const auth = await seedUserWithSession();
  const res = await runTest(auth);
  expect(res.status).toBe(409);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
    "advisor_not_configured",
  );
});
