import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "@pawlog/shared";
import { en } from "./en";
import { ja } from "./ja";
import type { Messages } from "./messages";

export type LocaleTag = "en" | "ja";

const catalogs: Record<LocaleTag, Messages> = { en, ja };

function resolveLocale(setting: Locale | undefined): LocaleTag {
  if (setting === "en" || setting === "ja") return setting;
  return navigator.language.toLowerCase().startsWith("ja") ? "ja" : "en";
}

const I18nContext = createContext<{ messages: Messages; tag: LocaleTag }>({
  messages: en,
  tag: "en",
});

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale | undefined;
  children: ReactNode;
}) {
  const tag = resolveLocale(locale);
  const value = useMemo(() => ({ messages: catalogs[tag], tag }), [tag]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): Messages {
  return useContext(I18nContext).messages;
}

/** Locale tag for Intl date/number formatting. */
export function useLocaleTag(): LocaleTag {
  return useContext(I18nContext).tag;
}
