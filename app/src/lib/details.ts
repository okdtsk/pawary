import {
  activityDetailsSchemas,
  type Category,
} from "@pawlog/shared";
import type { z } from "zod";

export type DetailsMap = {
  [C in Category]: z.infer<(typeof activityDetailsSchemas)[C]>;
};

/** Safe-parses an unknown payload into the typed details for a category. */
export function parseDetails<C extends Category>(
  category: C,
  details: unknown,
): DetailsMap[C] | null {
  const parsed = activityDetailsSchemas[category].safeParse(details ?? {});
  return parsed.success ? (parsed.data as DetailsMap[C]) : null;
}
