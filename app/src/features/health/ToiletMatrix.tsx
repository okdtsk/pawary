import type { ToiletCell, ToiletMatrixRow, ToiletSeverity } from "@pawlog/shared";
import { TOILET_SEVERITY } from "@pawlog/shared";
import { EmptyState } from "../../components/EmptyState";
import { useLocaleTag, useT } from "../../i18n";
import { bucketLabel } from "./bucketLabel";

const W = 360;
const ROW_H = 16;
const HEADER_H = 18;
const LABEL_W = 70;
const CELL_GAP = 6;
const CELL_W = (W - LABEL_W - CELL_GAP * 3) / 2; // 136

export const conditionFill: Record<ToiletSeverity, string> = {
  normal: "var(--color-moss-600)",
  soft: "var(--color-cat-vaccine)",
  hard: "var(--color-cat-toilet)",
  diarrhea: "var(--color-clay-500)",
  bloody: "var(--color-berry-600)",
};

function Cell({
  x,
  y,
  cell,
  label,
  conditionName,
}: {
  x: number;
  y: number;
  cell: ToiletCell | null;
  label: string;
  conditionName: (c: ToiletSeverity) => string;
}) {
  if (!cell) {
    return (
      <rect x={x} y={y + 2} width={CELL_W} height={ROW_H - 5} rx={4} fill="none" stroke="var(--color-cream-200)" strokeWidth={1} />
    );
  }
  return (
    <g>
      <title>{`${label}: ${cell.count}× · ${conditionName(cell.worst)}`}</title>
      <rect
        x={x}
        y={y + 2}
        width={CELL_W}
        height={ROW_H - 5}
        rx={4}
        fill={conditionFill[cell.worst]}
        opacity={cell.worst === "normal" ? 0.55 : 0.9}
      />
      {cell.count > 1 && (
        <text x={x + CELL_W / 2} y={y + ROW_H - 5} textAnchor="middle" fontSize={9} fontWeight={700} fill="var(--color-paper)">
          {cell.count}
        </text>
      )}
    </g>
  );
}

export function ToiletMatrix({
  rows,
  buckets,
  bucket,
}: {
  rows: ToiletMatrixRow[];
  buckets: string[];
  bucket: "day" | "week";
}) {
  const t = useT();
  const tag = useLocaleTag();
  if (rows.length === 0) return <EmptyState title={t.health.toiletEmpty} className="py-6" />;

  const byBucket = new Map(rows.map((r) => [r.bucket, r]));
  const ordered = [...buckets].reverse(); // newest first
  const H = HEADER_H + ordered.length * ROW_H + 4;
  const peeX = LABEL_W + CELL_GAP;
  const poopX = LABEL_W + CELL_GAP * 2 + CELL_W;
  const conditionName = (c: ToiletSeverity) => t.options.condition[c];

  return (
    <div>
      <div className="max-h-80 overflow-y-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t.health.toiletTitle}>
          <text x={peeX + CELL_W / 2} y={11} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--color-ink-soft)">
            {t.options.toiletKind.pee}
          </text>
          <text x={poopX + CELL_W / 2} y={11} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--color-ink-soft)">
            {t.options.toiletKind.poop}
          </text>
          {ordered.map((b, i) => {
            const y0 = HEADER_H + i * ROW_H;
            const row = byBucket.get(b);
            const label = bucketLabel(b, bucket, tag);
            return (
              <g key={b}>
                <text x={LABEL_W - 4} y={y0 + ROW_H - 5} textAnchor="end" fontSize={9} fill="var(--color-ink-faint)">
                  {label}
                </text>
                <Cell x={peeX} y={y0} cell={row?.pee ?? null} label={`${label} · ${t.options.toiletKind.pee}`} conditionName={conditionName} />
                <Cell x={poopX} y={y0} cell={row?.poop ?? null} label={`${label} · ${t.options.toiletKind.poop}`} conditionName={conditionName} />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-faint">
        {TOILET_SEVERITY.map((cond) => (
          <span key={cond} className="flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: conditionFill[cond] }} />
            {t.options.condition[cond]}
          </span>
        ))}
      </div>
    </div>
  );
}
