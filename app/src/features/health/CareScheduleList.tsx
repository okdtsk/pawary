import type { Role, ScheduleResponse } from "@pawlog/shared";
import { useState } from "react";
import { useSchedules } from "../../api/schedules";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { CategoryIcon, categoryTone } from "../../components/CategoryIcon";
import { EmptyState } from "../../components/EmptyState";
import { Spinner } from "../../components/Spinner";
import { useLocaleTag, useT } from "../../i18n";
import type { Messages } from "../../i18n/messages";
import { cn } from "../../lib/cn";
import { dayKeyOf, dayStartMs, deviceTzOffsetMin, formatTime, todayKey } from "../../lib/dates";
import { ScheduleSheet } from "./ScheduleSheet";
import { useCompleteWithUndo } from "./useCompleteWithUndo";

export function recurrenceLabel(s: ScheduleResponse, t: Messages): string {
  const n = s.recurrenceN ?? 1;
  switch (s.recurrenceUnit) {
    case "once":
      return t.care.recurrence.once;
    case "hour":
      return t.care.recurrence.hours(n);
    case "day":
      return t.care.recurrence.days(n);
    case "week":
      return t.care.recurrence.weeks(n);
    case "month":
      return t.care.recurrence.months(n);
  }
}

export function DueBadge({ schedule }: { schedule: ScheduleResponse }) {
  const t = useT();
  const tag = useLocaleTag();
  const pill = "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold";
  if (!schedule.active) {
    return <span className={cn(pill, "bg-cream-200 text-ink-faint")}>{t.care.finishedBadge}</span>;
  }
  const now = Date.now();
  const tz = deviceTzOffsetMin();
  if (schedule.nextDueAt < now) {
    return <span className={cn(pill, "bg-berry-100 text-berry-700")}>{t.care.overdue}</span>;
  }
  const dueDay = dayKeyOf(schedule.nextDueAt, tz);
  const today = todayKey();
  if (dueDay === today) {
    return (
      <span className={cn(pill, "bg-clay-100 text-clay-800")}>
        {t.care.dueToday(formatTime(schedule.nextDueAt, tz, tag))}
      </span>
    );
  }
  const days = Math.round((dayStartMs(dueDay) - dayStartMs(today)) / 86_400_000);
  return <span className={cn(pill, "bg-cream-200 text-ink-soft")}>{t.care.dueIn(days)}</span>;
}

export function CareScheduleList({ petId, role }: { petId: string; role: Role }) {
  const t = useT();
  const schedules = useSchedules(petId);
  const { complete, isPending } = useCompleteWithUndo(petId);
  const [editing, setEditing] = useState<ScheduleResponse | null>(null);
  const canEdit = role !== "viewer";

  if (schedules.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  const items = schedules.data ?? [];

  return (
    <>
      {items.length === 0 ? (
        <Card className="p-0">
          <EmptyState title={t.care.emptyTitle} hint={t.care.emptyHint} />
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-cream-200">
            {items.map((s) => {
              const tone = categoryTone[s.categoryLink];
              return (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                      tone.soft,
                      tone.text,
                    )}
                  >
                    <CategoryIcon category={s.categoryLink} className="h-5 w-5" />
                  </span>
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    disabled={!canEdit}
                    onClick={() => setEditing(s)}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold text-ink">{s.name}</span>
                      <DueBadge schedule={s} />
                    </span>
                    <span className="block text-xs text-ink-faint">
                      {t.care.types[s.type]} · {recurrenceLabel(s, t)}
                    </span>
                  </button>
                  {canEdit && s.active && (
                    <Button size="sm" variant="soft" disabled={isPending} onClick={() => complete(s)}>
                      {t.care.complete}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <ScheduleSheet
        petId={petId}
        open={editing !== null}
        onClose={() => setEditing(null)}
        schedule={editing ?? undefined}
      />
    </>
  );
}
