import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "@pawlog/shared";
import { en } from "./en";
import { ja } from "./ja";
import type { Messages } from "./messages";

const catalogs: Record<"en" | "ja", Messages> = { en, ja };

function resolveLocale(setting: Locale | undefined): "en" | "ja" {
  if (setting === "en" || setting === "ja") return setting;
  return navigator.language.toLowerCase().startsWith("ja") ? "ja" : "en";
}

const I18nContext = createContext<Messages>(en);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale | undefined;
  children: ReactNode;
}) {
  return (
    <I18nContext.Provider value={catalogs[resolveLocale(locale)]}>
      {children}
    </I18nContext.Provider>
  );
}

export function useT(): Messages {
  return useContext(I18nContext);
}
