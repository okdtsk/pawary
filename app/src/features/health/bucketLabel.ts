import { isoWeekStartDay } from "@pawlog/shared";
import { formatMonthDay } from "../../lib/dates";

/** Axis label for a chart bucket: the day itself, or the ISO week's Monday. */
export function bucketLabel(key: string, bucket: "day" | "week", locale: string): string {
  return formatMonthDay(bucket === "week" ? isoWeekStartDay(key) : key, locale);
}
