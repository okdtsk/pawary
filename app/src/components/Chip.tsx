import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

/**
 * Selectable pill. When `tone` (a `categoryTone` entry) is given, the selected
 * state uses the category accent; otherwise clay.
 */
export function Chip({
  selected = false,
  tone,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  tone?: { text: string; soft: string; border: string };
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition active:scale-95",
        selected
          ? tone
            ? cn(tone.soft, tone.text, tone.border)
            : "border-clay-500 bg-clay-100 text-clay-800"
          : "border-cream-300 bg-paper text-ink-soft hover:bg-cream-50",
        className,
      )}
      {...rest}
    />
  );
}
