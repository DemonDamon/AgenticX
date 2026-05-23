"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LOCALE_COOKIE_NAME } from "./locale-constants";

export type UiLocale = "zh" | "en";

type LocaleContextValue = {
  locale: UiLocale;
  setLocale: (next: UiLocale) => void;
  isZh: boolean;
};

const STORAGE_KEY = "agenticx-ui-locale";
const LocaleContext = createContext<LocaleContextValue | null>(null);

function writeLocaleCookie(next: UiLocale) {
  if (typeof document === "undefined") return;
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${LOCALE_COOKIE_NAME}=${next};path=/;max-age=${maxAge};SameSite=Lax`;
}

export function LocaleProvider({
  children,
  initialLocale = "zh",
  onLocaleChange,
}: {
  children: ReactNode;
  initialLocale?: UiLocale;
  onLocaleChange?: (next: UiLocale) => void;
}) {
  const [locale, setLocaleState] = useState<UiLocale>(initialLocale);

  useEffect(() => {
    setLocaleState(initialLocale);
    document.documentElement.lang = initialLocale === "en" ? "en" : "zh-CN";
  }, [initialLocale]);

  const setLocale = useCallback(
    (next: UiLocale) => {
      setLocaleState(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Ignore storage quota errors for UI preference writes.
      }
      writeLocaleCookie(next);
      document.documentElement.lang = next === "en" ? "en" : "zh-CN";
      onLocaleChange?.(next);
    },
    [onLocaleChange]
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      isZh: locale === "zh",
    }),
    [locale, setLocale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return context;
}
