import { SELF, env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { advisorConversations, advisorMessages, auditLog } from "../src/db/schema";
import { authHeaders, seedPet, seedUserWithSession, withMember } from "./helpers";

// ---------------------------------------------------------------------------
// fetchMock setup (mirror advisor-providers.test.ts)
// ---------------------------------------------------------------------------

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function configureAdvisor(auth: { cookie: string; csrfToken: string }) {
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

/** Build a well-formed Anthropic SSE body from an array of text chunks. */
function mockAnthropicStream(chunks: string[]): string {
  const events: string[] = [
    'event: message_start\ndata: {"type":"message_start"}\n\n',
    ...chunks.map(
      (text) =>
        `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":${JSON.stringify(text)}}}\n\n`,
    ),
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];
  return events.join("");
}

function interceptAnthropic(body: string, status = 200) {
  fetchMock
    .get("https://api.anthropic.com")
    .intercept({ path: "/v1/messages", method: "POST" })
    .reply(status, body, {
      headers: status === 200 ? { "content-type": "text/event-stream" } : {},
    });
}

// ---------------------------------------------------------------------------
// Case 1: Create + stream
// ---------------------------------------------------------------------------

it("POST /conversations creates conversation, streams SSE, persists user+assistant messages, writes audit", async () => {
  const editor = await seedUserWithSession({ displayName: "Alice" });
  const { petId } = await seedPet(editor.userId);
  await configureAdvisor(editor);

  interceptAnthropic(mockAnthropicStream(["She ", "seems ", "fine."]));

  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/advisor/conversations`,
    {
      method: "POST",
      headers: authHeaders(editor.cookie, editor.csrfToken),
      body: JSON.stringify({ message: "Is Momo ok?", tz: 540, locale: "en" }),
    },
  );

  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);

  const body = await res.text();

  // Three delta events in order
  const deltaMatches = [...body.matchAll(/event: delta/g)];
  expect(deltaMatches).toHaveLength(3);

  // The text chunks appear in order in the body
  expect(body.indexOf("She ")).toBeLessThan(body.indexOf("seems "));
  expect(body.indexOf("seems ")).toBeLessThan(body.indexOf("fine."));

  // One done event with conversationId and messageId
  expect(body).toContain("event: done");
  const doneMatch = body.match(/event: done\ndata: ({.*})/);
  expect(doneMatch).not.toBeNull();
  const done = JSON.parse(doneMatch![1]!) as { conversationId: string; messageId: string };
  expect(done.conversationId).toBeTruthy();
  expect(done.messageId).toBeTruthy();

  // DB: 1 conversation
  const db = drizzle(env.DB);
  const convs = await db
    .select()
    .from(advisorConversations)
    .where(eq(advisorConversations.petId, petId))
    .all();
  expect(convs).toHaveLength(1);
  const conv = convs[0]!;
  expect(conv.id).toBe(done.conversationId);
  expect(conv.title).toBe("Is Momo ok?");
  expect(conv.updatedAt).toBeGreaterThanOrEqual(conv.createdAt);

  // DB: 2 messages — user then assistant
  const msgs = await db
    .select()
    .from(advisorMessages)
    .where(eq(advisorMessages.conversationId, conv.id))
    .all();
  expect(msgs).toHaveLength(2);

  const userMsg = msgs.find((m) => m.role === "user")!;
  expect(userMsg).toBeDefined();
  expect(userMsg.content).toBe("Is Momo ok?");
  expect(userMsg.authorId).toBe(editor.userId);
  expect(userMsg.provider).toBeNull();

  const assistantMsg = msgs.find((m) => m.role === "assistant")!;
  expect(assistantMsg).toBeDefined();
  expect(assistantMsg.id).toBe(done.messageId);
  expect(assistantMsg.content).toBe("She seems fine.");
  expect(assistantMsg.provider).toBe("anthropic");
  expect(assistantMsg.model).toBe("claude-opus-4-8");
  expect(assistantMsg.authorId).toBe(editor.userId);

  // Audit: one create row for the advisor conversation
  const audits = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.petId, petId))
    .all();
  expect(audits).toHaveLength(1);
  const audit = audits[0]!;
  expect(audit.entity).toBe("advisor");
  expect(audit.action).toBe("create");
  const diff = audit.diff as Record<string, unknown>;
  expect(diff).toHaveProperty("title", "Is Momo ok?");
  // Diff contains only the title — no other keys (like assistant reply)
  expect(Object.keys(diff)).toEqual(["title"]);
  expect(JSON.stringify(diff)).not.toContain("She seems fine");
});

// ---------------------------------------------------------------------------
// Case 2: Append to existing conversation
// ---------------------------------------------------------------------------

it("POST /conversations/:id/messages appends messages to existing conversation", async () => {
  const editor = await seedUserWithSession({ displayName: "Bob" });
  const { petId } = await seedPet(editor.userId);
  await configureAdvisor(editor);

  // First turn: create the conversation
  interceptAnthropic(mockAnthropicStream(["Hello!"]));
  const createRes = await SELF.fetch(
    `https://app.local/api/pets/${petId}/advisor/conversations`,
    {
      method: "POST",
      headers: authHeaders(editor.cookie, editor.csrfToken),
      body: JSON.stringify({ message: "Hi there", tz: 0, locale: "en" }),
    },
  );
  expect(createRes.status).toBe(200);
  const createBody = await createRes.text();
  const doneMatch = createBody.match(/event: done\ndata: ({.*})/);
  const { conversationId } = JSON.parse(doneMatch![1]!) as {
    conversationId: string;
    messageId: string;
  };

  // Second turn: append
  interceptAnthropic(mockAnthropicStream(["How can I help?"]));
  const appendRes = await SELF.fetch(
    `https://app.local/api/pets/${petId}/advisor/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: authHeaders(editor.cookie, editor.csrfToken),
      body: JSON.stringify({ message: "Tell me more", tz: 0, locale: "en" }),
    },
  );
  expect(appendRes.status).toBe(200);
  expect(appendRes.headers.get("content-type")).toMatch(/text\/event-stream/);

  const appendBody = await appendRes.text();
  expect(appendBody).toContain("event: done");
  expect(appendBody).toContain("How can I help?");

  // DB: 4 messages total (2 per turn)
  const db = drizzle(env.DB);
  const msgs = await db
    .select()
    .from(advisorMessages)
    .where(eq(advisorMessages.conversationId, conversationId))
    .all();
  expect(msgs).toHaveLength(4);
});

// ---------------------------------------------------------------------------
// Case 3: Unconfigured — 409 JSON (no SSE)
// ---------------------------------------------------------------------------

it("POST /conversations returns 409 JSON when user has no advisor settings", async () => {
  const editor = await seedUserWithSession();
  const { petId } = await seedPet(editor.userId);
  // No configureAdvisor call

  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/advisor/conversations`,
    {
      method: "POST",
      headers: authHeaders(editor.cookie, editor.csrfToken),
      body: JSON.stringify({ message: "Hello", tz: 0, locale: "en" }),
    },
  );
  expect(res.status).toBe(409);
  expect(res.headers.get("content-type")).toMatch(/application\/json/);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("advisor_not_configured");
});

// ---------------------------------------------------------------------------
// Case 4: Provider auth failure — SSE error event; user message persisted; no assistant row
// ---------------------------------------------------------------------------

it("mocked 401 → event:error with provider_auth; user message persisted; no assistant row", async () => {
  const editor = await seedUserWithSession();
  const { petId } = await seedPet(editor.userId);
  await configureAdvisor(editor);

  // Mock a 401 from Anthropic
  fetchMock
    .get("https://api.anthropic.com")
    .intercept({ path: "/v1/messages", method: "POST" })
    .reply(401, '{"error":{"type":"authentication_error"}}');

  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/advisor/conversations`,
    {
      method: "POST",
      headers: authHeaders(editor.cookie, editor.csrfToken),
      body: JSON.stringify({ message: "Will this fail?", tz: 0, locale: "en" }),
    },
  );
  expect(res.status).toBe(200); // SSE stream starts normally
  const body = await res.text();

  // SSE error event with provider_auth code
  expect(body).toContain("event: error");
  const errorMatch = body.match(/event: error\ndata: ({.*})/);
  expect(errorMatch).not.toBeNull();
  const error = JSON.parse(errorMatch![1]!) as { code: string };
  expect(error.code).toBe("provider_auth");

  // No done event
  expect(body).not.toContain("event: done");

  // DB: conversation created, user message persisted
  const db = drizzle(env.DB);
  const convs = await db
    .select()
    .from(advisorConversations)
    .where(eq(advisorConversations.petId, petId))
    .all();
  expect(convs).toHaveLength(1);

  const msgs = await db
    .select()
    .from(advisorMessages)
    .where(eq(advisorMessages.conversationId, convs[0]!.id))
    .all();
  expect(msgs).toHaveLength(1);
  expect(msgs[0]!.role).toBe("user");
  // NO assistant row
  expect(msgs.find((m) => m.role === "assistant")).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Case 5: Junk-only 200 stream → event:error provider_error; no assistant row
// ---------------------------------------------------------------------------

it("junk-only 200 stream → event:error with provider_error; no assistant row persisted", async () => {
  const editor = await seedUserWithSession();
  const { petId } = await seedPet(editor.userId);
  await configureAdvisor(editor);

  // SSE body with only non-delta lines → no text chunks yielded
  const junkBody =
    'data: not-json\n\ndata: {"type":"message_start"}\n\ndata: {"type":"message_stop"}\n\n';
  fetchMock
    .get("https://api.anthropic.com")
    .intercept({ path: "/v1/messages", method: "POST" })
    .reply(200, junkBody, { headers: { "content-type": "text/event-stream" } });

  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/advisor/conversations`,
    {
      method: "POST",
      headers: authHeaders(editor.cookie, editor.csrfToken),
      body: JSON.stringify({ message: "Any text?", tz: 0, locale: "en" }),
    },
  );
  expect(res.status).toBe(200);
  const body = await res.text();

  // error event present
  expect(body).toContain("event: error");
  const errorMatch = body.match(/event: error\ndata: ({.*})/);
  expect(errorMatch).not.toBeNull();
  const error = JSON.parse(errorMatch![1]!) as { code: string };
  expect(error.code).toBe("provider_error");

  // No done event
  expect(body).not.toContain("event: done");

  // DB: no assistant message
  const db = drizzle(env.DB);
  const convs = await db
    .select()
    .from(advisorConversations)
    .where(eq(advisorConversations.petId, petId))
    .all();
  const msgs = await db
    .select()
    .from(advisorMessages)
    .where(eq(advisorMessages.conversationId, convs[0]!.id))
    .all();
  expect(msgs.find((m) => m.role === "assistant")).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Case 6: Authz — viewer 403, non-member 404, missing conversation 404
// ---------------------------------------------------------------------------

it("viewer POST → 403; non-member → 404; missing conversation id on append → 404", async () => {
  const owner = await seedUserWithSession();
  const viewer = await seedUserWithSession({ email: "viewer@example.com" });
  const stranger = await seedUserWithSession({ email: "stranger@example.com" });
  const { petId } = await seedPet(owner.userId);
  await withMember(petId, viewer.userId, "viewer");

  // viewer → 403
  const viewerRes = await SELF.fetch(
    `https://app.local/api/pets/${petId}/advisor/conversations`,
    {
      method: "POST",
      headers: authHeaders(viewer.cookie, viewer.csrfToken),
      body: JSON.stringify({ message: "Hello", tz: 0, locale: "en" }),
    },
  );
  expect(viewerRes.status).toBe(403);

  // non-member → 404
  const strangerRes = await SELF.fetch(
    `https://app.local/api/pets/${petId}/advisor/conversations`,
    {
      method: "POST",
      headers: authHeaders(stranger.cookie, stranger.csrfToken),
      body: JSON.stringify({ message: "Hello", tz: 0, locale: "en" }),
    },
  );
  expect(strangerRes.status).toBe(404);

  // missing conversation id on append → 404
  await configureAdvisor(owner);
  const appendRes = await SELF.fetch(
    `https://app.local/api/pets/${petId}/advisor/conversations/nonexistent-conv-id/messages`,
    {
      method: "POST",
      headers: authHeaders(owner.cookie, owner.csrfToken),
      body: JSON.stringify({ message: "Hello", tz: 0, locale: "en" }),
    },
  );
  expect(appendRes.status).toBe(404);
});

// ---------------------------------------------------------------------------
// Case 7: Validation — empty message → 400; >4000 chars → 400
// ---------------------------------------------------------------------------

it("empty message → 400; message >4000 chars → 400", async () => {
  const editor = await seedUserWithSession();
  const { petId } = await seedPet(editor.userId);

  // empty message
  const emptyRes = await SELF.fetch(
    `https://app.local/api/pets/${petId}/advisor/conversations`,
    {
      method: "POST",
      headers: authHeaders(editor.cookie, editor.csrfToken),
      body: JSON.stringify({ message: "", tz: 0, locale: "en" }),
    },
  );
  expect(emptyRes.status).toBe(400);

  // >4000 chars
  const longRes = await SELF.fetch(
    `https://app.local/api/pets/${petId}/advisor/conversations`,
    {
      method: "POST",
      headers: authHeaders(editor.cookie, editor.csrfToken),
      body: JSON.stringify({ message: "x".repeat(4001), tz: 0, locale: "en" }),
    },
  );
  expect(longRes.status).toBe(400);
});
