import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useActivitiesRange } from "../../api/activities";
import { Spinner } from "../../components/Spinner";
import { useLocaleTag } from "../../i18n";
import { cn } from "../../lib/cn";
import { addDays, formatDayShort, isWeekend, rangeMs, type DayKey } from "../../lib/dates";
import {
  DAY_HEIGHT,
  DayColumnBody,
  HOUR_PX,
  HourAxis,
  useHourLabel,
  usePlacedByDay,
} from "./timelineShared";

const PAST = 21; // days rendered before the anchor
const FUTURE = 7; // days rendered after the anchor
const EXTEND_BY = 14; // days added when nearing an edge
const EDGE_COLS = 4; // trigger extend within this many columns of an edge
const MAX_DAYS = 84; // cap window size; trim the far edge beyond this

/** Imperative controls the parent's arrow buttons / Today button drive. */
export type ThreeDayControls = {
  step: (delta: number) => void;
  toToday: (today: DayKey) => void;
};

function makeWindow(anchor: DayKey): DayKey[] {
  const start = addDays(anchor, -PAST);
  return Array.from({ length: PAST + FUTURE + 1 }, (_, i) => addDays(start, i));
}

export function ThreeDayTimeline({
  petId,
  anchor,
  today,
  startHour,
  weekendColor,
  hhOffset,
  controlsRef,
  onVisibleChange,
}: {
  petId: string;
  anchor: DayKey;
  today: DayKey;
  startHour: number;
  weekendColor: boolean;
  hhOffset: number;
  controlsRef: { current: ThreeDayControls | null };
  onVisibleChange: (leftmost: DayKey) => void;
}) {
  const tag = useLocaleTag();
  const hourLabel = useHourLabel();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [windowDays, setWindowDays] = useState<DayKey[]>(() => makeWindow(anchor));
  const [colWidth, setColWidth] = useState(0);

  const { from, to } = rangeMs(windowDays, hhOffset);
  const activities = useActivitiesRange(petId, from, to);
  const byDay = usePlacedByDay(activities.data, windowDays);

  // Measure a column = 1/3 of the scroll viewport.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setColWidth(el.clientWidth / 3);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scroll the anchor to the rightmost of the 3 visible columns.
  const scrollAnchorRight = useCallback(
    (days: DayKey[], targetAnchor: DayKey, smooth: boolean) => {
      const el = scrollRef.current;
      if (!el || colWidth === 0) return;
      const idx = days.indexOf(targetAnchor);
      if (idx < 0) return;
      el.scrollTo({
        left: (idx - 2) * colWidth,
        top: startHour * HOUR_PX,
        behavior: smooth ? "smooth" : "auto",
      });
    },
    [colWidth, startHour],
  );

  // Initial / external-anchor positioning (mount, colWidth ready, anchor change).
  useEffect(() => {
    const next = makeWindow(anchor);
    setWindowDays(next);
    // Defer until the new window has painted so indexes/scrollWidth are valid.
    requestAnimationFrame(() => scrollAnchorRight(next, anchor, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, colWidth]);

  // Expose imperative controls to the parent.
  useEffect(() => {
    controlsRef.current = {
      step: (delta: number) => {
        if (colWidth === 0) return;
        scrollRef.current?.scrollBy({ left: delta * colWidth, behavior: "smooth" });
      },
      toToday: (t: DayKey) => {
        const next = makeWindow(t);
        setWindowDays(next);
        requestAnimationFrame(() => scrollAnchorRight(next, t, false));
      },
    };
    return () => {
      controlsRef.current = null;
    };
  }, [colWidth, scrollAnchorRight, controlsRef]);

  // Horizontal scroll: report visible day + extend/trim at the edges.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || colWidth === 0) return;
    const leftIdx = Math.round(el.scrollLeft / colWidth);
    const leftmost = windowDays[Math.max(0, Math.min(leftIdx, windowDays.length - 1))];
    if (leftmost) onVisibleChange(leftmost);

    // Near left edge: prepend, preserving scroll position.
    if (leftIdx <= EDGE_COLS) {
      setWindowDays((prev) => {
        const head = prev[0];
        if (!head) return prev;
        const added = Array.from({ length: EXTEND_BY }, (_, i) =>
          addDays(head, -(EXTEND_BY - i)),
        );
        let next = [...added, ...prev];
        if (next.length > MAX_DAYS) {
          next = next.slice(0, MAX_DAYS);
        }
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollLeft += EXTEND_BY * colWidth;
          }
        });
        return next;
      });
      return;
    }

    // Near right edge: append, trimming the far-left if needed.
    if (leftIdx >= windowDays.length - 3 - EDGE_COLS) {
      setWindowDays((prev) => {
        const tail = prev[prev.length - 1];
        if (!tail) return prev;
        const added = Array.from({ length: EXTEND_BY }, (_, i) =>
          addDays(tail, i + 1),
        );
        let next = [...prev, ...added];
        if (next.length > MAX_DAYS) {
          const trim = next.length - MAX_DAYS;
          next = next.slice(trim);
          requestAnimationFrame(() => {
            if (scrollRef.current) {
              scrollRef.current.scrollLeft -= trim * colWidth;
            }
          });
        }
        return next;
      });
    }
  }, [colWidth, windowDays, onVisibleChange]);

  return (
    <div className="overflow-hidden rounded-card bg-paper shadow-card">
      {activities.isLoading && windowDays.length === 0 ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="relative max-h-[min(60dvh,560px)] overflow-auto"
          style={{ scrollSnapType: "x mandatory" }}
        >
          {/* sticky header row */}
          <div className="sticky top-0 z-20 flex bg-paper">
            <div className="sticky left-0 z-10 w-12 shrink-0 bg-paper" />
            {windowDays.map((day) => (
              <div
                key={day}
                style={{ width: colWidth || undefined, scrollSnapAlign: "start" }}
                className={cn(
                  "shrink-0 border-l border-cream-100 py-2 text-center text-sm font-semibold",
                  day === today ? "text-clay-600" : "text-ink-soft",
                  weekendColor && isWeekend(day) && "bg-clay-50",
                )}
              >
                {formatDayShort(day, tag)}
              </div>
            ))}
          </div>
          {/* hour grid + day columns */}
          <div className="relative flex" style={{ height: DAY_HEIGHT }}>
            <HourAxis hourLabel={hourLabel} className="sticky left-0 z-10 bg-paper" />
            {windowDays.map((day) => (
              <div
                key={day}
                style={{ width: colWidth || undefined, scrollSnapAlign: "start" }}
                className={cn(
                  "relative shrink-0 border-l border-cream-100",
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
