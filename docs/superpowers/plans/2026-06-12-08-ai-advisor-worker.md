# Pawary Plan 8: AI Advisor — Worker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The complete server side of the AI Advisor: encrypted BYO-key settings, three streaming provider adapters (Anthropic/OpenAI/Gemini), pet-context assembly, shared persisted conversations with viewer-read/editor-write semantics, a normalized SSE chat endpoint, export inclusion — fully TDD'd.

**Architecture:** One D1 migration (3 tables). New `worker/src/lib/keycrypt.ts` (AES-GCM-256, KEK from the `ADVISOR_KEK` secret). New domain folder `worker/src/domain/advisor/` (`providers.ts` adapters + SSE parser, `context.ts` system-prompt builder). Two new route files: `advisor-settings.ts` (user-scoped) and `advisor.ts` (pet-scoped, uses Hono `streamSSE`). Provider HTTP is raw `fetch`, tested via `fetchMock` from `cloudflare:test` (see `worker/test/oauth.test.ts` for the established interception pattern — check it before writing the first fetchMock test).

**Tech Stack:** No new dependencies. TypeScript, Hono 4 (`hono/streaming`), Drizzle ORM, D1, Zod, WebCrypto, Vitest + @cloudflare/vitest-pool-workers (`fetchMock`).

**Spec:** `docs/superpowers/specs/2026-06-12-ai-advisor-design.md` (read fully first). Plan 09 (app UI) follows this plan.

**Conventions (unchanged from Plans 1–7):** ULIDs via `newId()`; epoch-ms timestamps; `{data}` / `{error:{code,message}}` envelopes via `err()`; strict zod in `shared/src/index.ts`; middleware order `requireSession` → `requireCsrf` → `requirePetRole(...)`; viewer=read, editor=write; non-member 404; `writeAudit()` on pet-scoped mutations; `rateLimit(prefix, limit, windowMs, "user")` AFTER requireSession; TDD per task; each worker task ends with `npm run test -w worker && npm run typecheck -w worker` green and a commit with the exact message given. Do NOT push or deploy.

**Locked decisions (do not relitigate):**

