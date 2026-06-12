import type { WeightSeries } from "@pawary/shared";
import { EmptyState } from "../../components/EmptyState";
import { useLocaleTag, useT } from "../../i18n";
import { bucketLabel } from "./bucketLabel";

const W = 360;
const H = 190;
const PAD = { left: 38, right: 10, top: 16, bottom: 20 };
const INNER_W = W - PAD.left - PAD.right; // 312
const INNER_H = H - PAD.top - PAD.bottom; // 154

export function WeightChart({
  series,
  buckets,
  bucket,
}: {
  series: WeightSeries;
  buckets: string[];
  bucket: "day" | "week";
}) {
  const t = useT();
  const tag = useLocaleTag();
  if (series.points.length === 0 || series.min === null || series.max === null) {
    return <EmptyState title={t.health.weightEmpty} className="py-6" />;
  }

  const index = new Map(buckets.map((b, i) => [b, i]));
  const span = Math.max((series.max - series.min) * 0.2, 0.3);
  const lo = series.min - span;
  const hi = series.max + span;
  const x = (b: string) => PAD.left + ((index.get(b) ?? 0) + 0.5) * (INNER_W / buckets.length);
  const y = (kg: number) => PAD.top + (1 - (kg - lo) / (hi - lo)) * INNER_H;
  const path = (pick: (p: WeightSeries["points"][number]) => number) =>
    series.points
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.bucket).toFixed(1)} ${y(pick(p)).toFixed(1)}`)
      .join(" ");

  const ticks = [lo, (lo + hi) / 2, hi];
  const axis = [...new Set([buckets[0]!, buckets[Math.floor(buckets.length / 2)]!, buckets[buckets.length - 1]!])];

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-ink-faint">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-0 w-5 border-t-2 border-dashed border-cat-weight" />
          {t.health.movingAvg}
        </span>
        {series.pctChange !== null && (
          <span className="rounded-full bg-cat-weight-soft px-2.5 py-0.5 font-semibold text-cat-weight">
            {t.health.pctChange(`${series.pctChange > 0 ? "+" : ""}${series.pctChange}`)}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t.health.weightTitle}>
        {/* min–max band */}
        <rect
          x={PAD.left}
          y={y(series.max)}
          width={INNER_W}
          height={Math.max(y(series.min) - y(series.max), 1)}
          fill="var(--color-cat-weight-soft)"
          opacity={0.6}
        />
        {/* y grid + tick labels */}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--color-cream-200)" strokeWidth={1} />
            <text x={PAD.left - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="var(--color-ink-faint)">
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        {/* trend: dashed moving average under the weight line */}
        <path d={path((p) => p.avg7)} fill="none" stroke="var(--color-cat-weight)" strokeWidth={1.5} strokeDasharray="5 4" opacity={0.7} />
        <path d={path((p) => p.kg)} fill="none" stroke="var(--color-cat-weight)" strokeWidth={2} strokeLinejoin="round" />
        {series.points.map((p) => (
          <g key={p.bucket}>
            <title>{`${bucketLabel(p.bucket, bucket, tag)}: ${p.kg} kg`}</title>
            <circle cx={x(p.bucket)} cy={y(p.kg)} r={3} fill="var(--color-cat-weight)" stroke="var(--color-paper)" strokeWidth={1} />
          </g>
        ))}
        {/* x labels: first / middle / last bucket */}
        {axis.map((b) => (
          <text key={b} x={x(b)} y={H - 6} textAnchor="middle" fontSize={9} fill="var(--color-ink-faint)">
            {bucketLabel(b, bucket, tag)}
          </text>
        ))}
      </svg>
    </div>
  );
}
