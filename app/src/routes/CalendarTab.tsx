import { useState } from "react";
import { useSearchParams } from "react-router";
import { useDaySummary } from "../api/activities";
import { IconButton } from "../components/IconButton";
import { Timeline } from "../features/calendar/Timeline";
import { ChevronLeftIcon, ChevronRightIcon } from "../components/icons";
import { DaySheet } from "../features/calendar/DaySheet";
import { MonthGrid } from "../features/calendar/MonthGrid";
import { useLocaleTag, useT } from "../i18n";
import { cn } from "../lib/cn";
import {
  formatDayHeading,
  formatDayShort,
  formatMonthTitle,
  monthKeyOf,
  shiftAnchor,
  shiftMonth,
  todayKey,
  viewDays,
  type CalendarView,
  type DayKey,
} from "../lib/dates";
import { useSwipe } from "../lib/useSwipe";
import { useRequiredPet } from "../state/pets";

const VIEWS: CalendarView[] = ["month", "week", "3day", "day"];

export function CalendarTab() {
  const t = useT();
  const tag = useLocaleTag();
  const pet = useRequiredPet();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sheetDay, setSheetDay] = useState<DayKey | null>(null);

  const viewParam = searchParams.get("view");
  const view: CalendarView = VIEWS.includes(viewParam as CalendarView)
    ? (viewParam as CalendarView)
    : "month";
  const dateParam = searchParams.get("date");
  const date: DayKey = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? "")
    ? (dateParam as DayKey)
    : todayKey();

  const setParams = (nextView: CalendarView, nextDate: DayKey) =>
    setSearchParams({ view: nextView, date: nextDate }, { replace: true });

  const monthKey = monthKeyOf(date);
  const summary = useDaySummary(pet.id, monthKey);

  const shift = (delta: number) => {
    if (view === "month") {
      setParams(view, `${shiftMonth(monthKey, delta)}-01`);
    } else {
      setParams(view, shiftAnchor(view, date, delta));
    }
  };
  const swipe = useSwipe({ onLeft: () => shift(1), onRight: () => shift(-1) });

  const title =
    view === "month"
      ? formatMonthTitle(monthKey, tag)
      : view === "day"
        ? formatDayHeading(date, tag)
        : (() => {
            const days = viewDays(view, date);
            const last = days[days.length - 1] ?? date;
            return `${formatDayShort(days[0] ?? date, tag)} – ${formatDayShort(last, tag)}`;
          })();

  return (
    <div className="animate-pop flex flex-col gap-3">
      {/* segmented view switcher */}
      <div
        role="group"
        aria-label={t.nav.calendar}
        className="flex rounded-full bg-cream-200 p-1"
      >
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setParams(v, date)}
            className={cn(
              "flex-1 rounded-full py-1.5 text-sm font-semibold transition",
              view === v
                ? "bg-paper text-clay-700 shadow-card"
                : "text-ink-soft hover:text-ink",
            )}
          >
            {t.calendar.views[v]}
          </button>
        ))}
      </div>

      {/* range header */}
      <div className="flex items-center justify-between">
        <IconButton label={t.calendar.previous} onClick={() => shift(-1)}>
          <ChevronLeftIcon className="h-5 w-5" />
        </IconButton>
        <button
          type="button"
          className="font-display text-lg text-ink"
          onClick={() => setParams(view, todayKey())}
          title={t.common.today}
        >
          {title}
        </button>
        <IconButton label={t.calendar.next} onClick={() => shift(1)}>
          <ChevronRightIcon className="h-5 w-5" />
        </IconButton>
      </div>

      {view === "month" ? (
        <div {...swipe}>
          <MonthGrid
            monthKey={monthKey}
            days={summary.data?.days}
            onSelectDay={setSheetDay}
          />
        </div>
      ) : (
        <Timeline
          petId={pet.id}
          days={viewDays(view, date)}
          onShift={(delta) => setParams(view, shiftAnchor(view, date, delta))}
        />
      )}

      <DaySheet petId={pet.id} day={sheetDay} onClose={() => setSheetDay(null)} />
    </div>
  );
}
