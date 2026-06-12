import type { Role } from "@pawary/shared";
import { Link } from "react-router";
import { useCareStatus } from "../../api/schedules";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { CategoryIcon, categoryTone } from "../../components/CategoryIcon";
import { SproutIcon } from "../../components/icons";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { DueBadge } from "./CareScheduleList";
import { useCompleteWithUndo } from "./useCompleteWithUndo";

const MAX_ITEMS = 4;

export function CareCard({ petId, role }: { petId: string; role: Role }) {
  const t = useT();
  const status = useCareStatus(petId);
  const { complete, isPending } = useCompleteWithUndo(petId);
  if (!status.data) return null; // loading/error: the card pops in when ready
  const due = [...status.data.overdue, ...status.data.today];
  if (due.length === 0 && status.data.upcoming.length === 0) return null; // nothing scheduled
  const canEdit = role !== "viewer";

  return (
    <Card data-slot="care-items" className="animate-pop p-0" style={{ animationDelay: "60ms" }}>
      <div className="flex items-center justify-between px-4 pt-3">
        <p className="flex items-center gap-2 font-display text-ink">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-moss-100 text-moss-600">
            <SproutIcon className="h-4 w-4" />
          </span>
          {t.care.homeTitle}
        </p>
        <Link to="/health" className="text-sm font-semibold text-clay-600 underline-offset-4 hover:underline">
          {t.care.seeAll}
        </Link>
      </div>
      {due.length === 0 ? (
        <p className="px-4 pb-4 pt-2 text-sm text-ink-soft">{t.care.homeAllDone}</p>
      ) : (
        <ul className="divide-y divide-cream-200 pt-1">
          {due.slice(0, MAX_ITEMS).map((s) => {
            const tone = categoryTone[s.categoryLink];
            return (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    tone.soft,
                    tone.text,
                  )}
                >
                  <CategoryIcon category={s.categoryLink} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-ink">{s.name}</span>
                    <DueBadge schedule={s} />
                  </span>
                </span>
                {canEdit && (
                  <Button size="sm" variant="soft" disabled={isPending} onClick={() => complete(s)}>
                    {t.care.complete}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
