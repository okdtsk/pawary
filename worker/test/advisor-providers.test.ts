import { fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  AdvisorProviderError,
  streamProvider,
} from "../src/domain/advisor/providers";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

async function collect(iter: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of iter) out.push(chunk);
  return out;
}

const OPTS = {
  apiKey: "test-key",
  model: "test-model",
  system: "You are a pet advisor.",
  messages: [{ role: "user" as const, content: "Hello" }],
};

describe("anthropic adapter", () => {
  it("yields text deltas from the messages stream", async () => {
    const sse = [
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo!"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join("");
    fetchMock
      .get("https://api.anthropic.com")
      .intercept({ path: "/v1/messages", method: "POST" })
      .reply(200, sse, { headers: { "content-type": "text/event-stream" } });
    expect(await collect(streamProvider("anthropic", OPTS))).toEqual(["Hel", "lo!"]);
  });

  it("maps 401 to provider_auth", async () => {
    fetchMock
      .get("https://api.anthropic.com")
      .intercept({ path: "/v1/messages", method: "POST" })
      .reply(401, '{"error":{"type":"authentication_error"}}');
    const e = await collect(streamProvider("anthropic", OPTS)).catch((x) => x);
    expect(e).toBeInstanceOf(AdvisorProviderError);
    expect((e as AdvisorProviderError).code).toBe("provider_auth");
  });

  it("maps 429 to provider_rate_limited, surfaces the body, and ignores malformed data lines", async () => {
    fetchMock
      .get("https://api.anthropic.com")
      .intercept({ path: "/v1/messages", method: "POST" })
      .reply(429, "rate limited");
    const e = await collect(streamProvider("anthropic", OPTS)).catch((x) => x);
    expect((e as AdvisorProviderError).code).toBe("provider_rate_limited");
    // the upstream body is the only thing that explains *why* — it must survive
    expect((e as AdvisorProviderError).message).toContain("rate limited");

    fetchMock
      .get("https://api.anthropic.com")
      .intercept({ path: "/v1/messages", method: "POST" })
      .reply(
        200,
        'data: not-json\n\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    expect(await collect(streamProvider("anthropic", OPTS))).toEqual(["ok"]);
  });
});

describe("openai adapter", () => {
  it("yields choice deltas and stops at [DONE]", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hi "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"there"}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    fetchMock
      .get("https://api.openai.com")
      .intercept({ path: "/v1/chat/completions", method: "POST" })
      .reply(200, sse, { headers: { "content-type": "text/event-stream" } });
    expect(await collect(streamProvider("openai", OPTS))).toEqual(["Hi ", "there"]);
  });
});

describe("gemini adapter", () => {
  it("yields candidate part text", async () => {
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Né"}],"role":"model"}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"ko!"}],"role":"model"}}]}\n\n',
    ].join("");
    fetchMock
      .get("https://generativelanguage.googleapis.com")
      .intercept({
        path: "/v1beta/models/test-model:streamGenerateContent",
        query: { alt: "sse" },
        method: "POST",
      })
      .reply(200, sse, { headers: { "content-type": "text/event-stream" } });
    expect(await collect(streamProvider("gemini", OPTS))).toEqual(["Né", "ko!"]);
  });

  it("maps a 429 quota error to provider_rate_limited and surfaces Google's reason", async () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message:
          "You exceeded your current quota. Limit: GenerateRequestsPerDayPerProjectPerModel-FreeTier",
      },
    });
    fetchMock
      .get("https://generativelanguage.googleapis.com")
      .intercept({
        path: "/v1beta/models/test-model:streamGenerateContent",
        query: { alt: "sse" },
        method: "POST",
      })
      .reply(429, body);
    const e = await collect(streamProvider("gemini", OPTS)).catch((x) => x);
    expect(e).toBeInstanceOf(AdvisorProviderError);
    expect((e as AdvisorProviderError).code).toBe("provider_rate_limited");
    expect((e as AdvisorProviderError).message).toContain("RESOURCE_EXHAUSTED");
  });
});
