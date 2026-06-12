import type {
  AdvisorChatInput,
  AdvisorConversationDetail,
  AdvisorConversationSummary,
  AdvisorMessageView,
} from "@pawary/shared";
import { advisorChatSchema } from "@pawary/shared";
import { and, asc, desc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  advisorConversations,
  advisorMessages,
  userAiSettings,
  users,
} from "../db/schema";
import type { AdvisorConversation } from "../db/schema";
import { AdvisorProviderError, streamProvider } from "../domain/advisor/providers";
import { buildAdvisorSystemPrompt } from "../domain/advisor/context";
import { writeAudit } from "../domain/audit";
import type { AppEnv } from "../env";
import { decryptKey } from "../lib/keycrypt";
import { newId } from "../lib/id";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requirePetRole } from "../middleware/pet-access";
import { rateLimit } from "../lib/rate-limit";
import { requireSession } from "../middleware/session";

const HISTORY_LIMIT = 20;
const TITLE_MAX = 80;

async function loadAdvisorConfig(db: DrizzleD1Database, userId: string) {
  return db.select().from(userAiSettings).where(eq(userAiSettings.userId, userId)).get();
}

async function chatAndStream(
  c: Context<AppEnv>,
  conversation: AdvisorConversation,
  input: AdvisorChatInput,
) {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const config = (await loadAdvisorConfig(db, user.id))!;
  const now = Date.now();

  // Persist user message BEFORE the provider call
  await db.insert(advisorMessages).values({
    id: newId(),
    conversationId: conversation.id,
    role: "user",
    content: input.message,
    authorId: user.id,
    createdAt: now,
  });
  await db
    .update(advisorConversations)
    .set({ updatedAt: now })
    .where(eq(advisorConversations.id, conversation.id));

  // Build history: last 20 messages ordered oldest-first
  const history = await db
    .select({ role: advisorMessages.role, content: advisorMessages.content })
    .from(advisorMessages)
    .where(eq(advisorMessages.conversationId, conversation.id))
    .orderBy(desc(advisorMessages.createdAt), desc(advisorMessages.id))
    .limit(HISTORY_LIMIT)
    .all();
  history.reverse(); // oldest-first for the provider

  const system = await buildAdvisorSystemPrompt(db, c.get("pet"), input.tz, input.locale);
  const apiKey = await decryptKey(config.encryptedKey, c.env.ADVISOR_KEK);

  return streamSSE(c, async (stream) => {
    let text = "";

    const persistAssistant = async (): Promise<string> => {
      const id = newId();
      const ts = Date.now();
      await db.insert(advisorMessages).values({
        id,
        conversationId: conversation.id,
        role: "assistant",
        content: text,
        authorId: user.id,
        provider: config.provider,
        model: config.model,
        createdAt: ts,
      });
      await db
        .update(advisorConversations)
        .set({ updatedAt: ts })
        .where(eq(advisorConversations.id, conversation.id));
      return id;
    };

    try {
      for await (const chunk of streamProvider(config.provider, {
        apiKey,
        model: config.model,
        system,
        messages: history,
      })) {
        text += chunk;
        await stream.writeSSE({ event: "delta", data: JSON.stringify({ text: chunk }) });
      }
      if (text === "") {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ code: "provider_error", message: "The provider returned no content" }),
        });
        return;
      }
      const messageId = await persistAssistant();
      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({ conversationId: conversation.id, messageId }),
      });
    } catch (e) {
      if (text !== "") await persistAssistant(); // keep the partial — client saw it
      const code = e instanceof AdvisorProviderError ? e.code : "provider_error";
      const message = e instanceof AdvisorProviderError ? e.message : "Advisor request failed";
      await stream.writeSSE({ event: "error", data: JSON.stringify({ code, message }) });
    }
  });
}

export const advisorRoutes = new Hono<AppEnv>();

const chatRateLimit = rateLimit("advisor-chat", 20, 300_000, "user");

// POST /api/pets/:petId/advisor/conversations
// Creates a new conversation and streams the first assistant reply.
advisorRoutes.post(
  "/api/pets/:petId/advisor/conversations",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  chatRateLimit,
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = advisorChatSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }

    const user = c.get("user");
    const petId = c.get("petId");
    const db = drizzle(c.env.DB);
    const config = await loadAdvisorConfig(db, user.id);
    if (!config) {
      return err(c, 409, "advisor_not_configured", "AI Advisor is not configured");
    }

    const now = Date.now();
    const id = newId();
    const conversation: AdvisorConversation = {
      id,
      petId,
      title: parsed.data.message.slice(0, TITLE_MAX),
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(advisorConversations).values(conversation);
    await writeAudit(db, {
      petId,
      userId: user.id,
      action: "create",
      entity: "advisor",
      entityId: id,
      diff: { title: conversation.title },
    });

    return chatAndStream(c, conversation, parsed.data);
  },
);

