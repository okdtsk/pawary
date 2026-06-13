import type { AiProvider } from "@pawary/shared";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ProviderCall = {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatTurn[];
  /** Per-call output cap; defaults to MAX_TOKENS. The settings test probe uses a tiny value. */
  maxTokens?: number;
};

export type AdvisorErrorCode =
  | "provider_auth"
  | "provider_rate_limited"
  | "provider_overloaded"
  | "provider_model"
  | "provider_error";

export class AdvisorProviderError extends Error {
  constructor(
    public code: AdvisorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AdvisorProviderError";
  }
}

/** Trims an upstream error body to a readable, bounded snippet for surfacing. */
function detailSuffix(body: string | undefined): string {
  const trimmed = body?.trim();
  return trimmed ? `: ${trimmed.slice(0, 600)}` : "";
}

/**
 * Maps an upstream HTTP status to an advisor error. `body` is the provider's
 * raw error payload — the only thing that explains *why* a request failed
 * (e.g. which quota a 429 hit) — so it is appended to the message rather than
 * discarded.
 */
function httpError(status: number, body?: string): AdvisorProviderError {
  const suffix = detailSuffix(body);
  if (status === 401 || status === 403) {
    return new AdvisorProviderError("provider_auth", `The provider rejected the API key${suffix}`);
  }
  if (status === 429) {
    // 429 is a rate-limit / quota exhaustion (Gemini: RESOURCE_EXHAUSTED) —
    // distinct from a genuine server overload, and actionable by the user.
    return new AdvisorProviderError(
      "provider_rate_limited",
      `The provider rate limit or quota was exceeded${suffix}`,
    );
  }
  if (status === 529) {
    return new AdvisorProviderError("provider_overloaded", `The provider is overloaded${suffix}`);
  }
  if (status === 404) {
    // all three providers 404 on an unknown model name
    return new AdvisorProviderError(
      "provider_model",
      `The provider does not recognize the model${suffix}`,
    );
  }
  return new AdvisorProviderError("provider_error", `Provider returned HTTP ${status}${suffix}`);
}

const MAX_TOKENS = 2048;

/** Yields the `data:` payload of each SSE event on the stream. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const rawEvent = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("data:")) yield line.slice(5).trim();
        }
      }
    }
  } finally {
    // a consumer that stops early must also stop the upstream fetch —
    // otherwise the provider keeps streaming (and billing) into a void
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function* streamAnthropic(call: ProviderCall): AsyncGenerator<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": call.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: call.model,
      max_tokens: call.maxTokens ?? MAX_TOKENS,
      stream: true,
      system: call.system,
      messages: call.messages,
    }),
  });
  if (!res.ok) throw httpError(res.status, await res.text().catch(() => undefined));
  if (!res.body) throw httpError(res.status);
  for await (const data of sseData(res.body)) {
    let evt: { type?: string; delta?: { type?: string; text?: string } };
    try {
      evt = JSON.parse(data) as typeof evt;
    } catch {
      continue; // tolerate malformed lines
    }
    if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
      yield evt.delta.text;
    }
  }
}

async function* streamOpenAi(call: ProviderCall): AsyncGenerator<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${call.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: call.model,
      max_completion_tokens: call.maxTokens ?? MAX_TOKENS,
      stream: true,
      messages: [
        { role: "system", content: call.system },
        ...call.messages,
      ],
    }),
  });
  if (!res.ok) throw httpError(res.status, await res.text().catch(() => undefined));
  if (!res.body) throw httpError(res.status);
  for await (const data of sseData(res.body)) {
    if (data === "[DONE]") return;
    let evt: { choices?: Array<{ delta?: { content?: string } }> };
    try {
      evt = JSON.parse(data) as typeof evt;
    } catch {
      continue;
    }
    const text = evt.choices?.[0]?.delta?.content;
    if (text) yield text;
  }
}

async function* streamGemini(call: ProviderCall): AsyncGenerator<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(call.model)}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": call.apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: call.system }] },
      contents: call.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: call.maxTokens ?? MAX_TOKENS },
    }),
  });
  if (!res.ok) throw httpError(res.status, await res.text().catch(() => undefined));
  if (!res.body) throw httpError(res.status);
  let produced = false;
  let finishReason: string | undefined;
  let blockReason: string | undefined;
  for await (const data of sseData(res.body)) {
    let evt: {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      promptFeedback?: { blockReason?: string };
    };
    try {
      evt = JSON.parse(data) as typeof evt;
    } catch {
      continue;
    }
    if (evt.promptFeedback?.blockReason) blockReason = evt.promptFeedback.blockReason;
    const candidate = evt.candidates?.[0];
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    for (const part of candidate?.content?.parts ?? []) {
      if (part.text) {
        produced = true;
        yield part.text;
      }
    }
  }
  // Gemini can finish a stream with zero text — a blocked prompt, a safety
  // stop, or the output-token budget spent before any text (common with
  // "thinking" models). Surface *why* instead of a generic empty reply.
  if (!produced) {
    if (blockReason) {
      throw new AdvisorProviderError(
        "provider_error",
        `Gemini blocked the prompt (blockReason: ${blockReason})`,
      );
    }
    if (finishReason && finishReason !== "STOP") {
      throw new AdvisorProviderError(
        "provider_error",
        `Gemini produced no text (finishReason: ${finishReason})`,
      );
    }
  }
}

export function streamProvider(provider: AiProvider, call: ProviderCall): AsyncGenerator<string> {
  switch (provider) {
    case "anthropic":
      return streamAnthropic(call);
    case "openai":
      return streamOpenAi(call);
    case "gemini":
      return streamGemini(call);
  }
}
