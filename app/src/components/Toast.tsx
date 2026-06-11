import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../lib/cn";

type ToastTone = "default" | "danger";
type ToastAction = { label: string; onClick: () => void };
type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
};
type ShowToast = (
  message: string,
  opts?: { tone?: ToastTone; action?: ToastAction },
) => void;

const ToastContext = createContext<{ show: ShowToast } | null>(null);

export function useToast(): { show: ShowToast } {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<Map<number, number>>(new Map());

  // Clear all pending timers on unmount.
  useEffect(() => {
    return () => {
      for (const handle of timersRef.current.values()) {
        window.clearTimeout(handle);
      }
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    const handle = timersRef.current.get(id);
    if (handle !== undefined) window.clearTimeout(handle);
    timersRef.current.delete(id);
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const show = useCallback<ShowToast>(
    (message, opts) => {
      const id = ++idRef.current;
      setToasts((prev) => [
        ...prev.slice(-2),
        { id, message, tone: opts?.tone ?? "default", action: opts?.action },
      ]);
      const handle = window.setTimeout(
        () => dismiss(id),
        opts?.action ? 6000 : 4000,
      );
      timersRef.current.set(id, handle);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            role="status"
            className={cn(
              "animate-pop shadow-float pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-full py-2.5 pl-5 pr-2.5 text-sm font-semibold",
              item.tone === "danger"
                ? "bg-berry-700 text-white"
                : "bg-ink text-cream-50",
            )}
          >
            <span className="flex-1">{item.message}</span>
            {item.action && (
              <button
                type="button"
                className="rounded-full bg-white/15 px-3.5 py-1.5 font-display transition hover:bg-white/25 active:scale-95"
                onClick={() => {
                  item.action!.onClick();
                  dismiss(item.id);
                }}
              >
                {item.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
