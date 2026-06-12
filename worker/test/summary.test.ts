import { SELF } from "cloudflare:test";
import type { DaySummaryResponse } from "@pawary/shared";
import { expect, it } from "vitest";
import { seedActivity, seedPet, seedUserWithSession } from "./helpers";

async function summary(petId: string, cookie: string, month: string) {
  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/summary?month=${month}`,
    { headers: { Cookie: cookie } },
  );
  return { status: res.status, body: (await res.json()) as { data: DaySummaryResponse } };
}

it("counts per day per category in household time", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  // Mar 10 2026, 10:00 UTC, JST (+540) → Mar 10 19:00 household
  const base = Date.UTC(2026, 2, 10, 10, 0);
  await seedActivity(petId, userId, { category: "food", occurredAt: base, tzOffsetMin: 540 });
  await seedActivity(petId, userId, { category: "food", occurredAt: base + 3600_000, tzOffsetMin: 540 });
  await seedActivity(petId, userId, { category: "water", occurredAt: base, tzOffsetMin: 540 });

  const { status, body } = await summary(petId, cookie, "2026-03");
  expect(status).toBe(200);
  expect(body.data.month).toBe("2026-03");
  expect(body.data.days["2026-03-10"]).toEqual({ food: 2, water: 1 });
});

it("tz boundary: 23:30 household lands on the local day, 00:30 on the next", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  // Mar 1 14:30 UTC + 9h = Mar 1 23:30 household (JST)
  await seedActivity(petId, userId, {
    category: "note",
    occurredAt: Date.UTC(2026, 2, 1, 14, 30),
    tzOffsetMin: 540,
  });
  // Mar 1 15:30 UTC + 9h = Mar 2 00:30 household
  await seedActivity(petId, userId, {
    category: "note",
    occurredAt: Date.UTC(2026, 2, 1, 15, 30),
    tzOffsetMin: 540,
  });

  const { body } = await summary(petId, cookie, "2026-03");
  expect(body.data.days["2026-03-01"]).toEqual({ note: 1 });
  expect(body.data.days["2026-03-02"]).toEqual({ note: 1 });
});

it("negative offset: early-UTC March activity belongs to February locally", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  // Mar 1 02:00 UTC - 5h = Feb 28 21:00 household (EST-like)
  await seedActivity(petId, userId, {
    category: "note",
    occurredAt: Date.UTC(2026, 2, 1, 2, 0),
    tzOffsetMin: -300,
  });

  const march = await summary(petId, cookie, "2026-03");
  expect(march.body.data.days).toEqual({});

  const feb = await summary(petId, cookie, "2026-02");
  expect(feb.body.data.days["2026-02-28"]).toEqual({ note: 1 });
});

it("excludes soft-deleted activities and validates the month param", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  await seedActivity(petId, userId, {
    category: "note",
    occurredAt: Date.UTC(2026, 2, 5, 12, 0),
    tzOffsetMin: 0,
    deletedAt: Date.now(),
  });
  const { body } = await summary(petId, cookie, "2026-03");
  expect(body.data.days).toEqual({});

  for (const month of ["2026-13", "2026-3", "march", ""]) {
    const res = await SELF.fetch(
      `https://app.local/api/pets/${petId}/summary?month=${month}`,
      { headers: { Cookie: cookie } },
    );
    expect(res.status).toBe(400);
  }
});

it("summary is 404 for non-members", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const outsider = await seedUserWithSession({ email: "eve@example.com" });
  const { status } = await summary(petId, outsider.cookie, "2026-03");
  expect(status).toBe(404);
});
