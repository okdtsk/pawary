import { DurableObject } from "cloudflare:workers";
import type { Category } from "@pawary/shared";
import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  activities,
  petMembers,
  pets,
  pushSubscriptions,
  users,
} from "../../db/schema";
import type { Env } from "../../env";
import { buildNewLogPayload } from "./new-log";
import { sendOneAndCleanup } from "./send";

/** Fixed coalescing window from the first un-notified add. */
const WINDOW_MS = 60_000;
/** Per-alarm fan-out safety cap. */
const MAX_SENDS = 500;

/**
 * One instance per pet (idFromName(petId)). Debounces new-activity pings into a
 * single coalesced push per recipient. State: a `lastNotifiedAt` watermark and
 * the `petId`; the alarm queries D1 for everything created since the watermark.
 */
export class CareteamNotifier extends DurableObject<Env> {
  /** Called from the activity-create handler. Arms a single fixed-window alarm. */
  async ping(petId: string): Promise<void> {
    await this.ctx.storage.put("petId", petId);
    const pending = await this.ctx.storage.getAlarm();
    if (pending !== null) return; // fixed window — don't reset
    const now = Date.now();
    if ((await this.ctx.storage.get<number>("lastNotifiedAt")) === undefined) {
      // First arm on a fresh DO: look back one window so we notify only recent
      // activity (including the add that triggered this ping), never history.
      await this.ctx.storage.put("lastNotifiedAt", now - WINDOW_MS);
      await this.ctx.storage.put("lastNotifiedId", "");
    }
    await this.ctx.storage.setAlarm(now + WINDOW_MS);
  }

  async alarm(): Promise<void> {
    const petId = await this.ctx.storage.get<string>("petId");
    if (!petId) return;
    const db = drizzle(this.env.DB);
    const wmTime = (await this.ctx.storage.get<number>("lastNotifiedAt")) ?? 0;
    const wmId = (await this.ctx.storage.get<string>("lastNotifiedId")) ?? "";

    const rows = await db
      .select({
        id: activities.id,
        createdAt: activities.createdAt,
        createdBy: activities.createdBy,
        category: activities.category,
        authorName: users.displayName,
      })
      .from(activities)
      .innerJoin(users, eq(users.id, activities.createdBy))
      .where(
        and(
          eq(activities.petId, petId),
          isNull(activities.deletedAt),
          or(
            gt(activities.createdAt, wmTime),
            and(eq(activities.createdAt, wmTime), gt(activities.id, wmId)),
          ),
        ),
      )
      .orderBy(asc(activities.createdAt), asc(activities.id))
      .all();

    if (rows.length === 0) return; // nothing new; watermark unchanged
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const lastRow = rows[rows.length - 1]!;

    const pet = await db
      .select({ name: pets.name })
      .from(pets)
      .where(eq(pets.id, petId))
      .get();
    if (!pet) {
      await this.ctx.storage.put("lastNotifiedAt", lastRow.createdAt);
      await this.ctx.storage.put("lastNotifiedId", lastRow.id);
      return;
    }

    // Recipients: members of this pet who opted in and have a subscription.
    // One row per (member × subscription). Authors are filtered per-recipient.
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

    const payloadByUser = new Map<string, string | null>();
    let sends = 0;
    let capped = false;
    for (const r of recipients) {
      if (sends >= MAX_SENDS) { capped = true; break; }
      let payload = payloadByUser.get(r.userId);
      if (payload === undefined) {
        const items = rows.filter((row) => row.createdBy !== r.userId);
        if (items.length === 0) {
          payloadByUser.set(r.userId, null);
          payload = null;
        } else {
          const authorNames = [
            ...new Map(items.map((row) => [row.createdBy, row.authorName])).values(),
          ];
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const category: Category | null =
            items.length === 1 ? items[0]!.category : null;
          payload = buildNewLogPayload({
            petName: pet.name,
            petId,
            authorNames,
            itemCount: items.length,
            category,
            locale: r.locale,
          });
          payloadByUser.set(r.userId, payload);
        }
      }
      if (!payload) continue;
      sends++;
      await sendOneAndCleanup(
        db,
        this.env,
        { id: r.subId, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth },
        payload,
      );
    }

    if (capped) console.log(`careteam notifier send cap reached (${MAX_SENDS}) for pet ${petId}`);

    // Advance after the send attempt (idempotent on alarm retry).
    await this.ctx.storage.put("lastNotifiedAt", lastRow.createdAt);
    await this.ctx.storage.put("lastNotifiedId", lastRow.id);
  }
}

/** Fire-and-forget arm of the per-pet notifier. */
export async function pingCareteamNotifier(env: Env, petId: string): Promise<void> {
  const id = env.CARETEAM_NOTIFIER.idFromName(petId);
  await env.CARETEAM_NOTIFIER.get(id).ping(petId);
}
