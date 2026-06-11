import type { InsightsResponse } from "@pawlog/shared";
import { EmptyState } from "../../components/EmptyState";
import { useLocaleTag, useT } from "../../i18n";
import { bucketLabel } from "./bucketLabel";

const W = 360;
const LANE_H = 84;
const GAP = 26;
const PAD = { left: 38, right: 10, top: 12, bottom: 16 };
const INNER_W = W - PAD.left - PAD.right; // 312
const H = PAD.top + LANE_H * 2 + GAP + PAD.bottom; // 222

type Lane = {
  values: Record<string, number>;
  /** target already scaled per bucket (×7 for week buckets) */
  target: number | null;
  color: string;
  label: string;
  unit: string;
};

export function IntakeChart({
  intake,
  buckets,
  bucket,
}: {
  intake: InsightsResponse["intake"];
  buckets: string[];
  bucket: "day" | "week";
}) {
  const t = useT();
  const tag = useLocaleTag();
  if (Object.keys(intake.food).length === 0 && Object.keys(intake.water).length === 0) {
    return <EmptyState title={t.health.intakeEmpty} className="py-6" />;
  }

  const mult = bucket === "week" ? 7 : 1;
  const lanes: Lane[] = [
    {
      values: intake.food,
      target: intake.targets?.foodGPerDay != null ? intake.targets.foodGPerDay * mult : null,
      color: "var(--color-cat-food)",
      label: t.health.food,
      unit: "g",
    },
    {
      values: intake.water,
      target: intake.targets?.waterMlPerDay != null ? intake.targets.waterMlPerDay * mult : null,
      color: "var(--color-cat-water)",
      label: t.health.water,
      unit: "ml",
    },
  ];
  const slot = INNER_W / buckets.length;
  const barW = Math.max(Math.min(slot * 0.7, 14), 1.5);

  const renderLane = (lane: Lane, laneIndex: number) => {
    const top = PAD.top + laneIndex * (LANE_H + GAP);
    const baseline = top + LANE_H;
    const peak = Math.max(...Object.values(lane.values), lane.target ?? 0, 1);
    const scale = LANE_H / (peak * 1.15);
    return (
      <g key={lane.label}>
        <text x={PAD.left} y={top - 3} fontSize={10} fontWeight={700} fill={lane.color}>
          {lane.label}
        </text>
        <line x1={PAD.left} x2={W - PAD.right} y1={baseline} y2={baseline} stroke="var(--color-cream-300)" strokeWidth={1} />
        {buckets.map((b, i) => {
          const cx = PAD.left + (i + 0.5) * slot;
          const v = lane.values[b];
          if (v === undefined) {
            // not logged: hollow marker (spec §7 — distinct from a real bar)
            return (
              <g key={b}>
                <title>{`${bucketLabel(b, bucket, tag)}: ${t.health.notLogged}`}</title>
                <rect x={cx - barW / 2} y={baseline - 4} width={barW} height={4} rx={1} fill="none" stroke="var(--color-cream-300)" strokeWidth={1} />
              </g>
            );
          }
          const h = Math.max(v * scale, 2);
          return (
            <g key={b}>
              <title>{`${bucketLabel(b, bucket, tag)}: ${v} ${lane.unit}`}</title>
              <rect x={cx - barW / 2} y={baseline - h} width={barW} height={h} rx={1.5} fill={lane.color} />
            </g>
          );
        })}
        {lane.target !== null && (
          <g>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={baseline - lane.target * scale}
              y2={baseline - lane.target * scale}
              stroke={lane.color}
              strokeWidth={1.2}
              strokeDasharray="4 3"
              opacity={0.8}
            />
            <text x={W - PAD.right} y={baseline - lane.target * scale - 3} textAnchor="end" fontSize={9} fill={lane.color}>
              {`${t.health.target} ${Math.round(lane.target)} ${lane.unit}`}
            </text>
          </g>
        )}
      </g>
    );
  };

  const axis = [...new Set([buckets[0]!, buckets[Math.floor(buckets.length / 2)]!, buckets[buckets.length - 1]!])];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t.health.intakeTitle}>
        {lanes.map(renderLane)}
        {axis.map((b) => (
          <text
            key={b}
            x={PAD.left + (buckets.indexOf(b) + 0.5) * slot}
            y={H - 4}
            textAnchor="middle"
            fontSize={9}
            fill="var(--color-ink-faint)"
          >
            {bucketLabel(b, bucket, tag)}
          </text>
        ))}
      </svg>
      <p className="mt-1 text-xs text-ink-faint">{t.health.gramsOnlyHint}</p>
    </div>
  );
}
