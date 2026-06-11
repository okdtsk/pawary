import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";
import {
  seedActivity,
  seedPet,
  seedUserWithSession,
  withMember,
} from "./helpers";

it("GET /api/me/export returns owner pets with flagged soft-deleted activities", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId, "owner", { name: "Momo" });
  await seedActivity(petId, userId, { memo: "alive" });
  await seedActivity(petId, userId, { memo: "ghost", deletedAt: Date.now() });

  // a pet where the caller is only a viewer must NOT be exported
  const other = await seedUserWithSession({ email: "o@example.com" });
  const { petId: viewedPet } = await seedPet(other.userId);
  await withMember(viewedPet, userId, "viewer");

  const res = await SELF.fetch("https://app.local/api/me/export", {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Disposition")).toContain("attachment");
  const body = (await res.json()) as {
    user: { id: string };
    pets: Array<{
      pet: { id: string; name: string };
      activities: Array<{ memo: string | null; deleted: boolean }>;
    }>;
  };
  expect(body.user.id).toBe(userId);
  expect(body.pets).toHaveLength(1);
  expect(body.pets[0]?.pet.name).toBe("Momo");
  const activities = body.pets[0]!.activities;
  expect(activities.find((a) => a.memo === "alive")?.deleted).toBe(false);
  expect(activities.find((a) => a.memo === "ghost")?.deleted).toBe(true);
});

it("GET /api/pets/:petId/export?format=json works for viewers", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  await seedActivity(petId, owner.userId, { memo: "hello" });

  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/export?format=json`,
    { headers: { Cookie: viewer.cookie } },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    pet: { id: string };
    activities: unknown[];
    photos: unknown[];
  };
  expect(body.pet.id).toBe(petId);
  expect(body.activities).toHaveLength(1);
  expect(body.photos).toEqual([]);
});

it("CSV export escapes fields and excludes soft-deleted rows", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  await seedActivity(petId, userId, {
    category: "note",
    occurredAt: Date.UTC(2026, 0, 1, 12, 0),
    tzOffsetMin: 540,
    memo: 'ate "everything", then napped',
  });
  await seedActivity(petId, userId, {
    memo: "ghost",
    deletedAt: Date.now(),
  });

  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/export?format=csv`,
    { headers: { Cookie: cookie } },
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toContain("text/csv");
  const text = await res.text();
  const lines = text.trim().split("\r\n");
  expect(lines[0]).toBe("id,category,occurred_at,memo,details");
  expect(lines).toHaveLength(2); // header + 1 live row
  expect(lines[1]).toContain('"ate ""everything"", then napped"');
  expect(lines[1]).toContain("2026-01-01T21:00:00.000+09:00");
  expect(text).not.toContain("ghost");
});

it("rejects unknown formats and non-members", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const bad = await SELF.fetch(
    `https://app.local/api/pets/${petId}/export?format=xml`,
    { headers: { Cookie: cookie } },
  );
  expect(bad.status).toBe(400);

  const outsider = await seedUserWithSession({ email: "eve@example.com" });
  const denied = await SELF.fetch(
    `https://app.local/api/pets/${petId}/export?format=json`,
    { headers: { Cookie: outsider.cookie } },
  );
  expect(denied.status).toBe(404);
});
