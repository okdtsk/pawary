import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "../lib/cn";

const inputBase =
  "w-full rounded-2xl border border-cream-300 bg-paper px-4 py-2.5 text-ink " +
  "placeholder:text-ink-faint focus:border-clay-400 focus:outline-none " +
  "focus:ring-2 focus:ring-clay-200 disabled:opacity-50";

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | null;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink-soft">
        {label}
      </span>
      {children}
      {hint && !error && (
        <span className="mt-1 block text-xs text-ink-faint">{hint}</span>
      )}
      {error && (
        <span role="alert" className="mt-1 block text-xs font-semibold text-berry-600">
          {error}
        </span>
      )}
    </label>
  );
}

export function TextInput({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputBase, className)} {...rest} />;
}

export function NumberInput({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step="any"
      className={cn(inputBase, className)}
      {...rest}
    />
  );
}

export function Select({
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(inputBase, "appearance-none", className)} {...rest} />;
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} className={cn(inputBase, className)} {...rest} />;
}

export function DateInput({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="date" className={cn(inputBase, className)} {...rest} />;
}
