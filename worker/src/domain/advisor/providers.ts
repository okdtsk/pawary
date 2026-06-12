import type { AiProvider } from "@pawary/shared";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ProviderCall = {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatTurn[];
};

export type AdvisorErrorCode = "provider_auth" | "provider_overloaded" | "provider_error";

export class AdvisorProviderError extends Error {
  constructor(
    public code: AdvisorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AdvisorProviderError";
  }
}

function httpError(status: number): AdvisorProviderError {
  if (status === 401 || status === 403) {
    return new AdvisorProviderError("provider_auth", "The provider rejected the API key");
  }
  if (status === 429 || status === 529) {
    return new AdvisorProviderError("provider_overloaded", "The provider is overloaded");
  }
  return new AdvisorProviderError("provider_error", `Provider returned HTTP ${status}`);
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
      max_tokens: MAX_TOKENS,
      stream: true,
      system: call.system,
      messages: call.messages,
    }),
  });
  if (!res.ok || !res.body) throw httpError(res.status);
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
      max_completion_tokens: MAX_TOKENS,
      stream: true,
      messages: [
        { role: "system", content: call.system },
        ...call.messages,
      ],
    }),
  });
  if (!res.ok || !res.body) throw httpError(res.status);
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
      generationConfig: { maxOutputTokens: MAX_TOKENS },
    }),
  });
  if (!res.ok || !res.body) throw httpError(res.status);
  for await (const data of sseData(res.body)) {
    let evt: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    try {
      evt = JSON.parse(data) as typeof evt;
    } catch {
      continue;
    }
    for (const part of evt.candidates?.[0]?.content?.parts ?? []) {
      if (part.text) yield part.text;
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
