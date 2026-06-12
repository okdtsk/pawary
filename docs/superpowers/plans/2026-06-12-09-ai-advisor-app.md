# Pawary Plan 9: AI Advisor — App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The complete UI of the AI Advisor: a settings screen for the BYO key, a per-pet conversation list + streaming chat screen with disclaimer, a Home entry card, full EN/JA i18n — against the worker endpoints shipped in Plan 08.

**Architecture:** A pure SSE parser in `app/src/lib/sse.ts` (unit-tested). `app/src/api/advisor.ts` carries the TanStack Query hooks plus a non-hook streaming sender (`sendAdvisorMessage`) that does its own `fetch` (the global `api()` is JSON-only) with CSRF + offline guard. Two new route screens (`/settings/advisor`, `/advisor`) and a Home card. Worker contract (verify against `worker/src/routes/advisor.ts` / `advisor-settings.ts` if in doubt): settings `GET/PUT/DELETE /api/me/advisor`; conversations under `/api/pets/:petId/advisor/conversations`; POST bodies `{message, tz, locale}`; SSE events `delta` `{"text"}` / `done` `{"conversationId","messageId"}` / `error` `{"code","message"}`; pre-stream failures are plain JSON envelopes (400/404/409 `advisor_not_configured`/429).

**Tech Stack:** No new dependencies. React 19, TanStack Query 5, react-router 7, Tailwind v4 tokens (`cn()` is a plain join — never override component classes; wrap in sized containers).

**Spec:** `docs/superpowers/specs/2026-06-12-ai-advisor-design.md` §5 (+ §2 decisions). Conventions and commit/verification rules as in Plans 1–8 (frontend tasks verify with `npm run typecheck -w app && npm run build -w app`; tasks adding pure logic also run `npm run test -w app`; i18n: `messages.ts` + `en.ts` + `ja.ts` change together; commit per task with the exact message; do NOT push/deploy).

**Locked decisions:** viewer = read-only (no composer, no new-conversation button); editor+ chats; per-screen two-tap destructive confirms; streaming text renders incrementally into the last assistant bubble; after `done` or `error`, invalidate the conversation queries (an `error` after partial text re-syncs to whatever the server persisted); disclaimer banner is always visible in the chat screen; model field pre-fills from `AI_DEFAULT_MODELS` when the provider changes but stays editable; the API key input is `type="password"`, never pre-filled — configured state shows a placeholder hint instead.

---

### Task 1: SSE parser + streaming client + hooks + query keys

**Files:**
- Create: `app/src/lib/sse.ts`, `app/src/api/advisor.ts`
- Modify: `app/src/api/client.ts` (export the csrf token getter), `app/src/api/keys.ts`
- Test: `app/test/sse.test.ts` (new)

- [ ] **Step 1: Failing tests.** Create `app/test/sse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSSEParser } from "../src/lib/sse";

describe("createSSEParser", () => {
  it("parses complete events with explicit event names", () => {
    const parse = createSSEParser();
    expect(parse('event: delta\ndata: {"text":"Hi"}\n\n')).toEqual([
      { event: "delta", data: '{"text":"Hi"}' },
    ]);
  });

  it("buffers events split across chunks at any boundary", () => {
    const parse = createSSEParser();
    expect(parse("event: del")).toEqual([]);
    expect(parse('ta\ndata: {"te')).toEqual([]);
    expect(parse('xt":"Hi"}\n\n')).toEqual([{ event: "delta", data: '{"text":"Hi"}' }]);
  });

  it("parses multiple events in one chunk, in order", () => {
    const parse = createSSEParser();
    expect(
      parse('event: delta\ndata: {"text":"a"}\n\nevent: done\ndata: {"x":1}\n\n'),
    ).toEqual([
      { event: "delta", data: '{"text":"a"}' },
      { event: "done", data: '{"x":1}' },
    ]);
  });

  it("defaults to event 'message', skips comments and empty events", () => {
    const parse = createSSEParser();
    expect(parse(":heartbeat\n\ndata: x\n\nevent: nodata\n\n")).toEqual([
      { event: "message", data: "x" },
    ]);
  });
});
```

- [ ] **Step 2: Verify failure** — `npm run test -w app` fails (module missing).

- [ ] **Step 3: Implement `app/src/lib/sse.ts`:**

