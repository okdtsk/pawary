import type {
  AdvisorConversationDetail,
  AdvisorConversationSummary,
  AdvisorSettingsResponse,
  PutAdvisorSettingsInput,
} from "@pawary/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deviceTzOffsetMin } from "../lib/dates";
import { createSSEParser } from "../lib/sse";
import { api, getCsrfToken } from "./client";
import { keys } from "./keys";

export function useAdvisorSettings() {
  return useQuery({
    queryKey: keys.advisorSettings,
    queryFn: () => api<AdvisorSettingsResponse>("/api/me/advisor"),
  });
}

export function useSaveAdvisorSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PutAdvisorSettingsInput) =>
      api<AdvisorSettingsResponse>("/api/me/advisor", {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.advisorSettings }),
  });
}

export function useDeleteAdvisorSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>("/api/me/advisor", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.advisorSettings }),
  });
}

export function useAdvisorConversations(petId: string) {
  return useQuery({
    queryKey: keys.advisorConversations(petId),
    queryFn: () => api<AdvisorConversationSummary[]>(`/api/pets/${petId}/advisor/conversations`),
  });
}

export function useAdvisorConversation(
  petId: string,
  id: string,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: keys.advisorConversation(petId, id),
    queryFn: () => api<AdvisorConversationDetail>(`/api/pets/${petId}/advisor/conversations/${id}`),
    enabled: opts?.enabled,
  });
}

export function useDeleteAdvisorConversation(petId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: true }>(`/api/pets/${petId}/advisor/conversations/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.advisorConversations(petId) }),
  });
}

export type AdvisorStreamHandlers = {
  onDelta: (text: string) => void;
  onDone: (payload: { conversationId: string; messageId: string }) => void;
  onError: (code: string, message: string) => void;
};

/**
 * Sends a chat message and consumes the normalized SSE reply.
 * `conversationId === null` creates a new conversation.
 * Pre-stream failures (4xx JSON) and stream `error` events both arrive via onError.
 */
export async function sendAdvisorMessage(
  petId: string,
  conversationId: string | null,
  message: string,
  locale: "en" | "ja",
  handlers: AdvisorStreamHandlers,
): Promise<void> {
  if (!navigator.onLine) {
    handlers.onError("offline", "");
    return;
  }
  const path =
    conversationId === null
      ? `/api/pets/${petId}/advisor/conversations`
      : `/api/pets/${petId}/advisor/conversations/${conversationId}/messages`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRF-Token"] = csrf;
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify({ message, tz: deviceTzOffsetMin(), locale }),
    });
  } catch {
    handlers.onError("network", "");
    return;
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: { code: string; message: string } }
      | null;
    handlers.onError(body?.error?.code ?? "provider_error", body?.error?.message ?? "");
    return;
  }
  if (!res.body) {
    handlers.onError("provider_error", "");
    return;
  }
  const parse = createSSEParser();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const evt of parse(decoder.decode(value, { stream: true }))) {
        if (evt.event === "delta") {
          const payload = JSON.parse(evt.data) as { text: string };
          handlers.onDelta(payload.text);
        } else if (evt.event === "done") {
          handlers.onDone(JSON.parse(evt.data) as { conversationId: string; messageId: string });
        } else if (evt.event === "error") {
          const payload = JSON.parse(evt.data) as { code: string; message: string };
          handlers.onError(payload.code, payload.message);
        }
      }
    }
  } catch {
    handlers.onError("network", "");
  } finally {
    reader.releaseLock();
  }
}
