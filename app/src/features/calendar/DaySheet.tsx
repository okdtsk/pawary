import { useActivitiesRange } from "../../api/activities";
import { ActivityRow } from "../../components/ActivityRow";
import { EmptyState } from "../../components/EmptyState";
import { Sheet } from "../../components/Sheet";
import { Spinner } from "../../components/Spinner";
import { useLocaleTag, useT } from "../../i18n";
import {
  dayEndMs,
  dayStartMs,
  formatDayHeading,
  type DayKey,
} from "../../lib/dates";

export function DaySheet({
  petId,
  day,
  onClose,
}: {
  petId: string;
  day: DayKey | null;
  onClose: () => void;
}) {
  const t = useT();
  const tag = useLocaleTag();
  const enabled = day !== null;
  const activities = useActivitiesRange(
    petId,
    enabled ? dayStartMs(day) : 0,
    enabled ? dayEndMs(day) : 0,
  );
  const items = [...(activities.data ?? [])].sort(
    (a, b) => a.occurredAt - b.occurredAt,
  );

  return (
    <Sheet
      open={enabled}
      onClose={onClose}
      title={day ? formatDayHeading(day, tag) : ""}
    >
      {activities.isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={t.calendar.dayEmpty} />
      ) : (
        <div className="-mx-5 divide-y divide-cream-200">
          {items.map((activity) => (
            <ActivityRow key={activity.id} activity={activity} />
          ))}
        </div>
      )}
    </Sheet>
  );
}
