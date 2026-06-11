/** Two chips within this many minutes are considered overlapping. */
export const LANE_GAP_MIN = 45;

export type Placed<T> = T & { lane: number; laneCount: number };

/**
 * Greedy lane assignment for point events in one day column:
 * each item takes the first lane whose previous item is ≥ LANE_GAP_MIN
 * minutes earlier; otherwise a new lane opens. `laneCount` is the column's
 * total lane count (all chips share the width evenly).
 */
export function placeItems<T extends { minute: number }>(
  items: T[],
): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.minute - b.minute);
  const laneLastMinute: number[] = [];
  const placed = sorted.map((item) => {
    let lane = laneLastMinute.findIndex(
      (last) => item.minute - last >= LANE_GAP_MIN,
    );
    if (lane === -1) {
      lane = laneLastMinute.length;
      laneLastMinute.push(item.minute);
    } else {
      laneLastMinute[lane] = item.minute;
    }
    return { ...item, lane, laneCount: 1 };
  });
  const laneCount = Math.max(1, laneLastMinute.length);
  return placed.map((p) => ({ ...p, laneCount }));
}
