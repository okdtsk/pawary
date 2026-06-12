import { and, asc, eq, isNull, lte, ne, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  careSchedules,
  petMembers,
  pets,
  pushSubscriptions,
  users,
} from "../../db/schema";
import type { Env } from "../../env";
import { sendPush } from "../../lib/webpush";

/** Batch safety caps (plan locked decisions). */
const MAX_DUE_SCHEDULES = 200;
const MAX_SENDS = 500;

/** Digest fires when the subscription's local time-of-day is in [08:00, 08:15). */
const DIGEST_WINDOW_START_MIN = 480;
const DIGEST_WINDOW_END_MIN = 495;

const MINUTE_MS = 60_000;
const DAY_MIN = 1440;

type Locale = "en" | "ja";

export type PushCronResult = {
  dueSent: number;
  digestSent: number;
  deleted: number;
};

function resolveLocale(locale: string | null | undefined): Locale {
  return locale === "ja" ? "ja" : "en";
}

/** Due-now payload: title is the pet name, body is the localized due line. */
export function buildDuePayload(
  scheduleName: string,
  petName: string,
  locale: string,
): string {
  const body =
    resolveLocale(locale) === "ja"
      ? `${scheduleName}の時間です`
      : `${scheduleName} is due`;
  return JSON.stringify({ title: petName, body, url: "/health" });
}

/** Digest payload: title is the pet name, body lists the overdue item names. */
export function buildDigestPayload(
  petName: string,
  names: string[],
  locale: string,
): string {
  const joined = names.join(", ");
  const body =
    resolveLocale(locale) === "ja"
      ? `未完了のケアが${names.length}件: ${joined}`
      : `${names.length} overdue care item(s): ${joined}`;
  return JSON.stringify({ title: petName, body, url: "/health" });
}

/** Minutes since local midnight for `now` in the given UTC offset. */
function localMinutesOfDay(now: number, tzOffsetMin: number): number {
  const totalMin = Math.floor((now + tzOffsetMin * MINUTE_MS) / MINUTE_MS);
  return ((totalMin % DAY_MIN) + DAY_MIN) % DAY_MIN;
}

/** Local calendar day key (YYYY-MM-DD) for `now` in the given UTC offset. */
function localDayKey(now: number, tzOffsetMin: number): string {
  return new Date(now + tzOffsetMin * MINUTE_MS).toISOString().slice(0, 10);
}

type SendableSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * The 15-minute push cron: pushes schedules that just became due to every
 * member's subscriptions, and a per-pet overdue digest to subscriptions whose
 * local time is in the [08:00, 08:15) window.
 */
