import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { useLocaleTag, useT } from "../i18n";
import { cn } from "../lib/cn";
import {
  addDays,
  dayKeyToParts,
  localComposeMs,
  localDayKey,
  todayKey,
  type DayKey,
} from "../lib/dates";

const ITEM_H = 36;
const VISIBLE = 5;
// spacer so the first/last option can rest in the center band
const PAD = (ITEM_H * (VISIBLE - 1)) / 2;
// how long the picker stays fully scrollable into the past / future
const DAYS_BACK = 366;
const DAYS_AHEAD = 31;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => pad2(i));
const MINUTE_LABELS = Array.from({ length: 60 }, (_, i) => pad2(i));

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function WheelColumn({
  label,
  options,
  index,
  onIndexChange,
  className,
}: {
  label: string;
  options: string[];
  index: number;
  onIndexChange: (index: number) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number | undefined>(undefined);
  // last index either emitted from a scroll or received via props — guards
  // against re-emitting while a programmatic smooth-scroll is in flight
  const currentIdx = useRef(index);
  const mounted = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    currentIdx.current = index;
    const top = index * ITEM_H;
    if (!mounted.current) {
      mounted.current = true;
      el.scrollTop = top;
    } else if (Math.abs(el.scrollTop - top) > 1) {
      el.scrollTo({ top, behavior: "smooth" });
    }
  }, [index]);

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  const onScroll = () => {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const idx = clamp(Math.round(el.scrollTop / ITEM_H), 0, options.length - 1);
      if (idx !== currentIdx.current) {
        currentIdx.current = idx;
        onIndexChange(idx);
      }
    }, 150);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number;
    switch (e.key) {
      case "ArrowUp":
        next = index - 1;
        break;
      case "ArrowDown":
        next = index + 1;
        break;
      case "PageUp":
        next = index - VISIBLE;
        break;
      case "PageDown":
        next = index + VISIBLE;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = options.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    next = clamp(next, 0, options.length - 1);
    if (next !== index) onIndexChange(next);
  };

  return (
    <div
      ref={ref}
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={options.length - 1}
      aria-valuenow={index}
      aria-valuetext={options[index]}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      className={cn(
        "no-scrollbar snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-xl",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-clay-200",
        className,
      )}
      style={{ height: ITEM_H * VISIBLE }}
    >
      <div aria-hidden="true" style={{ height: PAD }} />
      {options.map((option, i) => (
        <div
          key={i}
          onClick={() => onIndexChange(i)}
          className={cn(
            "flex cursor-pointer snap-center items-center justify-center whitespace-nowrap",
            i === index ? "font-bold text-ink" : "text-ink-faint",
          )}
          style={{ height: ITEM_H }}
        >
          {option}
        </div>
      ))}
      <div aria-hidden="true" style={{ height: PAD }} />
    </div>
  );
}

/**
 * iOS-style wheel picker: date / hour / minute columns with scroll-snap.
 * Same contract as `DateTimeInput` — epoch ms in, epoch ms out, device-local
 * wall clock, seconds zeroed.
 */
export function WheelDateTimePicker({
  valueMs,
  onChangeMs,
  className,
}: {
  valueMs: number;
  onChangeMs: (ms: number) => void;
  className?: string;
}) {
  const t = useT();
  const locale = useLocaleTag();
  const today = todayKey();

  // fixed on mount so the wheels never shift under the user mid-edit
  const days = useMemo(() => {
    const anchor = localDayKey(valueMs);
    const first = addDays(anchor < today ? anchor : today, -DAYS_BACK);
    const last = addDays(anchor > today ? anchor : today, DAYS_AHEAD);
    const out: DayKey[] = [];
    for (let key = first; key <= last; key = addDays(key, 1)) out.push(key);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dayLabels = useMemo(() => {
    const sameYear = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      weekday: "short",
      timeZone: "UTC",
    });
    const otherYear = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      weekday: "short",
      timeZone: "UTC",
    });
    const currentYear = today.slice(0, 4);
    return days.map((key) => {
      if (key === today) return t.common.today;
      const { year, month, day } = dayKeyToParts(key);
      const fmt = String(year) === currentYear ? sameYear : otherYear;
      return fmt.format(new Date(Date.UTC(year, month - 1, day)));
    });
  }, [days, locale, t, today]);

  const dayKey = localDayKey(valueMs);
  const dayIdx = Math.max(0, days.indexOf(dayKey));
  const local = new Date(valueMs);
  const hour = local.getHours();
  const minute = local.getMinutes();

  return (
    <div
      className={cn(
        "relative rounded-2xl border border-cream-300 bg-paper px-2",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-2 top-1/2 -translate-y-1/2 rounded-xl bg-cream-100"
        style={{ height: ITEM_H }}
      />
      <div className="relative flex items-stretch gap-1">
        <WheelColumn
          label={t.add.pickerDate}
          options={dayLabels}
          index={dayIdx}
          onIndexChange={(i) => onChangeMs(localComposeMs(days[i]!, hour, minute))}
          className="flex-1"
        />
        <WheelColumn
          label={t.add.pickerHour}
          options={HOUR_LABELS}
          index={hour}
          onIndexChange={(h) => onChangeMs(localComposeMs(dayKey, h, minute))}
          className="w-14"
        />
        <WheelColumn
          label={t.add.pickerMinute}
          options={MINUTE_LABELS}
          index={minute}
          onIndexChange={(m) => onChangeMs(localComposeMs(dayKey, hour, m))}
          className="w-14"
        />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-10 rounded-t-2xl bg-gradient-to-b from-paper to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-2xl bg-gradient-to-t from-paper to-transparent"
      />
    </div>
  );
}
