import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { pets } from "../db/schema";

/**
 * Deletes every R2 object under the pet's prefix (cursor loop handles
 * truncated listings), then the pet row — FK cascades remove memberships,
 * activities, photos rows, presets, schedules, and targets.
 * Callers write the audit row BEFORE calling this.
 */
export async function deletePetWithStorage(
  db: DrizzleD1Database,
  bucket: R2Bucket,
  petId: string,
): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const listing = await bucket.list({ prefix: `pets/${petId}/`, cursor });
    if (listing.objects.length > 0) {
      await bucket.delete(listing.objects.map((o) => o.key));
    }
    if (!listing.truncated) break;
    cursor = listing.cursor;
  }
  await db.delete(pets).where(eq(pets.id, petId));
}
