import { useCallback, useEffect, useRef, useState } from "react";
import { type PullStatus, nextPullState, pullDistance } from "./pullToRefresh";

/**
 * A scrollable region that owns vertical gestures (the calendar timeline,
 * marked `data-pull-ignore`). When the touch begins inside one that is scrolled
 * away from its top, pulling down should scroll that region — not pull-to-
 * refresh. At the region's own top (`scrollTop === 0`) the gesture falls
 * through so refresh still works.
 */
function ownsVerticalGesture(target: EventTarget | null): boolean {
  const region =
    target instanceof Element ? target.closest("[data-pull-ignore]") : null;
  return region instanceof HTMLElement && region.scrollTop > 0;
}

/**
 * Touch-only pull-to-refresh bound to the window scroll. A pull engages only
 * at the top of the page and never while a modal/`Sheet` is open (those lock
 * `body` overflow). Returns the live `distance` and `status` for an indicator.
 * All gesture math lives in the pure `./pullToRefresh` module.
 */
export function usePullToRefresh(onRefresh: () => Promise<unknown>): {
  distance: number;
  status: PullStatus;
} {
  const [status, setStatus] = useState<PullStatus>("idle");
  const [distance, setDistance] = useState(0);
  const startY = useRef<number | null>(null);
  const statusRef = useRef<PullStatus>("idle");
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const setBoth = useCallback((next: PullStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      // Begin only at the very top, never under an open modal/sheet, and never
      // when a scrolled timeline region should handle the vertical gesture.
      if (
        statusRef.current === "refreshing" ||
        window.scrollY > 0 ||
        document.body.style.overflow === "hidden" ||
        ownsVerticalGesture(e.target)
      ) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0]?.clientY ?? null;
    }

    function onTouchMove(e: TouchEvent) {
      if (startY.current === null) return;
      const y = e.touches[0]?.clientY;
      if (y === undefined) return;
      const dist = pullDistance(y - startY.current);
      // Committed downward pull at the top: suppress native overscroll bounce.
      if (dist > 0 && window.scrollY <= 0 && e.cancelable) e.preventDefault();
      setDistance(dist);
      const { status: next } = nextPullState(statusRef.current, {
        type: "move",
        distance: dist,
      });
      if (next !== statusRef.current) setBoth(next);
    }

    async function onTouchEnd() {
      if (startY.current === null) return;
      startY.current = null;
      const { status: next, refresh } = nextPullState(statusRef.current, {
        type: "release",
      });
      setBoth(next);
      if (!refresh) {
        setDistance(0);
        return;
      }
      try {
        await onRefreshRef.current();
      } finally {
        setBoth(nextPullState("refreshing", { type: "settle" }).status);
        setDistance(0);
      }
    }

    function onTouchCancel() {
      startY.current = null;
      if (statusRef.current !== "refreshing") {
        setBoth("idle");
        setDistance(0);
      }
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchCancel);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [setBoth]);

  return { distance, status };
}
