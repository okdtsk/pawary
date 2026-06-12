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