```ts
export type SSEEvent = { event: string; data: string };

/** Stateful incremental SSE parser: feed decoded chunks, get completed events. */
export function createSSEParser(): (chunk: string) => SSEEvent[] {
  let buf = "";
  return (chunk: string): SSEEvent[] => {
    buf += chunk;
    const events: SSEEvent[] = [];
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length > 0) events.push({ event, data: dataLines.join("\n") });
    }
    return events;
  };
}
```

- [ ] **Step 4: Export the csrf getter.** In `app/src/api/client.ts`, below `setCsrfToken`, add:

```ts
/** For non-JSON fetch paths (advisor SSE) that must attach the CSRF header themselves. */
export function getCsrfToken(): string | null {
  return csrfToken;
}
```

- [ ] **Step 5: Keys.** In `app/src/api/keys.ts` add to `keys`:

```ts
  advisorSettings: ["advisor-settings"] as const,
  advisorConversations: (petId: string) => ["advisor", petId] as const,
  advisorConversation: (petId: string, id: string) => ["advisor", petId, "one", id] as const,
```

and extend the invalidation comment: `advisor settings mutations → ["advisor-settings"]; advisor send/delete → ["advisor", petId]`.

- [ ] **Step 6: Create `app/src/api/advisor.ts`:**

```ts
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

export function useAdvisorConversation(petId: string, id: string) {
  return useQuery({
    queryKey: keys.advisorConversation(petId, id),
    queryFn: () => api<AdvisorConversationDetail>(`/api/pets/${petId}/advisor/conversations/${id}`),
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
```

- [ ] **Step 7: Verify** — `npm run test -w app` (4 new sse tests + existing green), `npm run typecheck -w app && npm run build -w app`.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/sse.ts app/src/api/advisor.ts app/src/api/client.ts app/src/api/keys.ts app/test/sse.test.ts
git commit -m "feat: advisor api hooks, sse parser, and streaming client

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: i18n strings

**Files:** Modify `app/src/i18n/messages.ts`, `en.ts`, `ja.ts` (all three together).

- [ ] **Step 1: Add an `advisor` section** to the `Messages` type (after `members`):

```ts
  advisor: {
    title: string;
    homeCard: string;
    homeCardHint: string;
    disclaimer: string;
    newConversation: string;
    emptyTitle: string;
    emptyHint: string;
    listEmptyTitle: string;
    listEmptyHint: string;
    setupCta: string;
    inputPlaceholder: string;
    send: string;
    deleteConversation: string;
    deleteConfirm: string;
    viewerNote: string;
    errors: {
      provider_auth: string;
      provider_overloaded: string;
      provider_error: string;
      advisor_not_configured: string;
      rate_limited: string;
      offline: string;
      network: string;
    };
    settings: {
      title: string;
      intro: string;
      provider: string;
      model: string;
      apiKey: string;
      apiKeyHint: string;
      apiKeyConfigured: string;
      saved: string;
      remove: string;
      removeConfirm: string;
    };
  };
```

- [ ] **Step 2: EN catalog** (`en.ts`, same position):

```ts
  advisor: {
    title: "AI Advisor",
    homeCard: "Ask the AI Advisor",
    homeCardHint: "Questions about food, weight, symptoms — answered from the last 30 days of entries.",
    disclaimer: "The AI Advisor is not a veterinarian. For urgent or worsening symptoms, contact a vet.",
    newConversation: "New conversation",
    emptyTitle: "Ask anything about this pet",
    emptyHint: "The advisor sees the last 30 days of entries — try \"How is her appetite trending?\"",
    listEmptyTitle: "No conversations yet",
    listEmptyHint: "Start one — answers are grounded in this pet's recent entries.",
    setupCta: "Set up your AI key",
    inputPlaceholder: "Ask about this pet…",
    send: "Send",
    deleteConversation: "Delete",
    deleteConfirm: "Really delete?",
    viewerNote: "Viewers can read conversations but not send messages.",
    errors: {
      provider_auth: "Your API key was rejected by the provider — check it in Settings.",
      provider_overloaded: "The AI provider is overloaded. Try again in a moment.",
      provider_error: "The AI provider returned an error. Try again.",
      advisor_not_configured: "Set up your AI provider key in Settings first.",
      rate_limited: "Too many messages — wait a moment and try again.",
      offline: "You're offline — the advisor needs a connection.",
      network: "Connection lost. The reply may be incomplete.",
    },
    settings: {
      title: "AI Advisor",
      intro: "Bring your own API key. It's stored encrypted and only used to answer your questions.",
      provider: "Provider",
      model: "Model",
      apiKey: "API key",
      apiKeyHint: "Created in your provider's console; sent only to that provider.",
      apiKeyConfigured: "A key is configured — enter a new one to replace it.",
      saved: "Advisor settings saved!",
      remove: "Remove key",
      removeConfirm: "Really remove?",
    },
  },
```

