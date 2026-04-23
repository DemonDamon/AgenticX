"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

export type UiLocale = "zh" | "en";

type LocaleContextValue = {
  locale: UiLocale;
  setLocale: (next: UiLocale) => void;
  isZh: boolean;
};

const STORAGE_KEY = "agenticx-ui-locale";
const LocaleContext = createContext<LocaleContextValue | null>(null);

function readLocale(): UiLocale {
  if (typeof window === "undefined") return "zh";
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === "en" ? "en" : "zh";
}

export function LocaleProvider({ children, initialLocale = "zh" }: { children: ReactNode; initialLocale?: UiLocale }) {
  const [locale, setLocaleState] = useState<UiLocale>(initialLocale);

  useLayoutEffect(() => {
    const next = readLocale();
    setLocaleState(next);
    document.documentElement.lang = next === "en" ? "en" : "zh-CN";
  }, []);

  const setLocale = useCallback((next: UiLocale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage quota errors for UI preference writes.
    }
    document.documentElement.lang = next === "en" ? "en" : "zh-CN";
  }, []);

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

