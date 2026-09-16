export const locales = ["zh", "en"] as const;

export type AppLocale = (typeof locales)[number];

export const defaultLocale: AppLocale = "zh";

export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isAppLocale(value: string | undefined | null): value is AppLocale {
  return value === "zh" || value === "en";
}

/** Same Accept-Language fallback as next-intl `request.ts` (do not invent a second heuristic). */
export function localeFromAcceptLanguage(header: string | null | undefined): AppLocale {
  if (!header) return defaultLocale;
  const lower = header.toLowerCase();
  if (lower.includes("en")) return "en";
  return defaultLocale;
}

/** Cookie wins; missing/invalid cookie falls back to Accept-Language, then `zh`. */
export function resolveAppLocale(
  cookie: string | null | undefined,
  acceptLanguage?: string | null,
): AppLocale {
  if (isAppLocale(cookie)) return cookie;
  return localeFromAcceptLanguage(acceptLanguage);
}
