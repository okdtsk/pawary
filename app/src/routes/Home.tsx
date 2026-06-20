import { Link, useOutletContext } from "react-router";
import { useActivitiesRange } from "../api/activities";
import { useAnomalies } from "../api/insights";
import { ActivityRow } from "../components/ActivityRow";
import { PetAvatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { Spinner } from "../components/Spinner";
import { AnomalyBanners } from "../features/health/AnomalyBanners";
import { InstallHint } from "../features/pwa/InstallHint";
import { CareCard } from "../features/health/CareCard";
import { QuickAddGrid } from "../features/quickadd/QuickAddGrid";
import { useLocaleTag, useT } from "../i18n";
import { dayEndMs, dayStartMs, formatDayHeading, todayKey } from "../lib/dates";
import { useRequiredPet } from "../state/pets";
import type { ShellOutletContext } from "./Shell";

export function Home() {
  const t = useT();
  const tag = useLocaleTag();
  const pet = useRequiredPet();
  const canEdit = pet.role !== "viewer";
  const { openAdd } = useOutletContext<ShellOutletContext>();
  const today = todayKey();
  const activities = useActivitiesRange(
    pet.id,
    dayStartMs(today),
    dayEndMs(today),
  );
  const anomalies = useAnomalies(pet.id);
  const items = [...(activities.data ?? [])].sort(
    (a, b) => b.occurredAt - a.occurredAt,
  );

  return (
    <div className="flex flex-col gap-5">
      {/* greeting hero */}
      <section className="animate-pop flex items-center gap-4">
        <PetAvatar pet={pet} size="lg" />
        <div>
          <h1 className="text-2xl text-ink">{t.home.greeting(pet.name)}</h1>
          <p className="text-sm text-ink-faint">
            {formatDayHeading(today, tag)}
          </p>
        </div>
      </section>

      <InstallHint />

      {/* anomaly banners (lightweight rules-only endpoint), deep-linked to Health */}
      <AnomalyBanners
        petId={pet.id}
        petName={pet.name}
        anomalies={anomalies.data?.anomalies ?? []}
        linkToHealth
      />

      {/* care items: overdue / due today, complete with undo */}
      <CareCard petId={pet.id} role={pet.role} />

      {/* today so far */}
      <section className="animate-pop" style={{ animationDelay: "120ms" }}>
        <h2 className="mb-2 font-display text-lg text-ink">
          {t.home.todaySoFar}
        </h2>
        <Card className="p-0">
          {activities.isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              title={t.home.quietTitle}
              hint={t.home.quietHint}
              action={
                canEdit ? (
                  <Button size="sm" onClick={openAdd}>
                    {t.nav.addActivity}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="divide-y divide-cream-200">
              {items.map((activity) => (
                <ActivityRow key={activity.id} activity={activity} />
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* quick add (editors only — viewers cannot log).
          Pinned to the bottom of the viewport so it stays reachable no matter
          how long the "today so far" list grows; the grid itself scrolls when
          it exceeds the capped height. */}
      {canEdit && (
        <section
          className="animate-pop sticky bottom-[calc(env(safe-area-inset-bottom)+3.75rem)] z-20 -mx-4 mt-1 border-t border-cream-200 bg-cream-100/95 px-4 pb-3 pt-3 backdrop-blur md:bottom-4 md:mx-0 md:rounded-card md:border md:shadow-card"
          style={{ animationDelay: "180ms" }}
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-lg text-ink">{t.quickAdd.title}</h2>
            <Link
              to="/settings/presets"
              className="text-sm font-semibold text-clay-600 underline-offset-4 hover:underline"
            >
              {t.quickAdd.manage}
            </Link>
          </div>
          <div className="max-h-[40vh] overflow-y-auto">
            <QuickAddGrid petId={pet.id} />
          </div>
        </section>
      )}
    </div>
  );
}