| Decision | Choice |
|---|---|
| KEK | `ADVISOR_KEK` env secret, 32-byte base64. Tests: fixed value in `worker/vitest.config.ts` miniflare bindings. Local dev: `.dev.vars`. Production: user runs `wrangler secret put` (NOT this plan's job — note it in README) |
| Key at rest | `base64(iv(12B) ‖ ciphertext)` in `user_ai_settings.encrypted_key`; never in any response, log, or audit diff |
| Streaming contract | `text/event-stream`; events `delta` (`{"text"}`), `done` (`{"conversationId","messageId"}`), `error` (`{"code","message"}`); codes `provider_auth` / `provider_overloaded` / `provider_error` |
| Persistence order | user message persisted BEFORE the provider call; assistant message persisted after stream end; non-empty partial persisted on mid-stream failure |
| Request body | `{message, tz, locale}` — client passes resolved locale (`en`/`ja`) because `users.locale` may be `"system"` (recorded deviation from spec §4, which only listed `tz`) |
| History window | Last 20 messages sent to the provider |
| Context cap | System prompt hard-capped at 6000 chars (truncate the digest, never the persona/profile) |
| Audit | Conversation create + delete only, entity `advisor`, diff `{title}` — message sends are NOT audited (content privacy) |
| max_tokens | 2048 per assistant reply (all providers) |

---

### Task 1: Schema + migration + KEK plumbing

**Files:**
- Modify: `worker/src/db/schema.ts`, `worker/src/domain/audit.ts`, `worker/src/env.ts`, `worker/vitest.config.ts`
- Create: `worker/drizzle/0003_add-advisor.sql` (generated)
- Test: `worker/test/advisor-schema.test.ts` (new)

- [ ] **Step 1: Write the failing schema test.** Create `worker/test/advisor-schema.test.ts`:

```ts
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { advisorConversations, advisorMessages, userAiSettings } from "../src/db/schema";
import { newId } from "../src/lib/id";
import { seedPet, seedUserWithSession } from "./helpers";

it("advisor tables round-trip through the migration", async () => {
  const { userId } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const db = drizzle(env.DB);
  const now = Date.now();

  await db.insert(userAiSettings).values({
    userId,
    provider: "anthropic",
    model: "claude-opus-4-8",
    encryptedKey: "b64data",
    createdAt: now,
    updatedAt: now,
  });
  const settings = await db
    .select()
    .from(userAiSettings)
    .where(eq(userAiSettings.userId, userId))
    .get();
  expect(settings).toMatchObject({ provider: "anthropic", model: "claude-opus-4-8" });

  const convId = newId();
  await db.insert(advisorConversations).values({
    id: convId,
    petId,
    title: "Is my cat eating enough?",
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(advisorMessages).values({
    id: newId(),
    conversationId: convId,
    role: "user",
    content: "Is my cat eating enough?",
    authorId: userId,
    createdAt: now,
  });
  await db.insert(advisorMessages).values({
    id: newId(),
    conversationId: convId,
    role: "assistant",
    content: "Based on the last 30 days...",
    authorId: userId,
    provider: "anthropic",
    model: "claude-opus-4-8",
    createdAt: now + 1,
  });
  const msgs = await db
    .select()
    .from(advisorMessages)
    .where(eq(advisorMessages.conversationId, convId))
    .all();
  expect(msgs).toHaveLength(2);
  expect(msgs.find((m) => m.role === "user")).toMatchObject({ provider: null, model: null });
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test -w worker -- advisor-schema`. Expected: FAIL (tables not exported).

- [ ] **Step 3: Implement.** In `worker/src/db/schema.ts`, after `petInvites`, add:

```ts
export const userAiSettings = sqliteTable("user_ai_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["anthropic", "openai", "gemini"] }).notNull(),
  model: text("model").notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const advisorConversations = sqliteTable(
  "advisor_conversations",
  {
    id: text("id").primaryKey(),
    petId: text("pet_id")
      .notNull()
      .references(() => pets.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_advisor_conversations_pet").on(t.petId, t.updatedAt)],
);

export const advisorMessages = sqliteTable(
  "advisor_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => advisorConversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    provider: text("provider"),
    model: text("model"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_advisor_messages_conversation").on(t.conversationId, t.createdAt)],
);
```

Extend `auditLog.entity` enum with `"advisor"` (now: `["activity","pet","schedule","preset","member","invite","advisor"]`) and widen the union in `worker/src/domain/audit.ts` to match. Add type exports at the bottom:

```ts
export type UserAiSettings = typeof userAiSettings.$inferSelect;
export type AdvisorConversation = typeof advisorConversations.$inferSelect;
export type AdvisorMessage = typeof advisorMessages.$inferSelect;
```

In `worker/src/env.ts`, add `ADVISOR_KEK: string;` to `Env`. In `worker/vitest.config.ts` miniflare bindings, add:

```ts
              ADVISOR_KEK: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
```

(32 zero bytes, base64 — fine for tests.)

- [ ] **Step 4: Generate the migration** — `npm run db:generate -w worker -- --name=add-advisor`. Expected: `worker/drizzle/0003_add-advisor.sql` containing ONLY the three new tables + their two indexes. The audit enum change emits no SQL. **If anything else appears, STOP and report.**

- [ ] **Step 5: Verify** — `npm run test -w worker -- advisor-schema` PASS, then `npm run typecheck -w worker && npm run test -w worker` all green.

- [ ] **Step 6: Commit**

```bash
git add worker/src/db/schema.ts worker/src/domain/audit.ts worker/src/env.ts worker/vitest.config.ts worker/drizzle worker/test/advisor-schema.test.ts
git commit -m "feat: add advisor tables, audit entity, and kek binding

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Shared types & schemas

**Files:** Modify `shared/src/index.ts`.

- [ ] **Step 1: Add to `shared/src/index.ts`.** After the `INVITE_ROLES` block:

```ts
export const AI_PROVIDERS = ["anthropic", "openai", "gemini"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Pre-filled (editable) default model per provider. */
export const AI_DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-opus-4-8",
  openai: "gpt-4o",
  gemini: "gemini-2.0-flash",
};
```

Near the other schemas:

```ts
export const putAdvisorSettingsSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS),
    model: z.string().min(1).max(100),
    apiKey: z.string().min(1).max(512),
  })
  .strict();
export type PutAdvisorSettingsInput = z.infer<typeof putAdvisorSettingsSchema>;

export const advisorChatSchema = z
  .object({
    message: z.string().min(1).max(4000),
    tz: z.number().int().min(-840).max(840).default(0),
    locale: z.enum(["en", "ja"]).default("en"),
  })
  .strict();
