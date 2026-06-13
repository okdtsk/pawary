import type { ActivityResponse } from "@pawary/shared";
import { useMemo } from "react";
import { Link } from "react-router";
import { CategoryIcon, categoryTone } from "../../components/CategoryIcon";
import { useLocaleTag, useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { dayKeyOf, formatTime, minutesIntoDay, type DayKey } from "../../lib/dates";
import { placeItems, type Placed } from "../../lib/timeline";

export const HOUR_PX = 44;
export const CHIP_PX = 38;
export const DAY_HEIGHT = 24 * HOUR_PX;

export type TimedItem = { minute: number; activity: ActivityResponse };

export function Chip({
  activity,
  lane,
  laneCount,
  minute,
}: {
  activity: ActivityResponse;
  lane: number;
  laneCount: number;
  minute: number;
}) {
  const t = useT();
  const tag = useLocaleTag();
  const tone = categoryTone[activity.category];
  const width = 100 / laneCount;
  return (
    <Link
      to={`/pets/${activity.petId}/activities/${activity.id}`}
      title={`${formatTime(activity.occurredAt, activity.tzOffsetMin, tag)} ${t.categories[activity.category]}`}
      style={{
        top: (minute / 60) * HOUR_PX,
        height: CHIP_PX,
        left: `${lane * width}%`,
        width: `calc(${width}% - 3px)`,
      }}
      className={cn(
        "absolute flex items-center gap-1 overflow-hidden rounded-lg border-l-4 bg-paper px-1.5 shadow-card transition hover:z-10 hover:shadow-float",
        tone.border,
      )}
    >
      <span className={cn("shrink-0", tone.text)}>
        <CategoryIcon category={activity.category} className="h-4 w-4" />
      </span>
      <span className="truncate text-[11px] font-semibold leading-tight text-ink">
        {formatTime(activity.occurredAt, activity.tzOffsetMin, tag)}{" "}
        {t.categories[activity.category]}
      </span>
    </Link>
  );
}

/** Locale-aware hour-axis label factory (UTC so device TZ can't shift it). */
export function useHourLabel(): (hour: number) => string {
  const tag = useLocaleTag();
  return useMemo(() => {
    const formatter = new Intl.DateTimeFormat(tag, {
      hour: "numeric",
      timeZone: "UTC",
    });
    return (hour: number) =>
      formatter.format(new Date(Date.UTC(2026, 0, 1, hour)));
  }, [tag]);
}

/** Left hour-axis gutter (24 labels). */
export function HourAxis({
  hourLabel,
  className,
}: {
  hourLabel: (hour: number) => string;
  className?: string;
}) {
  return (
    <div className={cn("relative w-12 shrink-0", className)}>
      {Array.from({ length: 24 }, (_, hour) => (
        <span
          key={hour}
          className="absolute right-1.5 -translate-y-1/2 text-[10px] font-semibold tabular-nums text-ink-faint"
          style={{ top: hour * HOUR_PX }}
        >
          {hour === 0 ? "" : hourLabel(hour)}
        </span>
      ))}
    </div>
  );
}

/** Hour gridlines + positioned chips for one day's worth of placed items. */
export function DayColumnBody({ items }: { items: Placed<TimedItem>[] }) {
  return (
    <>
      {Array.from({ length: 24 }, (_, hour) => (
        <span
          key={hour}
          aria-hidden="true"
          className="absolute inset-x-0 border-t border-cream-100"
          style={{ top: hour * HOUR_PX }}
        />
      ))}
      {items.map((placed) => (
        <Chip
          key={placed.activity.id}
          activity={placed.activity}
          minute={placed.minute}
          lane={placed.lane}
          laneCount={placed.laneCount}
        />
      ))}
    </>
  );
}

/** Group + lane-place activities by household day-key for the given days. */
export function usePlacedByDay(
  activities: ActivityResponse[] | undefined,
  days: DayKey[],
): Map<DayKey, Placed<TimedItem>[]> {
  const daysKey = days.join(",");
  return useMemo(() => {
    const map = new Map<DayKey, Placed<TimedItem>[]>();
    for (const day of days) map.set(day, []);
    const grouped = new Map<DayKey, TimedItem[]>();
    for (const activity of activities ?? []) {
      const key = dayKeyOf(activity.occurredAt, activity.tzOffsetMin);
      if (!map.has(key)) continue;
      const bucket = grouped.get(key) ?? [];
      bucket.push({
        minute: minutesIntoDay(activity.occurredAt, activity.tzOffsetMin),
        activity,
      });
      grouped.set(key, bucket);
    }
    for (const [key, bucket] of grouped) map.set(key, placeItems(bucket));
    return map;
    // `days` is a fresh array each render; `daysKey` is its stable string surrogate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities, daysKey]);
}
