import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { pushSubscriptions } from "../../db/schema";
import type { Env } from "../../env";
import { sendPush } from "../../lib/webpush";

export type SendableSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type SendOutcome = "sent" | "deleted" | "failed";

/**
 * Send one push and self-heal dead endpoints.
 *  - 2xx → "sent"
 *  - 403 (VAPID mismatch after key rotation) / 404 / 410 (endpoint gone) →
 *    delete the subscription, "deleted"
 *  - anything else / network error → "failed" (left for a later retry)
 */
export async function sendOneAndCleanup(
  db: DrizzleD1Database,
  env: Env,
  sub: SendableSubscription,
  payload: string,
): Promise<SendOutcome> {
  let status: number;
  try {
    status = await sendPush(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      payload,
      env,
    );
  } catch {
    return "failed";
  }
  if (status === 403 || status === 404 || status === 410) {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
    return "deleted";
  }
  return status >= 200 && status < 300 ? "sent" : "failed";
}
