import { CATEGORIES, type DaySummaryResponse } from "@pawary/shared";
import { categoryTone } from "../../components/CategoryIcon";
import { useLocaleTag } from "../../i18n";
import { cn } from "../../lib/cn";
import {
  dayKeyToParts,
  isWeekend,
  monthGrid,
  type DayKey,
  type MonthKey,
} from "../../lib/dates";

const MAX_DOTS = 4;

function weekdayLabels(tag: string, firstWeek: DayKey[]): string[] {
  const fmt = new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" });
  return firstWeek.map((key) => {
    const { year, month, day } = dayKeyToParts(key);
    return fmt.format(new Date(Date.UTC(year, month - 1, day)));
  });
}

export function MonthGrid({
  monthKey,
  days,
  today,
  weekendColor,
  onSelectDay,
}: {
  monthKey: MonthKey;
  days: DaySummaryResponse["days"] | undefined;
  today: DayKey;
  weekendColor: boolean;
  onSelectDay: (key: DayKey) => void;
}) {
  const tag = useLocaleTag();
  const cells = monthGrid(monthKey);
  const headers = weekdayLabels(tag, cells.slice(0, 7).map((c) => c.key));

  return (
    <div>
      <div className="grid grid-cols-7 pb-1">
        {headers.map((label) => (
          <span
            key={label}
            className="text-center text-xs font-semibold text-ink-faint"
          >
            {label}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-card bg-paper shadow-card">
        {cells.map((cell) => {
          const counts = days?.[cell.key];
          // stable category order for the dots
          const cats = counts
            ? CATEGORIES.filter((c) => (counts[c] ?? 0) > 0)
            : [];
          const shown = cats.slice(0, MAX_DOTS);
          const extra = cats.length - shown.length;
          const isToday = cell.key === today;
          return (
            <button
              key={cell.key}
              type="button"
              onClick={() => onSelectDay(cell.key)}
              className={cn(
                "flex min-h-16 flex-col items-center gap-1 border-b border-r border-cream-100 py-1.5 transition hover:bg-cream-50 active:bg-cream-100",
                !cell.inMonth && "opacity-35",
                weekendColor && isWeekend(cell.key) && "bg-clay-50",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
                  isToday ? "bg-clay-500 text-white" : "text-ink",
                )}
              >
                {dayKeyToParts(cell.key).day}
              </span>
              <span className="flex h-3 items-center gap-0.5">
                {shown.map((cat) => (
                  <span
                    key={cat}
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      categoryTone[cat].bg,
                    )}
                  />
                ))}
                {extra > 0 && (
                  <span className="text-[9px] font-bold leading-none text-ink-faint">
                    +{extra}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
