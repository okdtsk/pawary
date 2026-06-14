import type { Category } from "@pawary/shared";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { petMembers, pets, pushSubscriptions, users } from "../../db/schema";
import type { Env } from "../../env";
import { buildNewLogPayload } from "./new-log";
import { sendOneAndCleanup } from "./send";

/** Per-create fan-out safety cap. */
const MAX_SENDS = 500;

/**
 * Immediately notify a pet's other careteam members about one new activity.
 * Stateless: no coalescing — each create sends its own push. Called
 * fire-and-forget from the activity POST handler via `waitUntil`.
 */
export async function notifyCareteamNewLog(
  env: Env,
  petId: string,
  activity: { createdBy: string; category: Category },
): Promise<void> {
  const db = drizzle(env.DB);

  const pet = await db
    .select({ name: pets.name })
    .from(pets)
    .where(eq(pets.id, petId))
    .get();
  if (!pet) return;

  const author = await db
    .select({ name: users.displayName })
    .from(users)
    .where(eq(users.id, activity.createdBy))
    .get();
  const authorName = author?.name ?? "";

  // Recipients: members of this pet who opted in and have a push subscription.
  // One row per (member × subscription); the author is filtered out below.
  const recipients = await db
    .select({
      userId: petMembers.userId,
      locale: users.locale,
      subId: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(petMembers)
    .innerJoin(users, eq(users.id, petMembers.userId))
    .innerJoin(pushSubscriptions, eq(pushSubscriptions.userId, petMembers.userId))
    .where(and(eq(petMembers.petId, petId), eq(users.notifyCareteamLogs, true)))
    .all();

  const payloadByLocale = new Map<string, string>();
  let sends = 0;
  for (const r of recipients) {
    if (r.userId === activity.createdBy) continue; // never notify the author
    if (sends >= MAX_SENDS) {
      console.log(`careteam notify cap reached (${MAX_SENDS}) for pet ${petId}`);
      break;
    }
    let payload = payloadByLocale.get(r.locale);
    if (payload === undefined) {
      payload = buildNewLogPayload({
        petName: pet.name,
        petId,
        authorNames: [authorName],
        itemCount: 1,
        category: activity.category,
        locale: r.locale,
      });
      payloadByLocale.set(r.locale, payload);
    }
    sends++;
    await sendOneAndCleanup(
      db,
      env,
      { id: r.subId, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth },
      payload,
    );
  }
}
