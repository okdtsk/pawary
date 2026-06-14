import type { Category } from "@pawary/shared";
import { categoryLabel } from "./labels";

type Locale = "en" | "ja";

function resolveLocale(locale: string | null | undefined): Locale {
  return locale === "ja" ? "ja" : "en";
}

/** Human-readable author list. JA always carries the さん honorific. */
export function formatAuthors(names: string[], locale: string): string {
  const first = names[0] ?? "";
  if (resolveLocale(locale) === "ja") {
    if (names.length <= 1) return `${first}さん`;
    if (names.length === 2) return `${first}さんと${names[1]}さん`;
    return `${first}さん他${names.length - 1}人`;
  }
  if (names.length <= 1) return first;
  if (names.length === 2) return `${first} & ${names[1]}`;
  return `${first} & ${names.length - 1} others`;
}

/**
 * Build the `{title, body, url}` push payload for one recipient.
 * `category` is set only for the single-item case; multi-item bodies use a count.
 */
export function buildNewLogPayload(opts: {
  petName: string;
  petId: string;
  authorNames: string[];
  itemCount: number;
  category: Category | null;
  locale: string;
}): string {
  const loc = resolveLocale(opts.locale);
  const who = formatAuthors(opts.authorNames, opts.locale);
  let body: string;
  if (opts.itemCount === 1 && opts.category) {
    const cat = categoryLabel(opts.category, opts.locale);
    body = loc === "ja" ? `${who}が${cat}を記録しました` : `${who} logged ${cat}`;
  } else {
    body =
      loc === "ja"
        ? `${who}が${opts.itemCount}件記録しました`
        : `${who} added ${opts.itemCount} logs`;
  }
  return JSON.stringify({ title: opts.petName, body, url: `/log?pet=${opts.petId}` });
}