// POST /api/pets/:petId/advisor/conversations/:conversationId/messages
// Appends a user message and streams the next assistant reply.
advisorRoutes.post(
  "/api/pets/:petId/advisor/conversations/:conversationId/messages",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  chatRateLimit,
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = advisorChatSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
    }

    const petId = c.get("petId");
    const conversationId = c.req.param("conversationId");
    const db = drizzle(c.env.DB);

    const conversation = await db
      .select()
      .from(advisorConversations)
      .where(
        and(
          eq(advisorConversations.id, conversationId),
          eq(advisorConversations.petId, petId),
        ),
      )
      .get();
    if (!conversation) {
      return err(c, 404, "not_found", "Conversation not found");
    }

    const user = c.get("user");
    const config = await loadAdvisorConfig(db, user.id);
    if (!config) {
      return err(c, 409, "advisor_not_configured", "AI Advisor is not configured");
    }

    return chatAndStream(c, conversation, parsed.data);
  },
);

// GET /api/pets/:petId/advisor/conversations
// Viewer-accessible. Returns summaries ordered newest-updatedAt-first.
advisorRoutes.get(
  "/api/pets/:petId/advisor/conversations",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const petId = c.get("petId");

    const rows = await db
      .select({
        id: advisorConversations.id,
        title: advisorConversations.title,
        createdByName: users.displayName,
        updatedAt: advisorConversations.updatedAt,
      })
      .from(advisorConversations)
      .leftJoin(users, eq(advisorConversations.createdBy, users.id))
      .where(eq(advisorConversations.petId, petId))
      .orderBy(desc(advisorConversations.updatedAt))
      .all();

    const summaries: AdvisorConversationSummary[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdByName: r.createdByName ?? null,
      updatedAt: r.updatedAt,
    })) satisfies AdvisorConversationSummary[];

    return c.json({ data: summaries });
  },
);

// GET /api/pets/:petId/advisor/conversations/:conversationId
// Viewer-accessible. Returns conversation detail with messages oldest-first.
advisorRoutes.get(
  "/api/pets/:petId/advisor/conversations/:conversationId",
  requireSession,
  requirePetRole("viewer"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const petId = c.get("petId");
    const conversationId = c.req.param("conversationId");

    const conv = await db
      .select()
      .from(advisorConversations)
      .where(
        and(
          eq(advisorConversations.id, conversationId),
          eq(advisorConversations.petId, petId),
        ),
      )
      .get();

    if (!conv) return err(c, 404, "not_found", "Not found");

    // get conversation creator name
    const creatorRow = conv.createdBy
      ? await db
          .select({ displayName: users.displayName })
          .from(users)
          .where(eq(users.id, conv.createdBy))
          .get()
      : null;

    const msgRows = await db
      .select({
        id: advisorMessages.id,
        role: advisorMessages.role,
        content: advisorMessages.content,
        authorName: users.displayName,
        provider: advisorMessages.provider,
        model: advisorMessages.model,
        createdAt: advisorMessages.createdAt,
      })
      .from(advisorMessages)
      .leftJoin(users, eq(advisorMessages.authorId, users.id))
      .where(eq(advisorMessages.conversationId, conversationId))
      .orderBy(asc(advisorMessages.createdAt), asc(advisorMessages.id))
      .all();

    const messages: AdvisorMessageView[] = msgRows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      authorName: r.authorName ?? null,
      provider: r.provider ?? null,
      model: r.model ?? null,
      createdAt: r.createdAt,
    })) satisfies AdvisorMessageView[];

    const detail: AdvisorConversationDetail = {
      id: conv.id,
      title: conv.title,
      createdByName: creatorRow?.displayName ?? null,
      updatedAt: conv.updatedAt,
      messages,
    };

    return c.json({ data: detail });
  },
);

// DELETE /api/pets/:petId/advisor/conversations/:conversationId
// Editor-accessible. Deletes conversation (messages cascade), writes audit.
advisorRoutes.delete(
  "/api/pets/:petId/advisor/conversations/:conversationId",
  requireSession,
  requireCsrf,
  requirePetRole("editor"),
  async (c) => {
    const db = drizzle(c.env.DB);
    const petId = c.get("petId");
    const conversationId = c.req.param("conversationId");
    const user = c.get("user");

    const conv = await db
      .select()
      .from(advisorConversations)
      .where(
        and(
          eq(advisorConversations.id, conversationId),
          eq(advisorConversations.petId, petId),
        ),
      )
      .get();

    if (!conv) return err(c, 404, "not_found", "Not found");

    await db
      .delete(advisorConversations)
      .where(eq(advisorConversations.id, conversationId));

    await writeAudit(db, {
      petId,
      userId: user.id,
      action: "delete",
      entity: "advisor",
      entityId: conversationId,
      diff: { title: conv.title },
    });

    return c.json({ data: { ok: true } });
  },
);
