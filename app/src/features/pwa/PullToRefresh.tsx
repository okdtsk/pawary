import { type ReactNode } from "react";
import { PawIcon } from "../../components/icons";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { THRESHOLD } from "../../lib/pullToRefresh";
import { usePullToRefresh } from "../../lib/usePullToRefresh";

/**
 * Wraps the routed content with a touch pull-to-refresh gesture. Renders a paw
 * indicator that follows the pull and spins while refreshing. Touch only;
 * desktop renders just the children plus an inert indicator.
 */
export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<unknown>;
  children: ReactNode;
}) {
  const t = useT();
  const { distance, status } = usePullToRefresh(onRefresh);

  const refreshing = status === "refreshing";
  // While refreshing the finger is gone, so pin the indicator at the threshold.
  const offset = refreshing ? THRESHOLD : distance;
  const visible = refreshing || distance > 0;
  const progress = Math.min(distance / THRESHOLD, 1);

  const label =
    status === "armed"
      ? t.pwa.releaseToRefresh
      : refreshing
        ? t.pwa.refreshing
        : t.pwa.pullToRefresh;

  return (
    <>
      <div
        aria-hidden={!visible}
        className="pointer-events-none fixed inset-x-0 top-0 z-20 flex justify-center"
        style={{
          transform: `translateY(${offset}px)`,
          opacity: visible ? 1 : 0,
          transition: status === "idle" ? "transform 0.25s var(--ease-springy), opacity 0.2s" : undefined,
        }}
      >
        <div className="mt-2 rounded-full bg-paper/95 p-2 shadow-float backdrop-blur">
          <PawIcon
            className={cn("h-6 w-6 text-clay-500", refreshing && "animate-paw")}
            style={
              refreshing
                ? undefined
                : { transform: `scale(${0.6 + progress * 0.4}) rotate(${progress * 180}deg)`, opacity: 0.4 + progress * 0.6 }
            }
          />
        </div>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {visible ? label : ""}
      </span>
      {children}
    </>
  );
}
