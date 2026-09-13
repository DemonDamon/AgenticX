import { cookies, headers } from "next/headers";
import {
  LOCALE_COOKIE,
  defaultLocale,
  isAppLocale,
  resolveAppLocale,
  type AppLocale,
} from "../i18n/routing";

export function localeFromCookieValue(raw: string | undefined | null): AppLocale {
  return isAppLocale(raw) ? raw : defaultLocale;
}

/**
 * Must match next-intl `request.ts`: cookie `NEXT_LOCALE` first, then Accept-Language.
 * Cookie-only resolution made English chrome (browser language) emit Chinese canned SSE.
 */
export async function resolvePortalLocaleFromCookies(): Promise<AppLocale> {
  const store = await cookies();
  const acceptLanguage = (await headers()).get("accept-language");
  return resolveAppLocale(store.get(LOCALE_COOKIE)?.value, acceptLanguage);
}
