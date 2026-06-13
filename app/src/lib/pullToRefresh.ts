/**
 * Pure gesture logic for pull-to-refresh, kept DOM-free so it can be unit
 * tested under the `node` vitest environment. `usePullToRefresh` is a thin
 * touch-event binding over these.
 */

/** Past this pulled distance (px), releasing triggers a refresh. */
export const THRESHOLD = 64;
/** Raw finger travel is damped by this factor for a rubber-band feel. */
export const RESISTANCE = 0.5;
/** The indicator never travels further than this (px). */
export const MAX_PULL = 96;

export type PullStatus = "idle" | "pulling" | "armed" | "refreshing";

export type PullEvent =
  | { type: "move"; distance: number }
  | { type: "release" }
  | { type: "settle" };

/** Damped, capped travel for a downward finger delta. Non-downward → 0. */
export function pullDistance(rawDy: number): number {
  if (rawDy <= 0) return 0;
  return Math.min(rawDy * RESISTANCE, MAX_PULL);
}

/**
 * Reduce a gesture event against the current status. Returns the next status
 * and whether a refresh should fire now (`true` only on an armed release).
 */
export function nextPullState(
  status: PullStatus,
  event: PullEvent,
): { status: PullStatus; refresh: boolean } {
  if (status === "refreshing") {
    return { status: event.type === "settle" ? "idle" : "refreshing", refresh: false };
  }
  switch (event.type) {
    case "move":
      if (event.distance <= 0) return { status: "idle", refresh: false };
      return {
        status: event.distance >= THRESHOLD ? "armed" : "pulling",
        refresh: false,
      };
    case "release":
      return status === "armed"
        ? { status: "refreshing", refresh: true }
        : { status: "idle", refresh: false };
    case "settle":
      return { status: "idle", refresh: false };
  }
}
