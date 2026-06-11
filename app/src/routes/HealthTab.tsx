import type { InsightsPeriod } from "@pawlog/shared";
import { INSIGHTS_PERIODS } from "@pawlog/shared";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useInsights } from "../api/insights";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { Spinner } from "../components/Spinner";
import { AnomalyBanners } from "../features/health/AnomalyBanners";
import { CareScheduleList } from "../features/health/CareScheduleList";
import { CareTimeline } from "../features/health/CareTimeline";
import { IntakeChart } from "../features/health/IntakeChart";
import { ScheduleSheet } from "../features/health/ScheduleSheet";
import { ToiletMatrix } from "../features/health/ToiletMatrix";
import { WeightChart } from "../features/health/WeightChart";
import { useT } from "../i18n";
import { useRequiredPet } from "../state/pets";

export function HealthTab() {
  const t = useT();
  const pet = useRequiredPet();
  const [period, setPeriod] = useState<InsightsPeriod>("4w");
  const [adding, setAdding] = useState(false);
  const insights = useInsights(pet.id, period);
  const canEdit = pet.role !== "viewer";
  const charts = insights.data;

  // Deep link from a Home anomaly banner: /health#<rule> scrolls to the
  // matching chart once the charts have data. One scroll per hash value.
  const location = useLocation();
  const scrolledHash = useRef<string | null>(null);
  useEffect(() => {
    const hash = location.hash.slice(1);
    if (!charts || !hash || scrolledHash.current === hash) return;
    scrolledHash.current = hash;
    document
      .getElementById(hash)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [charts, location.hash]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="animate-pop text-2xl text-ink">{t.nav.health}</h1>

      {charts && charts.anomalies.length > 0 && (
        <AnomalyBanners petId={pet.id} petName={pet.name} anomalies={charts.anomalies} />
      )}

      <div className="animate-pop flex gap-2" role="group" aria-label={t.nav.health}>
        {INSIGHTS_PERIODS.map((p) => (
          <Chip key={p} selected={period === p} onClick={() => setPeriod(p)}>
            {t.health.periods[p]}
          </Chip>
        ))}
      </div>

      {!charts ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-4 md:grid md:grid-cols-2">
          <Card id="weight_drift" className="animate-pop scroll-mt-24">
            <h2 className="mb-2 font-display text-lg text-ink">{t.health.weightTitle}</h2>
            <WeightChart series={charts.weight} buckets={charts.buckets} bucket={charts.bucket} />
          </Card>
          <Card id="quiet_day" className="animate-pop scroll-mt-24" style={{ animationDelay: "60ms" }}>
            <h2 className="mb-2 font-display text-lg text-ink">{t.health.intakeTitle}</h2>
            <IntakeChart intake={charts.intake} buckets={charts.buckets} bucket={charts.bucket} />
          </Card>
          <Card id="toilet_trouble" className="animate-pop scroll-mt-24" style={{ animationDelay: "120ms" }}>
            <h2 className="mb-2 font-display text-lg text-ink">{t.health.toiletTitle}</h2>
            <ToiletMatrix rows={charts.toilet} buckets={charts.buckets} bucket={charts.bucket} />
          </Card>
          <Card id="symptom_streak" className="animate-pop scroll-mt-24" style={{ animationDelay: "180ms" }}>
            <h2 className="mb-2 font-display text-lg text-ink">{t.health.timelineTitle}</h2>
            <CareTimeline
              timeline={charts.timeline}
              windowStart={charts.windowStart}
              windowEnd={charts.windowEnd}
            />
          </Card>
        </div>
      )}

      <section className="animate-pop" style={{ animationDelay: "240ms" }}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-lg text-ink">{t.care.title}</h2>
          {canEdit && (
            <Button size="sm" onClick={() => setAdding(true)}>
              {t.care.addSchedule}
            </Button>
          )}
        </div>
        <CareScheduleList petId={pet.id} role={pet.role} />
      </section>

      <ScheduleSheet petId={pet.id} open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
