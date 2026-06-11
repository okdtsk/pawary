import { env, SELF } from "cloudflare:test";
import type { ActivityResponse, Category } from "@pawlog/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { auditLog } from "../src/db/schema";
import {
  authHeaders,
  seedPet,
  seedUserWithSession,
  withMember,
} from "./helpers";

export async function postActivity(
  petId: string,
  cookie: string,
  csrfToken: string,
  body: unknown,
) {
  return SELF.fetch(`https://app.local/api/pets/${petId}/activities`, {
    method: "POST",
    headers: authHeaders(cookie, csrfToken),
    body: JSON.stringify(body),
  });
}

it("POST creates an activity and writes an audit row", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const res = await postActivity(petId, cookie, csrfToken, {
    category: "weight",
    occurredAt: Date.now(),
    tzOffsetMin: 540,
    memo: "monthly weigh-in",
    details: { kg: 4.2 },
  });
  expect(res.status).toBe(201);
  const { data } = (await res.json()) as { data: ActivityResponse };
  expect(data.category).toBe("weight");
  expect(data.details).toEqual({ kg: 4.2 });
  expect(data.createdBy).toBe(userId);
  expect(data.photos).toEqual([]);

  const db = drizzle(env.DB);
  const audits = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityId, data.id))
    .all();
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    action: "create",
    entity: "activity",
    petId,
  });
});

it("POST defaults details to {} so `note` needs only a memo", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  const res = await postActivity(petId, cookie, csrfToken, {
    category: "note",
    occurredAt: Date.now(),
    tzOffsetMin: 0,
    memo: "sleepy day",
  });
  expect(res.status).toBe(201);
});

describe("per-category details validation", () => {
  const cases: Array<{ category: Category; details: unknown; ok: boolean }> = [
    { category: "food", details: { foodType: "dry", unit: "g", amount: 50 }, ok: true },
    { category: "food", details: { foodType: "fried", unit: "g" }, ok: false },
    { category: "food", details: { foodType: "dry", unit: "g", leftoverPct: 101 }, ok: false },
    { category: "water", details: { amountMl: 120 }, ok: true },
    { category: "water", details: { amountMl: -1 }, ok: false },
    { category: "water", details: {}, ok: false },
    { category: "toilet", details: { kind: "poop", condition: "soft" }, ok: true },
    { category: "toilet", details: { kind: "poop" }, ok: false },
    { category: "weight", details: { kg: 4.2 }, ok: true },
    { category: "weight", details: { kg: "4.2" }, ok: false },
    { category: "exercise", details: { kind: "walk", durationMin: 30 }, ok: true },
    { category: "exercise", details: { kind: "swim" }, ok: false },
    { category: "symptom", details: { name: "cough", severity: "mild" }, ok: true },
    { category: "symptom", details: { name: "cough", severity: "fatal" }, ok: false },
    { category: "medication", details: { name: "antibiotic", dose: 5, doseUnit: "mg" }, ok: true },
    { category: "medication", details: { dose: 5 }, ok: false },
    { category: "vet_visit", details: { clinic: "Ueno Clinic", nextVisitDate: "2026-07-01" }, ok: true },
    { category: "vet_visit", details: { nextVisitDate: "July 1st" }, ok: false },
    { category: "grooming", details: { kind: "nails" }, ok: true },
    { category: "grooming", details: { kind: "perm" }, ok: false },
    { category: "vaccination", details: { vaccineName: "rabies" }, ok: true },
    { category: "vaccination", details: {}, ok: false },
    { category: "note", details: {}, ok: true },
    { category: "note", details: { extra: 1 }, ok: false },
  ];

  it.each(cases)("$category $ok", async ({ category, details, ok }) => {
    const { userId, cookie, csrfToken } = await seedUserWithSession();
    const { petId } = await seedPet(userId);
    const res = await postActivity(petId, cookie, csrfToken, {
      category,
      occurredAt: Date.now(),
      tzOffsetMin: 0,
      details,
    });
    expect(res.status).toBe(ok ? 201 : 400);
  });
});

it("POST rejects bad envelopes: tz out of range, unknown key, bad category", async () => {
  const { userId, cookie, csrfToken } = await seedUserWithSession();
  const { petId } = await seedPet(userId);
  for (const body of [
    { category: "note", occurredAt: Date.now(), tzOffsetMin: 900, details: {} },
    { category: "note", occurredAt: Date.now(), tzOffsetMin: 0, details: {}, extra: 1 },
    { category: "nap", occurredAt: Date.now(), tzOffsetMin: 0, details: {} },
    { category: "note", occurredAt: -5, tzOffsetMin: 0, details: {} },
  ]) {
    const res = await postActivity(petId, cookie, csrfToken, body);
    expect(res.status).toBe(400);
  }
});

it("POST authz: viewer 403, non-member 404, no csrf 403, no session 401", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const valid = {
    category: "note",
    occurredAt: Date.now(),
    tzOffsetMin: 0,
    details: {},
  };

  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  expect(
    (await postActivity(petId, viewer.cookie, viewer.csrfToken, valid)).status,
  ).toBe(403);

  const outsider = await seedUserWithSession({ email: "eve@example.com" });
  expect(
    (await postActivity(petId, outsider.cookie, outsider.csrfToken, valid)).status,
  ).toBe(404);

  const noCsrf = await SELF.fetch(
    `https://app.local/api/pets/${petId}/activities`,
    {
      method: "POST",
      headers: authHeaders(owner.cookie),
      body: JSON.stringify(valid),
    },
  );
  expect(noCsrf.status).toBe(403);

  const noSession = await SELF.fetch(
    `https://app.local/api/pets/${petId}/activities`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(valid),
    },
  );
  expect(noSession.status).toBe(401);
});

it("GET /:id returns the activity for a viewer; cross-pet id is 404", async () => {
  const owner = await seedUserWithSession();
  const { petId } = await seedPet(owner.userId);
  const created = await postActivity(petId, owner.cookie, owner.csrfToken, {
    category: "water",
    occurredAt: Date.now(),
    tzOffsetMin: 540,
    details: { amountMl: 100 },
  });
  const { data } = (await created.json()) as { data: ActivityResponse };

  const viewer = await seedUserWithSession({ email: "v@example.com" });
  await withMember(petId, viewer.userId, "viewer");
  const res = await SELF.fetch(
    `https://app.local/api/pets/${petId}/activities/${data.id}`,
    { headers: { Cookie: viewer.cookie } },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: ActivityResponse };
  expect(body.data.details).toEqual({ amountMl: 100 });

  // the same activity id under a DIFFERENT pet the viewer owns → 404
  const { petId: otherPet } = await seedPet(viewer.userId);
  const cross = await SELF.fetch(
    `https://app.local/api/pets/${otherPet}/activities/${data.id}`,
    { headers: { Cookie: viewer.cookie } },
  );
  expect(cross.status).toBe(404);
});
