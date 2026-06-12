/**
 * Builds the system prompt for the AI Advisor, including a persona/disclaimer,
 * pet profile, and a 30-day activity digest. Hard-capped at 6000 chars by
 * dropping digest lines from the end.
 */

import { and, eq, gte, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { activities, careSchedules, petTargets } from "../../db/schema";
import type { Pet } from "../../db/schema";

const MAX_CHARS = 6000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_WEIGHT_ENTRIES = 10;
const MAX_RECENT_ENTRIES = 15;

const STRINGS = {
  en: {
    persona: (todayDate: string) =>
      `You are a helpful pet-care assistant. You are not a veterinarian and your advice does not replace professional veterinary care. If the user describes urgent or worsening symptoms, always recommend they see a vet promptly. Answer in the same language the user writes in. Today's date (household): ${todayDate}.`,
    profile: "## Pet Profile",
    name: "Name",
    species: "Species",
    breed: "Breed",
    sex: "Sex",
    age: "Age",
    years: "years",
    months: "months",
    targets: "Daily targets",
    foodTarget: "Food",
    waterTarget: "Water",
    digest: "## Activity Digest (last 30 days)",
    categoryCounts: "### Activity counts",
    weightSection: "### Weight",
    latestWeight: "Latest",
    weightDelta: "Delta vs oldest",
    symptomsSection: "### Recent symptoms (newest first)",
    medicationsSection: "### Recent medications (newest first)",
    vetVisitsSection: "### Recent vet visits (newest first)",
    schedulesSection: "### Active care schedules",
    nextDue: "next due",
    noData: "(none)",
  },
  ja: {
    persona: (todayDate: string) =>
      `あなたは親切なペットケアアシスタントです。獣医師ではありません。あなたのアドバイスは専門的な獣医療の代替ではありません。緊急または悪化する症状については、必ず速やかに獣医師の診察を受けるよう勧めてください。ユーザーが書く言語で回答してください。今日の日付（現地時間）: ${todayDate}。`,
    profile: "## ペットのプロフィール",
    name: "名前",
    species: "種",
    breed: "品種",
    sex: "性別",
    age: "年齢",
    years: "歳",
    months: "ヶ月",
    targets: "1日の目標",
    foodTarget: "食事",
    waterTarget: "水分",
    digest: "## 活動ダイジェスト（過去30日間）",
    categoryCounts: "### 活動回数",
    weightSection: "### 体重",
    latestWeight: "最新",
    weightDelta: "最古との差",
    symptomsSection: "### 最近の症状（新しい順）",
    medicationsSection: "### 最近の薬（新しい順）",
    vetVisitsSection: "### 最近の通院（新しい順）",
    schedulesSection: "### アクティブなケアスケジュール",
    nextDue: "次回",
    noData: "（なし）",
  },
} as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Convert epoch ms to household YYYY-MM-DD using UTC getters after applying tz offset. */
function toHouseholdDate(epochMs: number, tzOffsetMin: number): string {
  const d = new Date(epochMs + tzOffsetMin * 60_000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Compute age in years and months from a birthday string (YYYY-MM-DD). */
function computeAge(
  birthday: string,
  now: number,
): { years: number; months: number } | null {
  const bYear = Number(birthday.slice(0, 4));
  const bMonth = Number(birthday.slice(5, 7)) - 1; // 0-based
  const bDay = Number(birthday.slice(8, 10));
  if (isNaN(bYear) || isNaN(bMonth) || isNaN(bDay)) return null;

  const nowDate = new Date(now);
  let years = nowDate.getUTCFullYear() - bYear;
  let months = nowDate.getUTCMonth() - bMonth;
  if (nowDate.getUTCDate() < bDay) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) return null;
  return { years, months };
}

/** Extract a display name from activity details for symptom/medication/vet_visit rows. */
function extractDetailName(details: unknown): string {
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const d = details as Record<string, unknown>;
    if (typeof d["name"] === "string" && d["name"]) return d["name"];
    if (typeof d["reason"] === "string" && d["reason"]) return d["reason"];
  }
  return "";
}

export async function buildAdvisorSystemPrompt(
  db: DrizzleD1Database,
  pet: Pet,
  tzOffsetMin: number,
  locale: "en" | "ja",
): Promise<string> {
  const s = STRINGS[locale];
  const now = Date.now();
  const cutoff = now - THIRTY_DAYS_MS;
  const todayDate = toHouseholdDate(now, tzOffsetMin);

  // ── Queries ───────────────────────────────────────────────────────────────

  // All activities in last 30 days (for category counts + per-category data)
  const allActivities = await db
    .select({
      category: activities.category,
      occurredAt: activities.occurredAt,
      details: activities.details,
    })
    .from(activities)
    .where(
      and(
        eq(activities.petId, pet.id),
        isNull(activities.deletedAt),
        gte(activities.occurredAt, cutoff),
      ),
    )
    .all();

  // Active care schedules
  const schedules = await db
    .select({ name: careSchedules.name, nextDueAt: careSchedules.nextDueAt })
    .from(careSchedules)
    .where(and(eq(careSchedules.petId, pet.id), eq(careSchedules.active, true)))
    .all();

  // Pet targets
  const targets = await db
    .select({ foodGPerDay: petTargets.foodGPerDay, waterMlPerDay: petTargets.waterMlPerDay })
    .from(petTargets)
    .where(eq(petTargets.petId, pet.id))
    .get();

  // ── Per-category counts ───────────────────────────────────────────────────

  const categoryCounts = new Map<string, number>();
  for (const row of allActivities) {
    categoryCounts.set(row.category, (categoryCounts.get(row.category) ?? 0) + 1);
  }

  // ── Weight entries (latest 10, sorted desc by occurredAt) ─────────────────

  const weightRows = allActivities
    .filter((r) => r.category === "weight")
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .slice(0, MAX_WEIGHT_ENTRIES);

  let latestWeight: number | null = null;
  let weightDelta: number | null = null;
  if (weightRows.length > 0) {
    const first = weightRows[0]!;
    const last = weightRows[weightRows.length - 1]!;
    const latestKg =
      typeof (first.details as Record<string, unknown>)["kg"] === "number"
        ? ((first.details as Record<string, unknown>)["kg"] as number)
        : null;
    const oldestKg =
      typeof (last.details as Record<string, unknown>)["kg"] === "number"
        ? ((last.details as Record<string, unknown>)["kg"] as number)
        : null;
    latestWeight = latestKg;
    if (latestKg !== null && oldestKg !== null && weightRows.length > 1) {
      weightDelta = Math.round((latestKg - oldestKg) * 100) / 100;
    }
  }

  // ── Recent symptoms / medications / vet_visits (newest 15 each) ───────────

  type RecentEntry = { name: string; date: string };

  function buildRecentEntries(category: string): RecentEntry[] {
    return allActivities
      .filter((r) => r.category === category)
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .slice(0, MAX_RECENT_ENTRIES)
      .map((r) => ({
        name: extractDetailName(r.details),
        date: toHouseholdDate(r.occurredAt, tzOffsetMin),
      }));
  }

  const recentSymptoms = buildRecentEntries("symptom");
  const recentMedications = buildRecentEntries("medication");
  const recentVetVisits = buildRecentEntries("vet_visit");

  // ── Build sections ────────────────────────────────────────────────────────

  // Persona (never truncated)
  const personaLines: string[] = [s.persona(todayDate), ""];

  // Profile (never truncated)
  const profileLines: string[] = [s.profile];
  profileLines.push(`- ${s.name}: ${pet.name}`);
  profileLines.push(`- ${s.species}: ${pet.species}`);
  if (pet.breed) profileLines.push(`- ${s.breed}: ${pet.breed}`);
  if (pet.sex) profileLines.push(`- ${s.sex}: ${pet.sex}`);
  if (pet.birthday) {
    const age = computeAge(pet.birthday, now);
    if (age) {
      profileLines.push(`- ${s.age}: ${age.years} ${s.years} ${age.months} ${s.months}`);
    }
  }
  if (targets) {
    const parts: string[] = [];
    if (targets.foodGPerDay != null) parts.push(`${s.foodTarget}: ${targets.foodGPerDay}g`);
    if (targets.waterMlPerDay != null) parts.push(`${s.waterTarget}: ${targets.waterMlPerDay}ml`);
    if (parts.length > 0) profileLines.push(`- ${s.targets}: ${parts.join(", ")}`);
  }
  profileLines.push("");

  // Digest lines (may be truncated)
  const digestLines: string[] = [];

  // Category counts
  digestLines.push(s.digest, s.categoryCounts);
  if (categoryCounts.size === 0) {
    digestLines.push(s.noData);
  } else {
    const sorted = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sorted) {
      digestLines.push(`- ${cat}: ${count}`);
    }
  }
  digestLines.push("");

  // Weight section
  digestLines.push(s.weightSection);
  if (latestWeight !== null) {
    digestLines.push(`- ${s.latestWeight}: ${latestWeight} kg`);
    if (weightDelta !== null) {
      const sign = weightDelta >= 0 ? "+" : "";
      digestLines.push(`- ${s.weightDelta}: ${sign}${weightDelta} kg`);
    }
  } else {
    digestLines.push(s.noData);
  }
  digestLines.push("");

  // Symptoms
  digestLines.push(s.symptomsSection);
  if (recentSymptoms.length === 0) {
    digestLines.push(s.noData);
  } else {
    for (const e of recentSymptoms) {
      digestLines.push(`- ${e.date}: ${e.name}`);
    }
  }
  digestLines.push("");

  // Medications
  digestLines.push(s.medicationsSection);
  if (recentMedications.length === 0) {
    digestLines.push(s.noData);
  } else {
    for (const e of recentMedications) {
      digestLines.push(`- ${e.date}: ${e.name}`);
    }
  }
  digestLines.push("");

  // Vet visits
  digestLines.push(s.vetVisitsSection);
  if (recentVetVisits.length === 0) {
    digestLines.push(s.noData);
  } else {
    for (const e of recentVetVisits) {
      digestLines.push(`- ${e.date}: ${e.name}`);
    }
  }
  digestLines.push("");

  // Active schedules
  digestLines.push(s.schedulesSection);
  if (schedules.length === 0) {
    digestLines.push(s.noData);
  } else {
    for (const sch of schedules) {
      const due = toHouseholdDate(sch.nextDueAt, tzOffsetMin);
      digestLines.push(`- ${sch.name} (${s.nextDue}: ${due})`);
    }
  }

  // ── Assemble + cap at 6000 chars ──────────────────────────────────────────

  const fixedPart = personaLines.join("\n") + profileLines.join("\n");
  const fixedLen = fixedPart.length;

  // Join digest lines with newlines, then trim from the end if needed
  let digest = digestLines.join("\n");
  while (fixedLen + 1 + digest.length > MAX_CHARS && digestLines.length > 0) {
    digestLines.pop();
    digest = digestLines.join("\n");
  }

  return fixedPart + "\n" + digest;
}