- [ ] **Step 3: JA catalog** (`ja.ts`, same position):

```ts
  advisor: {
    title: "AIアドバイザー",
    homeCard: "AIアドバイザーに相談",
    homeCardHint: "ごはん・体重・症状の気になることを、直近30日の記録をもとに相談できます。",
    disclaimer: "AIアドバイザーは獣医師ではありません。緊急時や症状が悪化する場合は獣医師に相談してください。",
    newConversation: "新しい相談",
    emptyTitle: "この子のことを何でも聞いてください",
    emptyHint: "直近30日の記録を参考に答えます。例:「最近の食欲はどう？」",
    listEmptyTitle: "まだ相談はありません",
    listEmptyHint: "最近の記録をもとに、AIに相談してみましょう。",
    setupCta: "AIキーを設定する",
    inputPlaceholder: "この子について質問…",
    send: "送信",
    deleteConversation: "削除",
    deleteConfirm: "本当に削除？",
    viewerNote: "閲覧者は相談の閲覧のみ可能です。",
    errors: {
      provider_auth: "APIキーがプロバイダに拒否されました。設定を確認してください。",
      provider_overloaded: "AIプロバイダが混雑しています。少し待って再試行してください。",
      provider_error: "AIプロバイダでエラーが発生しました。再試行してください。",
      advisor_not_configured: "まず設定でAIプロバイダのキーを設定してください。",
      rate_limited: "送信が多すぎます。少し待ってから再試行してください。",
      offline: "オフラインです。アドバイザーには接続が必要です。",
      network: "接続が切れました。返答が途中までの可能性があります。",
    },
    settings: {
      title: "AIアドバイザー",
      intro: "お手持ちのAPIキーを使います。キーは暗号化して保存され、質問への回答のみに使用されます。",
      provider: "プロバイダ",
      model: "モデル",
      apiKey: "APIキー",
      apiKeyHint: "各プロバイダのコンソールで作成したキーです。そのプロバイダにのみ送信されます。",
      apiKeyConfigured: "キーは設定済みです。新しいキーを入力すると置き換えられます。",
      saved: "アドバイザー設定を保存しました！",
      remove: "キーを削除",
      removeConfirm: "本当に削除？",
    },
  },
```

- [ ] **Step 4: Verify** — `npm run typecheck -w app && npm run build -w app`.

- [ ] **Step 5: Commit**

```bash
git add app/src/i18n
git commit -m "feat: advisor i18n strings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Advisor settings screen

**Files:**
- Create: `app/src/routes/settings/AdvisorSettings.tsx`
- Modify: `app/src/routes/settings/SettingsHome.tsx` (add `{ to: "/settings/advisor", label: t.advisor.settings.title }` to the sections array), `app/src/App.tsx` (route `/settings/advisor` inside Shell)

Build `AdvisorSettings` to these requirements (house style: `SettingsPage` wrapper with `backTo="/settings"`, `Card`, `Field`, `Select`, `TextInput`, `Button`, `useToast`, two-tap confirm pattern):

- Loads `useAdvisorSettings()`; spinner while loading.
- Intro paragraph (`t.advisor.settings.intro`).
- Provider `Select` over `AI_PROVIDERS` (labels: "Claude (Anthropic)", "OpenAI", "Gemini (Google)" — provider display names are proper nouns, not localized). On change, set the model field to `AI_DEFAULT_MODELS[provider]` ONLY if the user hasn't manually edited the model (track a `modelTouched` flag).
- Model `TextInput` (`t.advisor.settings.model`), initialized from saved settings or the default for the provider.
- API key `TextInput` with `type="password"`, `autoComplete="off"`, never pre-filled; `Field` hint = `apiKeyConfigured` when settings exist, else `apiKeyHint`.
- Save button: disabled while pending or when the key field is empty AND no settings exist; when settings exist and the key field is empty, PUT is invalid (server requires apiKey) — so disable Save unless the key field is non-empty (changing only provider/model still requires re-entering the key; acceptable v1, hint text covers it). On success: toast `saved`, clear the key field.
- Remove button (two-tap, `variant="ghost"` destructive styling like Leave in MembersSection), only when settings exist; calls `useDeleteAdvisorSettings`.
- All states i18n'd; no raw error messages — failures toast `t.errors.title`.

Verify `npm run typecheck -w app && npm run build -w app`; commit:

```bash
git add app/src/routes/settings/AdvisorSettings.tsx app/src/routes/settings/SettingsHome.tsx app/src/App.tsx
git commit -m "feat: advisor settings screen with byo key entry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Advisor chat screens + Home card

