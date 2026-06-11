import type { InsightsResponse } from "@pawlog/shared";
import { EmptyState } from "../../components/EmptyState";
import { useLocaleTag, useT } from "../../i18n";

const W = 360;
const ROW_H = 20;
const GUTTER = 92;
const PAD_R = 10;
const AXIS_H = 16;
const TOP = 8;
const INNER_W = W - GUTTER - PAD_R; // 258

const SEVERITY_OPACITY = { mild: 0.45, moderate: 0.7, severe: 1 } as const;
const LANE_COLOR = {
  medication: "var(--color-cat-medication)",
  symptom: "var(--color-cat-symptom)",
} as const;

/** Household-naive ms → label (read as UTC, like all household math). */
function dateLabel(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
}

export function CareTimeline({
  timeline,
  windowStart,
  windowEnd,
}: {
  timeline: InsightsResponse["timeline"];
  windowStart: number;
  windowEnd: number;
}) {
  const t = useT();
  const tag = useLocaleTag();
  const { medications, symptoms, vetVisits } = timeline;
  if (medications.length === 0 && symptoms.length === 0 && vetVisits.length === 0) {
    return <EmptyState title={t.health.timelineEmpty} className="py-6" />;
  }

  const x = (ms: number) =>
    GUTTER + Math.min(Math.max((ms - windowStart) / (windowEnd - windowStart), 0), 1) * INNER_W;

  const lanes = [
    ...medications.map((s) => ({ ...s, kind: "medication" as const, opacity: 0.85 })),
    ...symptoms.map((s) => ({ ...s, kind: "symptom" as const, opacity: SEVERITY_OPACITY[s.maxSeverity] })),
  ];
  const vetRow = vetVisits.length > 0 ? 1 : 0;
  const H = TOP + (vetRow + lanes.length) * ROW_H + AXIS_H;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t.health.timelineTitle}>
      {vetRow === 1 && (
        <g>
          <text x={GUTTER - 6} y={TOP + ROW_H - 7} textAnchor="end" fontSize={9} fontWeight={700} fill="var(--color-cat-vet)">
            {t.health.vetVisits}
          </text>
          {vetVisits.map((v, i) => (
            <g key={`${v.at}-${i}`}>
              <title>{`${dateLabel(v.at, tag)}${v.clinic ? ` · ${v.clinic}` : ""}`}</title>
              <path d={`M${x(v.at).toFixed(1)} ${TOP + 3} l5 6 -5 6 -5 -6 Z`} fill="var(--color-cat-vet)" />
            </g>
          ))}
        </g>
      )}
      {lanes.map((lane, i) => {
        const y0 = TOP + (vetRow + i) * ROW_H;
        const x1 = x(lane.firstAt);
        const w = Math.max(x(lane.lastAt) - x1, 6);
        return (
          <g key={`${lane.kind}-${lane.name}`}>
            <text x={GUTTER - 6} y={y0 + ROW_H - 7} textAnchor="end" fontSize={9} fill="var(--color-ink-soft)">
              {lane.name.length > 14 ? `${lane.name.slice(0, 13)}…` : lane.name}
            </text>
            <line x1={GUTTER} x2={W - PAD_R} y1={y0 + ROW_H / 2} y2={y0 + ROW_H / 2} stroke="var(--color-cream-200)" strokeWidth={1} />
            <g>
              <title>{`${lane.name}: ${lane.count}× (${dateLabel(lane.firstAt, tag)} – ${dateLabel(lane.lastAt, tag)})`}</title>
              <rect x={x1 - 3} y={y0 + ROW_H / 2 - 5} width={w + 6} height={10} rx={5} fill={LANE_COLOR[lane.kind]} opacity={lane.opacity} />
            </g>
          </g>
        );
      })}
      {[windowStart, (windowStart + windowEnd) / 2, windowEnd - 1].map((ms, i) => (
        <text
          key={ms}
          x={x(ms)}
          y={H - 4}
          textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
          fontSize={9}
          fill="var(--color-ink-faint)"
        >
          {dateLabel(ms, tag)}
        </text>
      ))}
    </svg>
  );
}
