import { env, SELF } from "cloudflare:test";
import type { PresetResponse } from "@pawlog/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { expect, it } from "vitest";
import { auditLog } from "../src/db/schema";
import {
  authHeaders,
  seedPet,
  seedUserWithSession,
  withMember,
} from "./helpers";

async function createPreset(
  petId: string,
  cookie: string,
  csrfToken: string,
  body: unknown,
) {
  return SELF.fetch(`https://app.local/api/pets/${petId}/presets`, {
    method: "POST",
    headers: authHeaders(cookie, csrfToken),
    body: JSON.stringify(body),
  });
}

it("CRUD round-trip with sort order and audit rows", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);

  const a = await createPreset(petId, cookie, csrfToken, {
    category: "food",
    label: "Morning kibble",
    details: { foodType: "dry", unit: "g", amount: 50 },
    sortOrder: 2,
  });
  expect(a.status).toBe(201);
  const presetA = ((await a.json()) as { data: PresetResponse }).data;

  const b = await createPreset(petId, cookie, csrfToken, {
    category: "water",
    label: "Bowl refill",
    details: { amountMl: 200 },
    sortOrder: 1,
  });
  expect(b.status).toBe(201);

  // list ordered by sortOrder asc
  const listed = await SELF.fetch(`https://app.local/api/pets/${petId}/presets`, {
    headers: { Cookie: cookie },
  });
  expect(listed.status).toBe(200);
  const items = ((await listed.json()) as { data: PresetResponse[] }).data;
  expect(items.map((p) => p.label)).toEqual(["Bowl refill", "Morning kibble"]);

  // patch label + details
  const patched = await SELF.fetch(
    `https://app.local/api/pets/${petId}/presets/${presetA.id}`,
    {
      method: "PATCH",
      headers: authHeaders(cookie, csrfToken),
      body: JSON.stringify({
        label: "Evening kibble",
        details: { foodType: "dry", unit: "g", amount: 40 },
      }),
    },
  );
  expect(patched.status).toBe(200);
  expect(((await patched.json()) as { data: PresetResponse }).data.label).toBe(
    "Evening kibble",
  );

  // delete
  const deleted = await SELF.fetch(
    `https://app.local/api/pets/${petId}/presets/${presetA.id}`,
    { method: "DELETE", headers: authHeaders(cookie, csrfToken) },
  );
  expect(deleted.status).toBe(200);
  const after = await SELF.fetch(`https://app.local/api/pets/${petId}/presets`, {
    headers: { Cookie: cookie },
  });
  expect(((await after.json()) as { data: PresetResponse[] }).data).toHaveLength(1);

  const db = drizzle(env.DB);
  const audits = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.petId, petId))
    .all();
  const presetAudits = audits.filter((x) => x.entity === "preset");
  expect(presetAudits.map((x) => x.action).sort()).toEqual([
    "create",
    "create",
    "delete",
    "update",
  ]);
});

it("rejects details that do not match the preset category", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const res = await createPreset(petId, cookie, csrfToken, {
    category: "water",
    label: "Bad",
    details: { kg: 4 },
  });
  expect(res.status).toBe(400);

  const ok = await createPreset(petId, cookie, csrfToken, {
    category: "water",
    label: "Good",
    details: { amountMl: 100 },
  });
  const preset = ((await ok.json()) as { data: PresetResponse }).data;
  const patched = await SELF.fetch(
    `https://app.local/api/pets/${petId}/presets/${preset.id}`,
    {
      method: "PATCH",
      headers: authHeaders(cookie, csrfToken),
      body: JSON.stringify({ details: { kg: 4 } }), // wrong for water
    },
  );
  expect(patched.status).toBe(400);
});

it("authz: viewer can list but not mutate; non-member 404; cross-pet id 404", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const created = await createPreset(petId, owner.cookie, owner.csrfToken, {
    category: "note",
    label: "Nap",
  });
  const preset = ((await created.json()) as { data: PresetResponse }).data;

  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  const listed = await SELF.fetch(`https://app.local/api/pets/${petId}/presets`, {
    headers: { Cookie: viewer.cookie },
  });
  expect(listed.status).toBe(200);
  const asViewer = await createPreset(petId, viewer.cookie, viewer.csrfToken, {
    category: "note",
    label: "Nope",
  });
  expect(asViewer.status).toBe(403);

  const outsider = await seedUserWithSession({ email: "eve@example.com" });
  const asOutsider = await SELF.fetch(
    `https://app.local/api/pets/${petId}/presets`,
    { headers: { Cookie: outsider.cookie } },
  );
  expect(asOutsider.status).toBe(404);

  // preset id under a different pet → 404
  const { petId: otherPet } = await seedPet(owner.userId);
  const cross = await SELF.fetch(
    `https://app.local/api/pets/${otherPet}/presets/${preset.id}`,
    { method: "DELETE", headers: authHeaders(owner.cookie, owner.csrfToken) },
  );
  expect(cross.status).toBe(404);
});