**Files:**
- Create: `app/src/routes/Advisor.tsx` (list + chat in one route file; split a `ChatView` component inside the file if it grows)
- Modify: `app/src/App.tsx` (route `/advisor` inside Shell), `app/src/routes/Home.tsx` (entry card)

Requirements:

**Route/state shape:** `/advisor` uses `useRequiredPet()`. Local state `selected: string | null` (conversation id) switches list ↔ chat view (no nested routing needed). `useAdvisorSettings()` to know configured-state; `useT()`, `useLocaleTag()`, `usePets()` role via `pet.role`.

**List view:** header `t.advisor.title`; disclaimer line under it (`text-xs text-ink-faint`); if settings null AND role ≠ viewer → empty state Card with `setupCta` Button → navigate `/settings/advisor`; else conversation list from `useAdvisorConversations(pet.id)` — rows: title (truncate), `createdByName` + relative/short date (`Intl.DateTimeFormat(locale, {month:"short", day:"numeric"})`), two-tap delete Button per row (editor+ only); `listEmptyTitle/Hint` empty state; `newConversation` Button (editor+ with settings) → `selected = "new"`. Viewer sees `viewerNote` instead of the new button.

**Chat view** (`selected !== null`; `"new"` means no conversation yet): back IconButton → list (and refetch list); messages from `useAdvisorConversation` when an id exists — bubbles: user = right-aligned `bg-clay-100`-style, assistant = left `bg-paper` Card-ish, author name + small date above each group is optional — at minimum `authorName` shown on user bubbles (shared pets!). Disclaimer banner pinned above the composer (always visible). Composer (editor+): Textarea/TextInput + send Button, disabled while streaming; Enter sends (textarea: Cmd/Ctrl+Enter).

**Streaming flow:** on send — optimistically append the user bubble and an empty assistant bubble; call `sendAdvisorMessage(pet.id, selected === "new" ? null : selected, text, locale, handlers)`; `onDelta` appends to the assistant bubble (functional setState); `onDone({conversationId})` → if new, `selected = conversationId`; invalidate `keys.advisorConversations(pet.id)` and `keys.advisorConversation(pet.id, conversationId)`; clear streaming state; `onError(code)` → toast the mapped string from `t.advisor.errors` (fall back to `provider_error` text for unknown codes; `rate_limited` comes from the worker's 429 envelope code) and ALSO invalidate the conversation queries (server may have persisted a partial). Keep the optimistic bubbles until invalidation refetch replaces them (query data is the source of truth after settle; local "pending exchange" state renders only while streaming or until refetch — simplest: keep `pending: {user: string, assistant: string} | null` rendered after the fetched messages, cleared on query refetch success).
**Auto-scroll** to bottom on new content (`ref` + `scrollIntoView` on delta batches via `useEffect` on the assistant text length).

**Home card** (`Home.tsx`): after the `CareCard`, a `Card` Link-style row to `/advisor`: `t.advisor.homeCard` title + `homeCardHint` (one-line, `text-sm text-ink-faint`) + ChevronRightIcon, matching the Home card idioms.

Verify `npm run typecheck -w app && npm run build -w app && npm run test -w app`; commit:

```bash
git add app/src/routes/Advisor.tsx app/src/App.tsx app/src/routes/Home.tsx
git commit -m "feat: advisor chat ui with streaming replies and home entry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Final verification sweep

- [ ] Root `npm run typecheck`; worker tests in shards (`npx vitest run --shard=1/2` / wait for TIME_WAIT < 200 / `--shard=2/2` from `worker/`); `npm run test -w app`; `npm run build`.
- [ ] Spec sweep §5: settings screen items, chat list/detail/streaming/disclaimer/viewer-read-only/empty-states/Home entry, EN/JA — each maps to landed code.
- [ ] `git status` clean. Report. DO NOT push/merge/deploy.
