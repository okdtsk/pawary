import { SELF } from "cloudflare:test";
import type { ActivityListResponse } from "@pawary/shared";
import { expect, it } from "vitest";
import { seedActivity, seedPet, seedUserWithSession } from "./helpers";

async function list(petId: string, cookie: string, query = "") {
  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/activities${query}`,
    { headers: { Cookie: cookie } },
  );
  return { status: res.status, body: (await res.json()) as { data: ActivityListResponse } };
}

it("lists newest-first, excludes soft-deleted, default limit", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const t0 = 1_760_000_000_000;
  await seedActivity(petId, userId, { occurredAt: t0 + 1000, memo: "first" });
  await seedActivity(petId, userId, { occurredAt: t0 + 3000, memo: "third" });
  await seedActivity(petId, userId, { occurredAt: t0 + 2000, memo: "second" });
  await seedActivity(petId, userId, {
    occurredAt: t0 + 4000,
    memo: "ghost",
    deletedAt: Date.now(),
  });

  const { status, body } = await list(petId, cookie);
  expect(status).toBe(200);
  expect(body.data.items.map((a) => a.memo)).toEqual([
    "third",
    "second",
    "first",
  ]);
  expect(body.data.nextCursor).toBeNull();
});

it("filters by from/to and repeated category params", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const t0 = 1_760_000_000_000;
  await seedActivity(petId, userId, { category: "food", occurredAt: t0 + 1000 });
  await seedActivity(petId, userId, { category: "water", occurredAt: t0 + 2000 });
  await seedActivity(petId, userId, { category: "weight", occurredAt: t0 + 3000 });

  const byTime = await list(petId, cookie, `?from=${t0 + 1500}&to=${t0 + 2500}`);
  expect(byTime.body.data.items.map((a) => a.category)).toEqual(["water"]);

  const byCat = await list(petId, cookie, "?category=food&category=weight");
  expect(byCat.body.data.items.map((a) => a.category)).toEqual([
    "weight",
    "food",
  ]);

  const badCat = await SELF.fetch(
    `https://app.local/api/pets/${petId}/activities?category=nap`,
    { headers: { Cookie: cookie } },
  );
  expect(badCat.status).toBe(400);
});

it("q matches memo substrings; LIKE wildcards in q are literal", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  await seedActivity(petId, userId, { memo: "ate 100% of breakfast" });
  await seedActivity(petId, userId, { memo: "ate some breakfast" });
  await seedActivity(petId, userId, { memo: "walk in the park" });

  const sub = await list(petId, cookie, "?q=breakfast");
  expect(sub.body.data.items).toHaveLength(2);

  // "%" must match only the literal percent sign, not act as a wildcard
  const literal = await list(petId, cookie, `?q=${encodeURIComponent("100%")}`);
  expect(literal.body.data.items).toHaveLength(1);
  expect(literal.body.data.items[0]?.memo).toBe("ate 100% of breakfast");

  const underscore = await list(petId, cookie, `?q=${encodeURIComponent("_")}`);
  expect(underscore.body.data.items).toHaveLength(0);
});

it("paginates with stable cursors: no duplicates, no skips, id tiebreak", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const t0 = 1_760_000_000_000;
  // 5 activities; two share the same occurredAt to force the id tiebreak
  await seedActivity(petId, userId, { occurredAt: t0 + 1, memo: "a" });
  await seedActivity(petId, userId, { occurredAt: t0 + 2, memo: "b" });
  await seedActivity(petId, userId, { occurredAt: t0 + 3, memo: "c1" });
  await seedActivity(petId, userId, { occurredAt: t0 + 3, memo: "c2" });
  await seedActivity(petId, userId, { occurredAt: t0 + 4, memo: "d" });

  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const query = cursor
      ? `?limit=2&cursor=${encodeURIComponent(cursor)}`
      : "?limit=2";
    const { status, body } = await list(petId, cookie, query);
    expect(status).toBe(200);
    for (const item of body.data.items) seen.push(item.id);
    cursor = body.data.nextCursor;
    pages += 1;
  } while (cursor !== null && pages < 10);

  expect(pages).toBe(3); // 2 + 2 + 1
  expect(new Set(seen).size).toBe(5);
});

it("exact-limit boundary: total == limit yields one page, null cursor after", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const t0 = 1_760_000_000_000;
  await seedActivity(petId, userId, { occurredAt: t0 + 1 });
  await seedActivity(petId, userId, { occurredAt: t0 + 2 });

  const page1 = await list(petId, cookie, "?limit=2");
  expect(page1.body.data.items).toHaveLength(2);
  expect(page1.body.data.nextCursor).toBeNull();
});

it("rejects bad limit and bad cursor", async () => {
  const { userId, cookie } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  for (const query of ["?limit=0", "?limit=201", "?limit=ten", "?cursor=@@@"]) {
    const res = await SELF.fetch(
      `https://app.local/api/pets/${petId}/activities${query}`,
      { headers: { Cookie: cookie } },
    );
    expect(res.status).toBe(400);
  }
});

it("list is 404 for non-members", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const outsider = await seedUserWithSession({ email: "eve@example.com" });
  const { status } = await list(petId, outsider.cookie);
  expect(status).toBe(404);
});