export type AdvisorChatInput = z.infer<typeof advisorChatSchema>;
```

With the response types:

```ts
/** `settings` is null when the user has not configured a key. The key itself never appears in any response. */
export type AdvisorSettingsResponse = {
  settings: { provider: AiProvider; model: string } | null;
};

export type AdvisorConversationSummary = {
  id: string;
  title: string;
  createdByName: string | null;
  updatedAt: number;
};

export type AdvisorMessageView = {
  id: string;
  role: "user" | "assistant";
  content: string;
  authorName: string | null;
  provider: string | null;
  model: string | null;
  createdAt: number;
};

export type AdvisorConversationDetail = {
  id: string;
  title: string;
  createdByName: string | null;
  updatedAt: number;
  messages: AdvisorMessageView[];
};
```

- [ ] **Step 2: Verify** — `npm run typecheck`. Clean.

- [ ] **Step 3: Commit**

```bash
git add shared/src/index.ts
git commit -m "feat: add advisor schemas and types to shared

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: keycrypt (AES-GCM-256)

**Files:**
- Create: `worker/src/lib/keycrypt.ts`
- Test: `worker/test/keycrypt.test.ts` (new)

- [ ] **Step 1: Write the failing tests.** Create `worker/test/keycrypt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decryptKey, encryptKey } from "../src/lib/keycrypt";

const KEK = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 32 zero bytes
const OTHER_KEK = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="; // 32 0x01 bytes

describe("keycrypt", () => {
  it("round-trips a secret", async () => {
    const ct = await encryptKey("sk-ant-very-secret", KEK);
    expect(ct).not.toContain("sk-ant");
    expect(await decryptKey(ct, KEK)).toBe("sk-ant-very-secret");
  });

  it("produces a different ciphertext per call (random iv)", async () => {
    const a = await encryptKey("same", KEK);
    const b = await encryptKey("same", KEK);
    expect(a).not.toBe(b);
  });

  it("rejects tampered ciphertext and wrong keys", async () => {
    const ct = await encryptKey("secret", KEK);
    const tampered = ct.slice(0, -4) + (ct.endsWith("AAA=") ? "BBB=" : "AAA=");
    await expect(decryptKey(tampered, KEK)).rejects.toThrow();
    await expect(decryptKey(ct, OTHER_KEK)).rejects.toThrow();
  });

  it("rejects a malformed kek", async () => {
    await expect(encryptKey("x", "not-base64-32-bytes")).rejects.toThrow(/ADVISOR_KEK/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test -w worker -- keycrypt`. FAIL (module missing).

- [ ] **Step 3: Implement.** Create `worker/src/lib/keycrypt.ts`:

```ts
/**
 * AES-GCM-256 encryption for BYO provider API keys at rest.
 * Wire format: base64( iv(12 bytes) ‖ ciphertext+tag ).
 * The KEK comes from the ADVISOR_KEK secret (32-byte base64).
 */

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function importKek(kekBase64: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = b64decode(kekBase64);
  } catch {
    throw new Error("ADVISOR_KEK is not valid base64");
  }
  if (raw.length !== 32) {
    throw new Error("ADVISOR_KEK must decode to exactly 32 bytes");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptKey(plaintext: string, kekBase64: string): Promise<string> {
  const key = await importKek(kekBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
  );
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv);
  packed.set(ct, iv.length);
  return b64encode(packed);
}

export async function decryptKey(packedBase64: string, kekBase64: string): Promise<string> {
  const key = await importKek(kekBase64);
  const packed = b64decode(packedBase64);
  const iv = packed.slice(0, 12);
  const ct = packed.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}
```

- [ ] **Step 4: Verify** — keycrypt tests PASS; `npm run typecheck -w worker && npm run test -w worker` green.

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/keycrypt.ts worker/test/keycrypt.test.ts
git commit -m "feat: add aes-gcm keycrypt for provider api keys

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Advisor settings routes

**Files:**
- Create: `worker/src/routes/advisor-settings.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/advisor-settings.test.ts` (new)

- [ ] **Step 1: Write the failing tests.** Create `worker/test/advisor-settings.test.ts`:

