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
  // False while a programmatic (re)position is in flight; gates onScroll so the
  // initial scroll + scroll-snap settle can't trigger edge-extension.
  const readyRef = useRef(false);
  const [windowDays, setWindowDays] = useState<DayKey[]>(() => makeWindow(anchor));
  const [colWidth, setColWidth] = useState(0);
  // Latest window/colWidth for the once-attached scrollend listener, so a
  // post-extension scroll correction can't be read against a stale window.
  const windowRef = useRef(windowDays);
  windowRef.current = windowDays;
  const colWidthRef = useRef(colWidth);
  colWidthRef.current = colWidth;

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
      // Suppress edge-extension until this scroll (and any snap re-settle) lands.
      readyRef.current = false;
      el.scrollTo({
        left: (idx - 2) * colWidth,
        top: startHour * HOUR_PX,
        behavior: smooth ? "smooth" : "auto",
      });
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          readyRef.current = true;
        }),
      );
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

  // Horizontal scroll: extend/trim the window at the edges. (The visible-day
  // title is reported separately on `scrollend`, off the snapped position, so
  // it can never disagree with the rendered columns.)
  const onScroll = useCallback(() => {
    // Ignore scroll events fired by programmatic positioning OR while a prior
    // extension's scroll correction is still settling — otherwise a continuous
    // wheel/touch scroll stacks prepends and overshoots.
    if (!readyRef.current) return;
    const el = scrollRef.current;
    if (!el || colWidth === 0) return;
    const leftIdx = Math.round(el.scrollLeft / colWidth);

    // Re-enable extension only after the DOM has grown and the scroll
    // correction has been applied (one extension per settle).
    const settle = () =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          readyRef.current = true;
        }),
      );

    // Near left edge: prepend, preserving scroll position.
    if (leftIdx <= EDGE_COLS) {
      const head = windowDays[0];
      if (!head) return;
      readyRef.current = false;
      const added = Array.from({ length: EXTEND_BY }, (_, i) =>
        addDays(head, -(EXTEND_BY - i)),
      );
      let next = [...added, ...windowDays];
      if (next.length > MAX_DAYS) next = next.slice(0, MAX_DAYS);
      setWindowDays(next);
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollLeft += EXTEND_BY * colWidth;
        settle();
      });
      return;
    }

    // Near right edge: append, trimming the far-left if needed.
    if (leftIdx >= windowDays.length - 3 - EDGE_COLS) {
      const tail = windowDays[windowDays.length - 1];
      if (!tail) return;
      readyRef.current = false;
      const added = Array.from({ length: EXTEND_BY }, (_, i) => addDays(tail, i + 1));
      let next = [...windowDays, ...added];
      let trim = 0;
      if (next.length > MAX_DAYS) {
        trim = next.length - MAX_DAYS;
        next = next.slice(trim);
      }
      setWindowDays(next);
      requestAnimationFrame(() => {
        if (trim > 0 && scrollRef.current) scrollRef.current.scrollLeft -= trim * colWidth;
        settle();
      });
    }
  }, [colWidth, windowDays]);

  // Report the leftmost visible day once scrolling settles (snap complete), so
  // the header title always matches the rendered columns. `scrollend` fires
  // after the snap animation; a short fallback covers engines without it.
  // Attached once; reads the latest window/colWidth via refs to stay correct
  // across extensions (which mutate the window right before the correction).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let fallback = 0;
    const reportSettled = () => {
      const cw = colWidthRef.current;
      if (cw === 0) return;
      const arr = windowRef.current;
      const li = Math.round(el.scrollLeft / cw);
      const lm = arr[Math.max(0, Math.min(li, arr.length - 1))];
      if (lm) onVisibleChange(lm);
    };
    const onScrollFallback = () => {
      window.clearTimeout(fallback);
      fallback = window.setTimeout(reportSettled, 120);
    };
    el.addEventListener("scrollend", reportSettled);
    el.addEventListener("scroll", onScrollFallback);
    return () => {
      el.removeEventListener("scrollend", reportSettled);
      el.removeEventListener("scroll", onScrollFallback);
      window.clearTimeout(fallback);
    };
  }, [onVisibleChange]);

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
          data-pull-ignore
          className="relative max-h-[min(60dvh,560px)] overflow-auto"
          style={{ scrollSnapType: "x mandatory" }}
        >
          {/* sticky header row — w-max so the sticky-left gutter's containing
              block spans the full scroll width and stays pinned throughout */}
          <div className="sticky top-0 z-20 flex w-max bg-paper">
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
          {/* hour grid + day columns — w-max so the sticky-left hour axis stays
              pinned across the full horizontal scroll (not just one viewport) */}
          <div className="relative flex w-max" style={{ height: DAY_HEIGHT }}>
            <HourAxis hourLabel={hourLabel} />
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
