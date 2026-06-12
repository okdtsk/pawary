import type { ActivityResponse } from "@pawary/shared";
import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router";
import { useActivitiesRange } from "../../api/activities";
import { CategoryIcon, categoryTone } from "../../components/CategoryIcon";
import { Spinner } from "../../components/Spinner";
import { useLocaleTag, useT } from "../../i18n";
import { cn } from "../../lib/cn";
import {
  dayKeyOf,
  formatDayShort,
  formatTime,
  minutesIntoDay,
  rangeMs,
  todayKey,
  type DayKey,
} from "../../lib/dates";
import { placeItems, type Placed } from "../../lib/timeline";
import { useSwipe } from "../../lib/useSwipe";

const HOUR_PX = 44;
const CHIP_PX = 38;
const DAY_HEIGHT = 24 * HOUR_PX;

function Chip({
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

export function Timeline({
  petId,
  days,
  onShift,
}: {
  petId: string;
  days: DayKey[];
  onShift: (delta: number) => void;
}) {
  const tag = useLocaleTag();
  const { from, to } = rangeMs(days);
  const activities = useActivitiesRange(petId, from, to);
  const swipe = useSwipe({ onLeft: () => onShift(1), onRight: () => onShift(-1) });
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = todayKey();
  const daysKey = days.join(",");

  // locale-aware hour-axis labels (UTC so the device TZ can't shift them)
  const hourLabel = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(tag, {
      hour: "numeric",
      timeZone: "UTC",
    });
    return (hour: number) => formatter.format(new Date(Date.UTC(2026, 0, 1, hour)));
  }, [tag]);

  // start the viewport at 07:00 when the range changes
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 7 * HOUR_PX });
  }, [daysKey]);

  const byDay = useMemo(() => {
    type Item = { minute: number; activity: ActivityResponse };
    const map = new Map<DayKey, Placed<Item>[]>();
    for (const day of days) map.set(day, []);
    const grouped = new Map<DayKey, Item[]>();
    for (const activity of activities.data ?? []) {
      const key = dayKeyOf(activity.occurredAt, activity.tzOffsetMin);
      if (!map.has(key)) continue; // outside the visible household days
      const bucket = grouped.get(key) ?? [];
      bucket.push({
        minute: minutesIntoDay(activity.occurredAt, activity.tzOffsetMin),
        activity,
      });
      grouped.set(key, bucket);
    }
    for (const [key, bucket] of grouped) map.set(key, placeItems(bucket));
    return map;
  }, [activities.data, daysKey]);

  return (
    <div {...swipe} className="overflow-hidden rounded-card bg-paper shadow-card">
      {/* day headers */}
      <div className="flex border-b border-cream-200">
        <div className="w-12 shrink-0" />
        {days.map((day) => (
          <div
            key={day}
            className={cn(
              "flex-1 border-l border-cream-100 py-2 text-center text-sm font-semibold",
              day === today ? "text-clay-600" : "text-ink-soft",
            )}
          >
            {formatDayShort(day, tag)}
          </div>
        ))}
      </div>

      {activities.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="relative h-[min(60dvh,560px)] overflow-y-auto"
        >
          <div className="relative flex" style={{ height: DAY_HEIGHT }}>
            {/* hour axis */}
            <div className="relative w-12 shrink-0">
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
            {/* day columns */}
            {days.map((day) => (
              <div
                key={day}
                className="relative flex-1 border-l border-cream-100"
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <span
                    key={hour}
                    aria-hidden="true"
                    className="absolute inset-x-0 border-t border-cream-100"
                    style={{ top: hour * HOUR_PX }}
                  />
                ))}
                {(byDay.get(day) ?? []).map((placed) => (
                  <Chip
                    key={placed.activity.id}
                    activity={placed.activity}
                    minute={placed.minute}
                    lane={placed.lane}
                    laneCount={placed.laneCount}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
