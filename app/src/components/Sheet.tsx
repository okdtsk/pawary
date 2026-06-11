import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { cn } from "../lib/cn";
import { IconButton } from "./IconButton";
import { XIcon } from "./icons";

const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet on mobile (drag the handle down ≥120px to dismiss),
 * centered modal on md+. Traps focus, closes on Escape/backdrop,
 * locks body scroll, restores focus on close.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const dragStart = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    setDragY(0);
    return () => {
      document.body.style.overflow = "";
      restoreRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
      <div
        aria-hidden="true"
        className="animate-fade absolute inset-0 bg-ink/40"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={
          dragY > 0
            ? { transform: `translateY(${dragY}px)`, animation: "none" }
            : undefined
        }
        className={cn(
          "animate-sheet rounded-t-bubble shadow-float relative flex max-h-[92dvh] w-full flex-col bg-paper outline-none",
          "md:rounded-bubble md:max-h-[85dvh]",
          wide ? "md:max-w-2xl" : "md:max-w-md",
        )}
      >
        {/* drag handle (touch-dismiss, mobile only) */}
        <div
          className="flex justify-center pb-1 pt-2 md:hidden"
          style={{ touchAction: "none" }}
          onPointerDown={(e) => {
            dragStart.current = e.clientY;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (dragStart.current === null) return;
            setDragY(Math.max(0, e.clientY - dragStart.current));
          }}
          onPointerUp={() => {
            const shouldClose = dragY > 120;
            dragStart.current = null;
            setDragY(0);
            if (shouldClose) onClose();
          }}
          onPointerCancel={() => {
            dragStart.current = null;
            setDragY(0);
          }}
        >
          <div className="h-1.5 w-10 rounded-full bg-cream-300" />
        </div>
        <header className="flex items-center justify-between px-5 pb-2 pt-1 md:pt-4">
          <h2 className="font-display text-xl text-ink">{title}</h2>
          <IconButton label={t.common.close} onClick={onClose}>
            <XIcon className="h-5 w-5" />
          </IconButton>
        </header>
        <div className="overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
