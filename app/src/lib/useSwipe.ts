import { useRef, type TouchEvent } from "react";

/**
 * Horizontal swipe detection (touch). Returns handlers to spread onto a
 * container. Fires when |dx| > threshold and the gesture is clearly
 * horizontal (|dx| > 1.5·|dy|) — vertical scrolling stays untouched.
 */
export function useSwipe(opts: {
  onLeft: () => void;
  onRight: () => void;
  thresholdPx?: number;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) start.current = { x: touch.clientX, y: touch.clientY };
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      const touch = e.changedTouches[0];
      if (!s || !touch) return;
      const dx = touch.clientX - s.x;
      const dy = touch.clientY - s.y;
      const threshold = opts.thresholdPx ?? 48;
      if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) opts.onLeft();
        else opts.onRight();
      }
    },
  };
}
