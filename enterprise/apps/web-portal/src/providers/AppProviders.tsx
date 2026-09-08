"use client";

import { LocaleProvider, type UiLocale } from "@agenticx/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, type ReactNode } from "react";
import { LOCALE_COOKIE } from "../i18n/routing";

type AppProvidersProps = {
  children: ReactNode;
  initialLocale?: UiLocale;
};

function hasLocaleCookie(): boolean {
  if (typeof document === "undefined") return true;
  return document.cookie.split(";").some((part) => part.trim().startsWith(`${LOCALE_COOKIE}=`));
}

function persistLocaleCookie(locale: UiLocale) {
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=${maxAge};SameSite=Lax`;
}

export function AppProviders({ children, initialLocale = "zh" }: AppProvidersProps) {
  const router = useRouter();
  const onLocaleChange = useCallback(() => {
    router.refresh();
  }, [router]);

  // next-intl may resolve English from Accept-Language without writing NEXT_LOCALE.
  // Persist that SSR locale so later API routes see the same cookie as chrome.
  useEffect(() => {
    if (!hasLocaleCookie()) {
      persistLocaleCookie(initialLocale);
    }
  }, [initialLocale]);

  return (
    <LocaleProvider initialLocale={initialLocale} onLocaleChange={onLocaleChange}>
      {children}
    </LocaleProvider>
  );
}