```ts
import { env, SELF } from "cloudflare:test";
import type { AdvisorSettingsResponse } from "@pawary/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { userAiSettings } from "../src/db/schema";
import { decryptKey } from "../src/lib/keycrypt";
import { authHeaders, seedUserWithSession } from "./helpers";

const KEK = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

async function putSettings(auth: { cookie: string; csrfToken: string }, body: unknown) {
  return SELF.fetch("https://app.local/api/me/advisor", {
    method: "PUT",
    headers: authHeaders(auth.cookie, auth.csrfToken),
    body: JSON.stringify(body),
  });
}

it("PUT stores an encrypted key; GET never returns it; key is recoverable server-side", async () => {
  const auth = await seedUserWithSession();
  const res = await putSettings(auth, {
    provider: "anthropic",
    model: "claude-opus-4-8",
    apiKey: "sk-ant-test-12345",
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: AdvisorSettingsResponse };
  expect(body.data.settings).toEqual({ provider: "anthropic", model: "claude-opus-4-8" });
  expect(JSON.stringify(body)).not.toContain("sk-ant");

  const get = await SELF.fetch("https://app.local/api/me/advisor", {
    headers: { Cookie: auth.cookie },
  });
  const getBody = (await get.json()) as { data: AdvisorSettingsResponse };
  expect(getBody.data.settings).toEqual({ provider: "anthropic", model: "claude-opus-4-8" });
  expect(JSON.stringify(getBody)).not.toContain("sk-ant");

  const db = drizzle(env.DB);
  const row = await db
    .select()
    .from(userAiSettings)
    .where(eq(userAiSettings.userId, auth.userId))
    .get();
  expect(row!.encryptedKey).not.toContain("sk-ant");
  expect(await decryptKey(row!.encryptedKey, KEK)).toBe("sk-ant-test-12345");
});

it("PUT upserts (provider switch replaces) and validates the body", async () => {
  const auth = await seedUserWithSession();
  await putSettings(auth, { provider: "anthropic", model: "claude-opus-4-8", apiKey: "k1" });
  const res = await putSettings(auth, { provider: "gemini", model: "gemini-2.0-flash", apiKey: "k2" });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: AdvisorSettingsResponse };
  expect(body.data.settings!.provider).toBe("gemini");

  for (const bad of [
    { provider: "grok", model: "x", apiKey: "k" },
    { provider: "openai", model: "", apiKey: "k" },
    { provider: "openai", model: "gpt-4o", apiKey: "" },
    { provider: "openai", model: "gpt-4o", apiKey: "k", extra: true },
  ]) {
    expect((await putSettings(auth, bad)).status).toBe(400);
  }
});

it("GET returns null settings when unconfigured; DELETE removes; auth required", async () => {
  const auth = await seedUserWithSession();
  const empty = await SELF.fetch("https://app.local/api/me/advisor", {
    headers: { Cookie: auth.cookie },
  });
  expect(((await empty.json()) as { data: AdvisorSettingsResponse }).data.settings).toBeNull();

  await putSettings(auth, { provider: "openai", model: "gpt-4o", apiKey: "k" });
  const del = await SELF.fetch("https://app.local/api/me/advisor", {
    method: "DELETE",
    headers: authHeaders(auth.cookie, auth.csrfToken),
  });
  expect(del.status).toBe(200);
  const after = await SELF.fetch("https://app.local/api/me/advisor", {
    headers: { Cookie: auth.cookie },
  });
  expect(((await after.json()) as { data: AdvisorSettingsResponse }).data.settings).toBeNull();

  expect((await SELF.fetch("https://app.local/api/me/advisor")).status).toBe(401);
});
```

- [ ] **Step 2: Run to verify failure** — `npm run test -w worker -- advisor-settings`. FAIL with 404s.

- [ ] **Step 3: Implement.** Create `worker/src/routes/advisor-settings.ts`:

```ts
import type { AdvisorSettingsResponse } from "@pawary/shared";
import { putAdvisorSettingsSchema } from "@pawary/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { userAiSettings } from "../db/schema";
import type { AppEnv } from "../env";
import { encryptKey } from "../lib/keycrypt";
import { err } from "../lib/respond";
import { requireCsrf } from "../middleware/csrf";
import { requireSession } from "../middleware/session";

export const advisorSettingsRoutes = new Hono<AppEnv>();

advisorSettingsRoutes.get("/api/me/advisor", requireSession, async (c) => {
  const db = drizzle(c.env.DB);
  const row = await db
    .select({ provider: userAiSettings.provider, model: userAiSettings.model })
    .from(userAiSettings)
    .where(eq(userAiSettings.userId, c.get("user").id))
    .get();
  return c.json({ data: { settings: row ?? null } satisfies AdvisorSettingsResponse });
});

advisorSettingsRoutes.put("/api/me/advisor", requireSession, requireCsrf, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = putAdvisorSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return err(c, 400, "validation", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const user = c.get("user");
  const db = drizzle(c.env.DB);
  const now = Date.now();
  const encryptedKey = await encryptKey(parsed.data.apiKey, c.env.ADVISOR_KEK);
  await db
    .insert(userAiSettings)
    .values({
      userId: user.id,
      provider: parsed.data.provider,
      model: parsed.data.model,
      encryptedKey,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userAiSettings.userId,
      set: {
        provider: parsed.data.provider,
        model: parsed.data.model,
        encryptedKey,
        updatedAt: now,
      },
    });
  return c.json({
    data: {
      settings: { provider: parsed.data.provider, model: parsed.data.model },
    } satisfies AdvisorSettingsResponse,
  });
});

advisorSettingsRoutes.delete("/api/me/advisor", requireSession, requireCsrf, async (c) => {
  const db = drizzle(c.env.DB);
  await db.delete(userAiSettings).where(eq(userAiSettings.userId, c.get("user").id));
  return c.json({ data: { ok: true } });
});
```

Mount in `worker/src/index.ts`: `import { advisorSettingsRoutes } from "./routes/advisor-settings";` and `app.route("/", advisorSettingsRoutes);` with the other mounts.

- [ ] **Step 4: Verify** — settings tests PASS; full suite + typecheck green.

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/advisor-settings.ts worker/src/index.ts worker/test/advisor-settings.test.ts
git commit -m "feat: advisor settings endpoints with encrypted byo key

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Provider adapters + SSE parser

**Files:**
- Create: `worker/src/domain/advisor/providers.ts`
- Test: `worker/test/advisor-providers.test.ts` (new)

- [ ] **Step 1: Write the failing tests.** Before writing, read `worker/test/oauth.test.ts` for the repo's `fetchMock` setup pattern and mirror it. Create `worker/test/advisor-providers.test.ts`:

```ts
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

  it("maps 429 to provider_overloaded and ignores malformed data lines", async () => {
    fetchMock
      .get("https://api.anthropic.com")
      .intercept({ path: "/v1/messages", method: "POST" })
      .reply(429, "rate limited");
    const e = await collect(streamProvider("anthropic", OPTS)).catch((x) => x);
    expect((e as AdvisorProviderError).code).toBe("provider_overloaded");

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
});
```

(If the gemini `query` matcher does not match in this undici version, intercept with `path: "/v1beta/models/test-model:streamGenerateContent?alt=sse"` instead — verify against how oauth.test.ts matches.)

- [ ] **Step 2: Run to verify failure** — FAIL (module missing).

- [ ] **Step 3: Implement.** Create `worker/src/domain/advisor/providers.ts`:

```ts
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
```

- [ ] **Step 4: Verify** — provider tests PASS (fix the gemini interceptor form if needed); full suite + typecheck green. If `fetchMock.disableNetConnect()` breaks OTHER test files when run together (it is process-global), scope it: use `fetchMock.activate()` in `beforeAll` and `fetchMock.deactivate?.()` — follow whatever oauth.test.ts does; if oauth.test.ts has no deactivation and the full suite is green, leave as-is.

- [ ] **Step 5: Commit**

```bash
git add worker/src/domain/advisor/providers.ts worker/test/advisor-providers.test.ts
git commit -m "feat: streaming provider adapters for anthropic, openai, gemini

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Context builder

**Files:**
- Create: `worker/src/domain/advisor/context.ts`
- Test: `worker/test/advisor-context.test.ts` (new)

- [ ] **Step 1: Write the failing tests.** Create `worker/test/advisor-context.test.ts`:

```ts
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { buildAdvisorSystemPrompt } from "../src/domain/advisor/context";
import { seedActivity, seedPet, seedSchedule, seedUserWithSession } from "./helpers";
import { pets } from "../src/db/schema";
import { eq } from "drizzle-orm";

async function petRow(petId: string) {
  const db = drizzle(env.DB);
  return (await db.select().from(pets).where(eq(pets.id, petId)).get())!;
}

