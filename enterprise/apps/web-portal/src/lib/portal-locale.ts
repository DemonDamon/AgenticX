import { cookies } from "next/headers";
import { LOCALE_COOKIE, defaultLocale, isAppLocale, type AppLocale } from "../i18n/routing";

export function localeFromCookieValue(raw: string | undefined | null): AppLocale {
  return isAppLocale(raw) ? raw : defaultLocale;
}

export async function resolvePortalLocaleFromCookies(): Promise<AppLocale> {
  const store = await cookies();
  return localeFromCookieValue(store.get(LOCALE_COOKIE)?.value);
}
