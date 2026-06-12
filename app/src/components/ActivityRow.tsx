import type { ActivityResponse } from "@pawary/shared";
import { Link } from "react-router";
import { useLocaleTag, useT } from "../i18n";
import { summarizeActivity } from "../lib/activitySummary";
import { formatTime } from "../lib/dates";
import { CategoryIcon, categoryTone } from "./CategoryIcon";
import { CameraIcon } from "./icons";
import { cn } from "../lib/cn";

export function ActivityRow({ activity }: { activity: ActivityResponse }) {
  const t = useT();
  const tag = useLocaleTag();
  const tone = categoryTone[activity.category];
  const summary = summarizeActivity(activity, t);

  return (
    <Link
      to={`/pets/${activity.petId}/activities/${activity.id}`}
      className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-cream-50"
    >
      <span className="w-11 shrink-0 text-sm font-semibold tabular-nums text-ink-faint">
        {formatTime(activity.occurredAt, activity.tzOffsetMin, tag)}
      </span>
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          tone.soft,
          tone.text,
        )}
      >
        <CategoryIcon category={activity.category} className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-ink">
            {t.categories[activity.category]}
          </span>
          {summary && (
            <span className="truncate text-sm text-ink-soft">{summary}</span>
          )}
        </span>
        {activity.memo && (
          <span className="block truncate text-xs text-ink-faint">
            {activity.memo}
          </span>
        )}
      </span>
      {activity.photos.length > 0 && (
        <CameraIcon className="h-4 w-4 shrink-0 text-ink-faint" />
      )}
    </Link>
  );
}
