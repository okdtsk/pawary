import type { Anomaly } from "@pawary/shared";
import { useState } from "react";
import { Link } from "react-router";
import { IconButton } from "../../components/IconButton";
import { XIcon } from "../../components/icons";
import { useT } from "../../i18n";
import type { Messages } from "../../i18n/messages";
import { cn } from "../../lib/cn";
import { todayKey } from "../../lib/dates";
import { dismissAnomaly, isDismissed } from "./dismissals";

/** Localized copy from structured params — the only place anomaly text exists. */
export function anomalyMessage(a: Anomaly, petName: string, t: Messages): string {
  switch (a.rule) {
    case "weight_drift":
      return t.anomalies.weightDrift(
        `${a.params.pctChange > 0 ? "+" : ""}${a.params.pctChange}`,
      );
    case "toilet_trouble":
      return t.anomalies.toiletTrouble(a.params.count);
    case "quiet_day":
      return t.anomalies.quietDay(petName);
    case "symptom_streak":
      return t.anomalies.symptomStreak(a.params.name, a.params.days);
  }
}

export function AnomalyBanners({
  petId,
  petName,
  anomalies,
  linkToHealth = false,
}: {
  petId: string;
  petName: string;
  anomalies: Anomaly[];
  /** on Home: deep-link each banner to the Health tab (spec §7) */
  linkToHealth?: boolean;
}) {
  const t = useT();
  const today = todayKey();
  const [, setVersion] = useState(0); // re-render after a dismissal
  const visible = anomalies.filter((a) => !isDismissed(petId, a, today));
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" data-slot="anomaly-banners">
      {visible.map((a) => (
        <div
          key={`${a.rule}-${a.rule === "symptom_streak" ? a.params.name : ""}`}
          role="status"
          className={cn(
            "animate-pop flex items-start gap-3 rounded-card border p-3 shadow-card",
            a.severity === "warning"
              ? "border-berry-600/30 bg-berry-100"
              : "border-clay-300/50 bg-clay-50",
          )}
        >
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-sm font-semibold",
                a.severity === "warning" ? "text-berry-700" : "text-clay-800",
              )}
            >
              {anomalyMessage(a, petName, t)}
            </p>
            <p className="text-xs text-ink-soft">{t.anomalies.advice}</p>
            {linkToHealth && (
              <Link
                to={`/health#${a.rule}`}
                className="text-xs font-semibold text-clay-600 underline underline-offset-4"
              >
                {t.anomalies.view}
              </Link>
            )}
          </div>
          <IconButton
            label={t.anomalies.dismiss}
            onClick={() => {
              dismissAnomaly(petId, a, today);
              setVersion((v) => v + 1);
            }}
          >
            <XIcon className="h-4 w-4" />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
