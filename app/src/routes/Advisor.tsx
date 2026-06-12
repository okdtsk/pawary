import type { AdvisorConversationSummary, AdvisorMessageView } from "@pawary/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
  return map[code] ?? t.advisor.errors.provider_error;
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
  onBack,
  onSelectConversation,
  canEdit,
}: {
  petId: string;
  /** "new" = no persisted conversation yet; otherwise a real conversation id */
  selected: string;
  onBack: () => void;
  /** Called with real conversation id when a new conversation is created */
  onSelectConversation: (id: string) => void;
  canEdit: boolean;
}) {
  const t = useT();
  const locale = useLocaleTag();
  const toast = useToast();
  const qc = useQueryClient();

  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingExchange | null>(null);
  const [streaming, setStreaming] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  // Only fetch when we have a real conversation id (not "new")
  const conversationQuery = useAdvisorConversation(
    petId,
    selected === "new" ? "" : selected,
    { enabled: selected !== "new" },
  );

  const messages: AdvisorMessageView[] = conversationQuery.data?.messages ?? [];

  // Auto-scroll to bottom when assistant text grows or new messages appear
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, pending?.assistantText]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setText("");
    setStreaming(true);
    setPending({ userText: trimmed, assistantText: "" });

    const convIdAtSend = selected === "new" ? null : selected;

    void sendAdvisorMessage(petId, convIdAtSend, trimmed, locale, {
      onDelta: (chunk) => {
        setPending((prev) =>
          prev ? { ...prev, assistantText: prev.assistantText + chunk } : null,
        );
      },
      onDone: ({ conversationId }) => {
        // Invalidate both lists and the specific conversation
        void qc.invalidateQueries({ queryKey: keys.advisorConversations(petId) });
        void qc.invalidateQueries({
          queryKey: keys.advisorConversation(petId, conversationId),
        });
        // Wait for the refetch to settle, then clear pending state
        // (the fetched data becomes the source of truth)
        void qc
          .refetchQueries({ queryKey: keys.advisorConversation(petId, conversationId) })
          .then(() => {
            setPending(null);
            setStreaming(false);
          });
        // If this was a new conversation, switch selected to the real id
        if (selected === "new") {
          onSelectConversation(conversationId);
        }
      },
      onError: (code) => {
        toast.show(advisorErrorText(code, t), { tone: "danger" });
        // Invalidate even on error — server may have persisted a partial
        void qc.invalidateQueries({ queryKey: keys.advisorConversations(petId) });
        if (convIdAtSend) {
          void qc.invalidateQueries({
            queryKey: keys.advisorConversation(petId, convIdAtSend),
          });
        }
        setPending(null);
        setStreaming(false);
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
        {conversationQuery.isLoading && selected !== "new" ? (
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
          {shortDate(conv.updatedAt, locale)}
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

      {/* Setup CTA: no settings + editor */}
      {!hasSettings && canEdit ? (
        <Card>
          <EmptyState
            title={t.advisor.emptyTitle}
            hint={t.advisor.setupCta}
            action={
              <Button onClick={() => navigate("/settings/advisor")}>
                {t.advisor.setupCta}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {canEdit && hasSettings && (
            <Button onClick={onNew}>{t.advisor.newConversation}</Button>
          )}
          {!canEdit && (
            <p className="text-sm text-ink-faint">{t.advisor.viewerNote}</p>
          )}

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
        </>
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

  const handleBack = () => {
    void qc.invalidateQueries({ queryKey: keys.advisorConversations(pet.id) });
    setSelected(null);
  };

  if (selected !== null) {
    return (
      <ChatView
        petId={pet.id}
        selected={selected}
        onBack={handleBack}
        onSelectConversation={(id) => setSelected(id)}
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