it("includes persona, profile, digest and the disclaimer; localizes", async () => {
  const { userId } = await seedUserWithSession();
  const { petId } = await seedPet(userId, "owner", { name: "Momo", species: "cat" });
  const now = Date.now();
  await seedActivity(petId, userId, { category: "weight", details: { kg: 4.2 }, occurredAt: now - 86400_000 });
  await seedActivity(petId, userId, { category: "symptom", details: { name: "sneezing", severity: "mild" }, occurredAt: now - 3600_000 });
  await seedActivity(petId, userId, { category: "food", details: { amount: 50, unit: "g" }, occurredAt: now - 7200_000 });
  await seedSchedule(petId, { name: "Rabies booster", nextDueAt: now + 86400_000 });

  const db = drizzle(env.DB);
  const en = await buildAdvisorSystemPrompt(db, await petRow(petId), 0, "en");
  expect(en).toContain("Momo");
  expect(en).toContain("not a veterinarian");
  expect(en).toContain("sneezing");
  expect(en).toContain("4.2");
  expect(en).toContain("Rabies booster");

  const ja = await buildAdvisorSystemPrompt(db, await petRow(petId), 540, "ja");
  expect(ja).toContain("獣医師ではありません");
  expect(ja).toContain("Momo");
});

it("caps the assembled prompt at 6000 chars", async () => {
  const { userId } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const now = Date.now();
  for (let i = 0; i < 80; i++) {
    await seedActivity(petId, userId, {
      category: "symptom",
      details: { name: `very-long-symptom-name-${"x".repeat(60)}-${i}`, severity: "mild" },
      occurredAt: now - i * 3600_000,
    });
  }
  const db = drizzle(env.DB);
  const prompt = await buildAdvisorSystemPrompt(db, (await petRow(petId))!, 0, "en");
  expect(prompt.length).toBeLessThanOrEqual(6000);
  expect(prompt).toContain("not a veterinarian"); // persona survives truncation
});
```

- [ ] **Step 2: Run to verify failure** — FAIL (module missing).

- [ ] **Step 3: Implement.** Create `worker/src/domain/advisor/context.ts`. Requirements (write clean code to these; structure is up to you but keep it one module):

- Signature: `buildAdvisorSystemPrompt(db: DrizzleD1Database, pet: Pet, tzOffsetMin: number, locale: "en" | "ja"): Promise<string>`.
- Queries (all scoped to `pet.id`, `deletedAt IS NULL`, last 30 days by `occurredAt`):
  - per-category counts (single select of category+occurredAt, counted in JS);
  - weight entries (category `weight`, `details.kg`), keep latest 10, compute latest value and delta vs oldest kept;
  - recent `symptom` / `medication` / `vet_visit` rows, newest 15 each, rendering `details.name ?? details.reason ?? ""` + household date (`occurredAt + tzOffsetMin*60000`, read via UTC getters as `YYYY-MM-DD`);
  - active care schedules (name + `nextDueAt` as household date);
  - `pet_targets` row if present.
- Profile: name, species, breed?, sex?, age derived from `pet.birthday` (years and months, omit if null).
- Persona + disclaimer, localized (inline `const STRINGS = { en: {...}, ja: {...} }` in the module): the assistant is a helpful pet-care assistant for the user's pet; it is **"not a veterinarian"** (EN) / **「獣医師ではありません」** (JA must contain exactly that substring); urgent or worsening symptoms → see a vet; answer in the user's language; today's household date included.
- Assembly order: persona → profile → digest sections. If total exceeds **6000 chars**, drop digest lines from the END until it fits (never truncate persona/profile mid-sentence).

- [ ] **Step 4: Verify** — context tests PASS; full suite + typecheck green.

- [ ] **Step 5: Commit**

```bash
git add worker/src/domain/advisor/context.ts worker/test/advisor-context.test.ts
git commit -m "feat: advisor context builder with 30-day pet digest

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Conversation read/delete routes

**Files:**
- Create: `worker/src/routes/advisor.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/advisor-conversations.test.ts` (new)

