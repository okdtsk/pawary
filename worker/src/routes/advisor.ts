import type {
  AdvisorConversationDetail,
  AdvisorConversationSummary,
  AdvisorMessageView,
} from "@pawary/shared";
import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { advisorConversations, advisorMessages, users } from "../db/schema";
import { writeAudit } from "../domain/audit";
import type { AppEnv } from "../env";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requirePetRole } from "../middleware/pet-access";
import { requireSession } from "../middleware/session";

export const advisorRoutes = new Hono<AppEnv>();

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