export async function runPushCron(env: Env, now: number): Promise<PushCronResult> {
  const db = drizzle(env.DB);
  let sends = 0;
  let dueSent = 0;
  let digestSent = 0;
  let deleted = 0;
  let capped = false;
  const deletedIds = new Set<string>();

  /** Send one push; returns true on 2xx. 404/410 delete the subscription;
   *  other failures (429/5xx/network) are left for the next cron run. */
  async function trySend(sub: SendableSubscription, payload: string): Promise<boolean> {
    if (deletedIds.has(sub.id)) return false;
    if (sends >= MAX_SENDS) {
      capped = true;
      return false;
    }
    sends++;
    let status: number;
    try {
      status = await sendPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        payload,
        env,
      );
    } catch {
      return false;
    }
    if (status === 404 || status === 410) {
      deletedIds.add(sub.id);
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
      deleted++;
      return false;
    }
    return status >= 200 && status < 300;
  }

  // -------------------------------------------------------------------------
  // 1. Due-now: schedules that became due and were not yet notified for this
  //    occurrence. notifiedDueAt is set after attempting the sends regardless
  //    of per-endpoint failures — one attempt per due occurrence.
  // -------------------------------------------------------------------------
  const dueRows = await db
    .select({
      scheduleId: careSchedules.id,
      scheduleName: careSchedules.name,
      nextDueAt: careSchedules.nextDueAt,
      petId: careSchedules.petId,
      petName: pets.name,
    })
    .from(careSchedules)
    .innerJoin(pets, eq(pets.id, careSchedules.petId))
    .where(
      and(
        eq(careSchedules.active, true),
        lte(careSchedules.nextDueAt, now),
        or(
          isNull(careSchedules.notifiedDueAt),
          ne(careSchedules.notifiedDueAt, careSchedules.nextDueAt),
        ),
      ),
    )
    .orderBy(asc(careSchedules.nextDueAt))
    .limit(MAX_DUE_SCHEDULES);

  for (const due of dueRows) {
    const memberSubs = await db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
        locale: users.locale,
      })
      .from(petMembers)
      .innerJoin(pushSubscriptions, eq(pushSubscriptions.userId, petMembers.userId))
      .innerJoin(users, eq(users.id, petMembers.userId))
      .where(eq(petMembers.petId, due.petId));

    for (const sub of memberSubs) {
      const ok = await trySend(
        sub,
        buildDuePayload(due.scheduleName, due.petName, sub.locale),
      );
      if (ok) dueSent++;
    }

    await db
      .update(careSchedules)
      .set({ notifiedDueAt: due.nextDueAt })
      .where(eq(careSchedules.id, due.scheduleId));
  }

  // -------------------------------------------------------------------------
  // 2. Digest: subscriptions whose local time-of-day is in [08:00, 08:15) and
  //    that have not received today's digest. Overdue = active schedules with
  //    nextDueAt <= now (kept simple per plan); one push per pet with items.
  // -------------------------------------------------------------------------
  const allSubs = await db
    .select({
      id: pushSubscriptions.id,
      userId: pushSubscriptions.userId,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
      tzOffsetMin: pushSubscriptions.tzOffsetMin,
      lastDigestDay: pushSubscriptions.lastDigestDay,
      locale: users.locale,
    })
    .from(pushSubscriptions)
    .innerJoin(users, eq(users.id, pushSubscriptions.userId));

  for (const sub of allSubs) {
    if (deletedIds.has(sub.id)) continue;
    const localMin = localMinutesOfDay(now, sub.tzOffsetMin);
    if (localMin < DIGEST_WINDOW_START_MIN || localMin >= DIGEST_WINDOW_END_MIN) {
      continue;
    }
    const todayKey = localDayKey(now, sub.tzOffsetMin);
    if (sub.lastDigestDay === todayKey) continue;

    const overdueRows = await db
      .select({
        petId: pets.id,
        petName: pets.name,
        scheduleName: careSchedules.name,
      })
      .from(petMembers)
      .innerJoin(pets, eq(pets.id, petMembers.petId))
      .innerJoin(careSchedules, eq(careSchedules.petId, pets.id))
      .where(
        and(
          eq(petMembers.userId, sub.userId),
          eq(careSchedules.active, true),
          lte(careSchedules.nextDueAt, now),
        ),
      )
      .orderBy(asc(careSchedules.nextDueAt));

    const byPet = new Map<string, { petName: string; names: string[] }>();
    for (const row of overdueRows) {
      const entry = byPet.get(row.petId) ?? { petName: row.petName, names: [] };
      entry.names.push(row.scheduleName);
      byPet.set(row.petId, entry);
    }

    for (const { petName, names } of byPet.values()) {
      if (deletedIds.has(sub.id)) break;
      const ok = await trySend(sub, buildDigestPayload(petName, names, sub.locale));
      if (ok) digestSent++;
    }

    // One digest attempt per local day, even when nothing was overdue.
    if (!deletedIds.has(sub.id)) {
      await db
        .update(pushSubscriptions)
        .set({ lastDigestDay: todayKey })
        .where(eq(pushSubscriptions.id, sub.id));
    }
  }

  if (capped) {
    console.log(`push cron send cap reached (${MAX_SENDS})`);
  }
  return { dueSent, digestSent, deleted };
}
