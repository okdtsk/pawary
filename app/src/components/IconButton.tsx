import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

/** Icon-only button. `label` is REQUIRED and becomes the aria-label. */
export function IconButton({
  label,
  className,
  type,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type={type ?? "button"}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-soft",
        "transition hover:bg-cream-200 hover:text-ink active:scale-95",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...rest}
    />
  );
}
