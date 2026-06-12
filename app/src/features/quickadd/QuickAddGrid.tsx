import type { PresetResponse } from "@pawary/shared";
import { Link } from "react-router";
import { useCreateActivity, useDeleteActivity } from "../../api/activities";
import { usePresets } from "../../api/presets";
import { CategoryIcon, categoryTone } from "../../components/CategoryIcon";
import { EmptyState } from "../../components/EmptyState";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/Toast";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { deviceTzOffsetMin } from "../../lib/dates";
import { friendlyError } from "../../lib/errors";

export function QuickAddGrid({
  petId,
  onLogged,
}: {
  petId: string;
  /** e.g. close the surrounding sheet */
  onLogged?: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const presets = usePresets(petId);
  const create = useCreateActivity(petId);
  const remove = useDeleteActivity(petId);

  if (presets.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  const items = presets.data ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        title={t.quickAdd.emptyTitle}
        hint={t.quickAdd.emptyHint}
        action={
          <Link
            to="/settings/presets"
            className="font-semibold text-clay-600 underline underline-offset-4"
          >
            {t.quickAdd.manage}
          </Link>
        }
      />
    );
  }

  const tap = (preset: PresetResponse) => {
    create.mutate(
      {
        category: preset.category,
        occurredAt: Date.now(),
        tzOffsetMin: deviceTzOffsetMin(),
        details: preset.details ?? {},
      },
      {
        onSuccess: (activity) => {
          onLogged?.();
          toast.show(t.quickAdd.logged(preset.label), {
            action: {
              label: t.quickAdd.undo,
              onClick: () =>
                remove.mutate(activity.id, {
                  onSuccess: () => toast.show(t.quickAdd.undone),
                }),
            },
          });
        },
        onError: (error) => toast.show(friendlyError(error, t), { tone: "danger" }),
      },
    );
  };

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {items.map((preset) => {
        const tone = categoryTone[preset.category];
        return (
          <button
            key={preset.id}
            type="button"
            disabled={create.isPending}
            onClick={() => tap(preset)}
            className={cn(
              "flex items-center gap-2.5 rounded-card border border-cream-200 bg-paper px-3 py-2.5 text-left shadow-card transition",
              "hover:border-cream-300 active:scale-[0.97] disabled:opacity-60",
            )}
          >
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                tone.soft,
                tone.text,
              )}
            >
              <CategoryIcon category={preset.category} className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">
                {preset.label}
              </span>
              <span className="block text-xs text-ink-faint">
                {t.categories[preset.category]}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
