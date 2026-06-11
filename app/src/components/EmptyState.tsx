import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { PawIcon } from "./icons";

function DefaultArt() {
  return (
    <div className="relative h-28 w-32" aria-hidden="true">
      <div className="blob absolute left-2 top-3 h-24 w-24 bg-cream-200" />
      <div className="blob absolute right-0 top-0 h-12 w-12 bg-clay-100" />
      <PawIcon className="absolute left-9 top-10 h-11 w-11 rotate-[-12deg] text-clay-300" />
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  art,
  className,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  art?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 px-6 py-10 text-center",
        className,
      )}
    >
      {art ?? <DefaultArt />}
      <p className="font-display text-lg text-ink">{title}</p>
      {hint && <p className="max-w-xs text-sm text-ink-faint">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
