import { useEffect, useRef } from "react";
import { useActivitiesRange } from "../../api/activities";
import { Spinner } from "../../components/Spinner";
import { useLocaleTag } from "../../i18n";
import { cn } from "../../lib/cn";
import { formatDayShort, isWeekend, rangeMs, type DayKey } from "../../lib/dates";
import { useSwipe } from "../../lib/useSwipe";
import {
  DAY_HEIGHT,
  DayColumnBody,
  HOUR_PX,
  HourAxis,
  useHourLabel,
  usePlacedByDay,
} from "./timelineShared";

export function Timeline({
  petId,
  days,
  today,
  startHour,
  weekendColor,
  hhOffset,
  onShift,
}: {
  petId: string;
  days: DayKey[];
  today: DayKey;
  startHour: number;
  weekendColor: boolean;
  hhOffset: number;
  onShift: (delta: number) => void;
}) {
  const tag = useLocaleTag();
  const { from, to } = rangeMs(days, hhOffset);
  const activities = useActivitiesRange(petId, from, to);
  const swipe = useSwipe({ onLeft: () => onShift(1), onRight: () => onShift(-1) });
  const scrollRef = useRef<HTMLDivElement>(null);
  const daysKey = days.join(",");
  const hourLabel = useHourLabel();
  const byDay = usePlacedByDay(activities.data, days);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: startHour * HOUR_PX });
  }, [daysKey, startHour]);

  return (
    <div {...swipe} className="overflow-hidden rounded-card bg-paper shadow-card">
      <div className="flex border-b border-cream-200">
        <div className="w-12 shrink-0" />
        {days.map((day) => (
          <div
            key={day}
            className={cn(
              "flex-1 border-l border-cream-100 py-2 text-center text-sm font-semibold",
              day === today ? "text-clay-600" : "text-ink-soft",
              weekendColor && isWeekend(day) && "bg-clay-50",
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
          data-pull-ignore
          className="relative h-[min(60dvh,560px)] overflow-y-auto"
        >
          <div className="relative flex" style={{ height: DAY_HEIGHT }}>
            <HourAxis hourLabel={hourLabel} />
            {days.map((day) => (
              <div
                key={day}
                className={cn(
                  "relative flex-1 border-l border-cream-100",
                  weekendColor && isWeekend(day) && "bg-clay-50/40",
                )}
              >
                <DayColumnBody items={byDay.get(day) ?? []} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