- [ ] **Step 1: Write the failing tests.** Create `worker/test/advisor-conversations.test.ts` with a local seed helper (direct drizzle inserts into `advisorConversations`/`advisorMessages`, modeled on Task 1's test) and these cases:

1. `GET /api/pets/:petId/advisor/conversations` (viewer ok): returns summaries newest-`updatedAt`-first with `createdByName` from the users join; a conversation whose `createdBy` is null shows `createdByName: null`. Non-member → 404.
2. `GET /api/pets/:petId/advisor/conversations/:id`: returns detail with messages oldest-first including `authorName`, `provider`, `model`. Unknown id or id belonging to a DIFFERENT pet → 404 (scope check is `petId` + `id`).
3. `DELETE .../conversations/:id` as editor → 200, rows gone (messages cascade — assert count 0), audit row `{entity: "advisor", action: "delete"}` whose `diff` contains the title and does NOT contain message content. As viewer → 403. Unknown id → 404.

Write the full test code following the established style (SELF.fetch, authHeaders, seedPet, withMember).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** Create `worker/src/routes/advisor.ts` with `export const advisorRoutes = new Hono<AppEnv>();` and the three routes:

- `GET /api/pets/:petId/advisor/conversations` — `requireSession, requirePetRole("viewer")`. Select conversations LEFT JOIN users on `createdBy` (`leftJoin` — createdBy is nullable), project `{id, title, createdByName: users.displayName, updatedAt}`, `.orderBy(desc(advisorConversations.updatedAt))`. Map `createdByName: r.createdByName ?? null` and return `satisfies AdvisorConversationSummary[]`.
- `GET /api/pets/:petId/advisor/conversations/:conversationId` — same middleware. First fetch the conversation by `and(eq(id), eq(petId))` → 404 if missing; then messages LEFT JOIN users on `authorId`, ordered by `createdAt asc, id asc`; return `AdvisorConversationDetail`.
- `DELETE /api/pets/:petId/advisor/conversations/:conversationId` — `requireSession, requireCsrf, requirePetRole("editor")`. Fetch by id+petId → 404; delete (messages cascade); `writeAudit` `{action: "delete", entity: "advisor", entityId: conversationId, diff: {title: conv.title}}`; `{data:{ok:true}}`.

Mount `advisorRoutes` in `worker/src/index.ts`.

- [ ] **Step 4: Verify** — tests PASS; full suite + typecheck green.

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/advisor.ts worker/src/index.ts worker/test/advisor-conversations.test.ts
git commit -m "feat: advisor conversation list, detail, and audited delete

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Streaming chat endpoints

**Files:**
- Modify: `worker/src/routes/advisor.ts`
- Test: `worker/test/advisor-chat.test.ts` (new)

- [ ] **Step 1: Write the failing tests.** Create `worker/test/advisor-chat.test.ts`. Setup: fetchMock as in Task 5; helper `configureAdvisor(auth)` that PUTs anthropic settings (key `sk-test`); helper `mockAnthropicStream(chunks: string[])` that intercepts `https://api.anthropic.com/v1/messages` replying with a well-formed SSE body of `content_block_delta` events. Cases:

1. **Create + stream:** editor POSTs `{message: "Is Momo ok?", tz: 540, locale: "en"}` to `/api/pets/:petId/advisor/conversations` with mocked chunks `["She ", "seems ", "fine."]`. Assert: status 200; `content-type` starts with `text/event-stream`; body text contains three `event: delta` blocks in order and one `event: done` whose JSON has `conversationId` and `messageId`. Then assert DB state: 1 conversation (title `"Is Momo ok?"`, updatedAt ≥ createdAt), 2 messages — user row `{content: "Is Momo ok?", authorId: editorId, provider: null}` and assistant row `{content: "She seems fine.", provider: "anthropic", model: <configured>, authorId: editorId}`. Audit: one `{entity:"advisor", action:"create"}` row with diff title only.
2. **Append:** second POST to `.../conversations/:id/messages` with mocked chunks; assert 4 messages total and that the provider request body (captured via the interceptor — assert with a body matcher or by `.intercept({..., body: (b) => {...}})`; if body matching is awkward in this undici version, skip request-body assertions and instead assert the response/done event) — at minimum assert the second exchange streamed and persisted.
3. **Unconfigured:** member with no settings → POST returns 409 JSON `{error:{code:"advisor_not_configured"}}` (no SSE).
4. **Provider auth failure:** mock 401; POST response is SSE containing `event: error` with `"code":"provider_auth"`; the USER message is persisted, NO assistant message row exists.
5. **Mid-stream failure with partial:** mock an SSE body that emits one text_delta then garbage/closes (e.g. reply body = one delta event + truncated bytes, no closing). If truncation is hard to simulate with fetchMock, simulate instead: one delta then HTTP body ends normally — that's a clean end; in that case keep the partial-persistence assertion focused on the error path: reply(200) with ONLY non-delta junk lines → stream yields nothing → assistant message must NOT be persisted and `done` still fires with an empty-content guard? **Decide in implementation: empty assistant text at clean stream end → persist nothing, emit `error` `{code:"provider_error"}` instead of `done`.** Test exactly that: junk-only 200 stream → `event: error` present, no assistant row.
6. **Authz:** viewer POST → 403; non-member → 404; missing conversation id on append → 404 (emitted as JSON, before streaming starts).
7. **Validation:** empty message → 400; message > 4000 chars → 400.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.** In `worker/src/routes/advisor.ts` add imports (`advisorChatSchema`, `streamSSE` from `hono/streaming`, `decryptKey`, `streamProvider`, `AdvisorProviderError`, `buildAdvisorSystemPrompt`, `userAiSettings`, `rateLimit`, `newId`) and a shared handler:

```ts
const HISTORY_LIMIT = 20;
const TITLE_MAX = 80;

async function loadAdvisorConfig(db: DrizzleD1Database, userId: string) {
  return db.select().from(userAiSettings).where(eq(userAiSettings.userId, userId)).get();
}
```

Routes (both: `requireSession, requireCsrf, requirePetRole("editor"), rateLimit("advisor-chat", 20, 300_000, "user")`):

- `POST /api/pets/:petId/advisor/conversations` — validate body; load config → 409 `advisor_not_configured` if absent; create conversation `{id: newId(), petId, title: message.slice(0, TITLE_MAX), createdBy: user.id, createdAt: now, updatedAt: now}`; audit `{action:"create", entity:"advisor", entityId: id, diff:{title}}`; then `return chatAndStream(c, conversation, parsed.data)`.
- `POST /api/pets/:petId/advisor/conversations/:conversationId/messages` — validate; load conversation by id+petId → 404; load config → 409; `return chatAndStream(...)`.

`chatAndStream(c, conversation, input)`:

```ts
async function chatAndStream(
  c: Context<AppEnv>,
  conversation: AdvisorConversation,
  input: AdvisorChatInput,
) {
  const db = drizzle(c.env.DB);
  const user = c.get("user");
  const config = (await loadAdvisorConfig(db, user.id))!;
  const now = Date.now();

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
```

Note: the decrypted `apiKey` exists only in this request scope and must never be logged or included in any error message.

- [ ] **Step 4: Verify** — chat tests PASS; full suite + typecheck green. If `streamSSE`'s response races test reading, `await res.text()` after completion is sufficient (workerd buffers finished bodies).

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/advisor.ts worker/test/advisor-chat.test.ts
git commit -m "feat: streaming advisor chat endpoints with normalized sse

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Export inclusion + README note

**Files:**
- Modify: `worker/src/routes/export.ts`, `README.md`
- Test: `worker/test/export.test.ts` (extend)

- [ ] **Step 1: Failing test.** In `worker/test/export.test.ts`, add a test that seeds a conversation + 2 messages (direct inserts), hits `GET /api/pets/:petId/export?format=json`, and asserts the payload has `advisorConversations: [{...conversation, messages: [...]}]` with both messages; and that `GET /api/me/export` includes the same under the owning pet entry.

- [ ] **Step 2: Verify failure.**

- [ ] **Step 3: Implement.** In `worker/src/routes/export.ts`, for both endpoints, after loading activities, load `advisorConversations` rows for the pet and their `advisorMessages` (single `inArray` query, grouped in JS), and attach `advisorConversations: conversations.map((conv) => ({ ...conv, messages: byConversation.get(conv.id) ?? [] }))` to the pet payload. CSV format is unchanged (activities only).

In `README.md` § Deployment, add one line after the secrets sentence: `` The AI Advisor additionally requires `ADVISOR_KEK` (32-byte base64, e.g. `openssl rand -base64 32`): `npx wrangler secret put ADVISOR_KEK --env production`; local dev reads it from `worker/.dev.vars`. ``

- [ ] **Step 4: Verify** — export tests PASS; full suite + typecheck green.

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/export.ts worker/test/export.test.ts README.md
git commit -m "feat: include advisor conversations in exports and document kek

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Final verification sweep

- [ ] **Step 1:** `npm run typecheck && npm test && npm run build` from the repo root — all green.
- [ ] **Step 2:** Spec sweep against `docs/superpowers/specs/2026-06-12-ai-advisor-design.md` §3 (tables), §4 (every endpoint, the SSE contract, persistence order, rate limit, 409 code, audit), §6 (export), §7 (test list). The §5 app items belong to Plan 09 — out of scope here. Report any gap.
- [ ] **Step 3:** `git status` clean; report completion. DO NOT push, merge, or deploy.
