import type { AdvisorConversationSummary, AdvisorMessageView } from "@pawary/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  sendAdvisorMessage,
  useAdvisorConversation,
  useAdvisorConversations,
  useAdvisorSettings,
  useDeleteAdvisorConversation,
} from "../api/advisor";
import { keys } from "../api/keys";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { IconButton } from "../components/IconButton";
import { Textarea } from "../components/form";
import { ArrowLeftIcon } from "../components/icons";
import { Spinner } from "../components/Spinner";
import { useToast } from "../components/Toast";
import { useLocaleTag, useT } from "../i18n";
import { relativeDayKind, dayKeyOf, todayKey, deviceTzOffsetMin } from "../lib/dates";
import { useRequiredPet } from "../state/pets";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortDate(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(new Date(ms));
}

function advisorErrorText(code: string, t: ReturnType<typeof useT>): string {
  const map = t.advisor.errors as Record<string, string | undefined>;
  return map[code] ?? t.advisor.errors.fallback;
}

// ─── DisclaimerBanner ─────────────────────────────────────────────────────────

function DisclaimerBanner() {
  const t = useT();
  return (
    <div className="rounded-2xl bg-clay-50 px-4 py-2.5 text-xs text-ink-soft">
      {t.advisor.disclaimer}
    </div>
  );
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

type BubbleMsg = {
  role: "user" | "assistant";
  content: string;
  authorName?: string | null;
};

function MessageBubble({
  msg,
  isOptimistic,
}: {
  msg: AdvisorMessageView | BubbleMsg;
  isOptimistic?: boolean;
}) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`flex max-w-[85%] flex-col gap-0.5 ${isUser ? "items-end" : "items-start"}`}
      >
        {isUser && msg.authorName && (
          <span className="px-1 text-xs text-ink-faint">{msg.authorName}</span>
        )}
        <div
          className={[
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser ? "bg-clay-100 text-ink" : "bg-paper shadow-card text-ink",
            isOptimistic ? "opacity-80" : "",
          ].join(" ")}
        >
          {msg.content ? (
            msg.content
          ) : (
            <span className="inline-block h-4 w-4 animate-pulse rounded-full bg-ink-faint" />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ChatView ─────────────────────────────────────────────────────────────────

type PendingExchange = { userText: string; assistantText: string };

function ChatView({
  petId,
  selected,
  pending,
  pendingDoneId,
  streaming,
  onBack,
  onStreamStart,
  onStreamDelta,
  onStreamDone,
  onStreamError,
  onReconciled,
  canEdit,
}: {
  petId: string;
  /** "new" = no persisted conversation yet; otherwise a real conversation id */
  selected: string;
  /** Parent-owned so it survives the keyed remount on "new" → real id. */
  pending: PendingExchange | null;
  pendingDoneId: string | null;
  streaming: boolean;
  onBack: () => void;
  onStreamStart: (userText: string) => void;
  onStreamDelta: (chunk: string) => void;
  onStreamDone: (conversationId: string, messageId: string) => void;
  onStreamError: (gotStream: boolean, convIdAtSend: string | null) => void;
  onReconciled: () => void;
  canEdit: boolean;
}) {
  const t = useT();
  const locale = useLocaleTag();
  const toast = useToast();
  const qc = useQueryClient();

  const [text, setText] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);

  // Stream callbacks can fire after this view unmounts (back mid-stream) —
  // guard the view-local work (toast, composer restore). Parent-owned stream
  // state needs no guard: the parent stays mounted.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Only fetch when we have a real conversation id (not "new")
  const conversationQuery = useAdvisorConversation(
    petId,
    selected === "new" ? "" : selected,
    { enabled: selected !== "new" },
  );

  const messages: AdvisorMessageView[] = conversationQuery.data?.messages ?? [];

  // Clear the optimistic exchange only once the fetched data contains the
  // persisted assistant message — query data is the source of truth.
  // Layout effect: clear before paint so the fetched rows and the optimistic
  // bubbles never coexist on screen for a frame.
  useLayoutEffect(() => {
    if (
      pendingDoneId !== null &&
      conversationQuery.data?.messages.some((m) => m.id === pendingDoneId)
    ) {
      onReconciled();
    }
  }, [pendingDoneId, conversationQuery.data, onReconciled]);

  // Auto-scroll to bottom when assistant text grows or new messages appear
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, pending?.assistantText]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setText("");
    onStreamStart(trimmed);

    const convIdAtSend = selected === "new" ? null : selected;
    // True once any stream content arrived — distinguishes pre-stream
    // rejections (nothing persisted) from mid-stream failures (partial saved).
    let gotStream = false;

    void sendAdvisorMessage(petId, convIdAtSend, trimmed, locale, {
      onDelta: (chunk) => {
        gotStream = true;
        onStreamDelta(chunk);
      },
      onDone: ({ conversationId, messageId }) => {
        gotStream = true;
        void qc.invalidateQueries({ queryKey: keys.advisorConversations(petId) });
        void qc.invalidateQueries({
          queryKey: keys.advisorConversation(petId, conversationId),
        });
        onStreamDone(conversationId, messageId);
      },
      onError: (code) => {
        // Invalidate the list regardless of mount state; the parent handler
        // owns the conversation-query invalidation (it clears the optimistic
        // bubbles once the persisted partial has refetched).
        void qc.invalidateQueries({ queryKey: keys.advisorConversations(petId) });
        onStreamError(gotStream, convIdAtSend);
        if (!aliveRef.current) return;
        toast.show(advisorErrorText(code, t), { tone: "danger" });
        if (!gotStream) {
          // Pre-stream rejection: nothing was persisted — give the user
          // their text back to retry (the parent dropped the false bubbles).
          setText(trimmed);
        }
      },
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col gap-0">
      {/* Header */}
      <div className="flex items-center gap-2 pb-3">
        <IconButton label={t.common.back} onClick={onBack}>
          <ArrowLeftIcon className="h-5 w-5" />
        </IconButton>
        <h1 className="text-xl text-ink">
          {conversationQuery.data?.title ?? t.advisor.title}
        </h1>
      </div>

      {/* Messages */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto py-2">
        {conversationQuery.isLoading && selected !== "new" && !pending ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : messages.length === 0 && !pending ? (
          <EmptyState title={t.advisor.emptyTitle} hint={t.advisor.emptyHint} />
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            {/* Optimistic pending exchange rendered after fetched messages */}
            {pending && (
              <>
                <MessageBubble
                  msg={{ role: "user", content: pending.userText, authorName: null }}
                  isOptimistic
                />
                <MessageBubble
                  msg={{ role: "assistant", content: pending.assistantText, authorName: null }}
                  isOptimistic
                />
              </>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Disclaimer + composer — pinned above bottom */}
      <div className="flex flex-col gap-2 pt-3">
        <DisclaimerBanner />
        {canEdit ? (
          <div className="flex items-end gap-2">
            <Textarea
              className="flex-1 resize-none"
              rows={2}
              maxLength={4000}
              placeholder={t.advisor.inputPlaceholder}
              value={text}
              disabled={streaming}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <Button
              size="sm"
              disabled={streaming || text.trim() === ""}
              onClick={handleSend}
            >
              {streaming ? <Spinner className="h-4 w-4" /> : null}
              {t.advisor.send}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-ink-faint">{t.advisor.viewerNote}</p>
        )}
      </div>
    </div>
  );
}

// ─── ConversationRow ──────────────────────────────────────────────────────────

function ConversationRow({
  conv,
  locale,
  canEdit,
  onSelect,
  onDelete,
}: {
  conv: AdvisorConversationSummary;
  locale: string;
  canEdit: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [armed, setArmed] = useState(false);

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onSelect}>
        <p className="truncate text-sm font-semibold text-ink">{conv.title}</p>
        <p className="text-xs text-ink-faint">
          {conv.createdByName ? `${conv.createdByName} · ` : ""}
          {(() => {
            const kind = relativeDayKind(dayKeyOf(conv.updatedAt, deviceTzOffsetMin()), todayKey());
            return kind === "today" ? t.common.today : kind === "yesterday" ? t.common.yesterday : shortDate(conv.updatedAt, locale);
          })()}
        </p>
      </button>
      {canEdit && (
        <Button
          variant={armed ? "danger" : "ghost"}
          size="sm"
          onClick={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            setArmed(false);
            onDelete();
          }}
        >
          {armed ? t.advisor.deleteConfirm : t.advisor.deleteConversation}
        </Button>
      )}
    </li>
  );
}

// ─── ListView ─────────────────────────────────────────────────────────────────

function ListView({
  petId,
  canEdit,
  hasSettings,
  onSelect,
  onNew,
}: {
  petId: string;
  canEdit: boolean;
  hasSettings: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const t = useT();
  const locale = useLocaleTag();
  const navigate = useNavigate();
  const toast = useToast();
  const conversations = useAdvisorConversations(petId);
  const deleteConversation = useDeleteAdvisorConversation(petId);

  const items = conversations.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl text-ink">{t.advisor.title}</h1>
        <p className="mt-0.5 text-xs text-ink-faint">{t.advisor.disclaimer}</p>
      </div>

      {/* New conversation / setup CTA */}
      {canEdit && hasSettings && (
        <Button onClick={onNew}>{t.advisor.newConversation}</Button>
      )}
      {canEdit && !hasSettings && (
        <Card className="p-4">
          <p className="mb-3 text-sm text-ink-soft">{t.advisor.errors.advisor_not_configured}</p>
          <Button onClick={() => navigate("/settings/advisor")}>
            {t.advisor.setupCta}
          </Button>
        </Card>
      )}
      {!canEdit && (
        <p className="text-sm text-ink-faint">{t.advisor.viewerNote}</p>
      )}

      {/* Conversation list always rendered */}
      {conversations.isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title={t.advisor.listEmptyTitle}
            hint={t.advisor.listEmptyHint}
          />
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-cream-200">
            {items.map((conv) => (
              <ConversationRow
                key={conv.id}
                conv={conv}
                locale={locale}
                canEdit={canEdit}
                onSelect={() => onSelect(conv.id)}
                onDelete={() =>
                  deleteConversation.mutate(conv.id, {
                    onError: () =>
                      toast.show(t.errors.title, { tone: "danger" }),
                  })
                }
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ─── Route component ──────────────────────────────────────────────────────────

export function Advisor() {
  const pet = useRequiredPet();
  const settings = useAdvisorSettings();
  const hasSettings = settings.data?.settings != null;
  const canEdit = pet.role !== "viewer";
  const qc = useQueryClient();

  // null = list view; "new" = new conversation; <id> = open conversation
  const [selected, setSelected] = useState<string | null>(null);

  // Streaming exchange state lives HERE (not in ChatView) so the optimistic
  // bubbles survive the keyed remount when "new" transitions to the real id.
  const [pending, setPending] = useState<PendingExchange | null>(null);
  const [pendingDoneId, setPendingDoneId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);

  // Latest selected for stream callbacks that outlive a ChatView instance.
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const handleBack = () => {
    void qc.invalidateQueries({ queryKey: keys.advisorConversations(pet.id) });
    // Leaving the chat discards the optimistic bubbles — they must not leak
    // into another conversation; a refetch on re-entry shows persisted data.
    setPending(null);
    setPendingDoneId(null);
    setSelected(null);
  };

  const handleStreamStart = (userText: string) => {
    setStreaming(true);
    setPending({ userText, assistantText: "" });
    // A stale done-id from a previous exchange must not reconcile (and wipe)
    // this fresh stream against the previous refetch.
    setPendingDoneId(null);
  };

  const handleStreamDelta = (chunk: string) => {
    setPending((prev) =>
      prev ? { ...prev, assistantText: prev.assistantText + chunk } : null,
    );
  };

  const handleStreamDone = (conversationId: string, messageId: string) => {
    setStreaming(false);
    setPendingDoneId(messageId);
    // Transition the draft to the real conversation only if the user is
    // still on it — backing out mid-stream must not yank them back in.
    if (selectedRef.current === "new") {
      setSelected(conversationId);
    }
  };

  const handleStreamError = (gotStream: boolean, convIdAtSend: string | null) => {
    setStreaming(false);
    if (!gotStream) {
      // Pre-stream rejection: nothing was persisted — the bubbles are false.
      setPending(null);
      setPendingDoneId(null);
      return;
    }
    if (convIdAtSend !== null) {
      // Mid-stream failure on an existing conversation: the worker persisted
      // the partial. invalidateQueries resolves after the active query has
      // refetched, so the canonical rows are already rendering when the
      // optimistic bubbles clear — no vanish window, no permanent duplicates.
      void qc
        .invalidateQueries({ queryKey: keys.advisorConversation(pet.id, convIdAtSend) })
        .then(() => {
          setPending(null);
          setPendingDoneId(null);
        });
    }
    // gotStream on a NEW conversation: keep the bubbles visible — the real
    // id is unknown here; the invalidated list shows the persisted row.
  };

  const handleReconciled = () => {
    setPending(null);
    setPendingDoneId(null);
  };

  // Don't flash the setup CTA before the settings query has resolved.
  if (settings.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (selected !== null) {
    return (
      <ChatView
        key={selected}
        petId={pet.id}
        selected={selected}
        pending={pending}
        pendingDoneId={pendingDoneId}
        streaming={streaming}
        onBack={handleBack}
        onStreamStart={handleStreamStart}
        onStreamDelta={handleStreamDelta}
        onStreamDone={handleStreamDone}
        onStreamError={handleStreamError}
        onReconciled={handleReconciled}
        canEdit={canEdit}
      />
    );
  }

  return (
    <ListView
      petId={pet.id}
      canEdit={canEdit}
      hasSettings={hasSettings}
      onSelect={(id) => setSelected(id)}
      onNew={() => setSelected("new")}
    />
  );
}
