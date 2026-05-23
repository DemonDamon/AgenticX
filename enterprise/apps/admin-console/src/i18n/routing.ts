export const locales = ["zh", "en"] as const;

export type AppLocale = (typeof locales)[number];

export const defaultLocale: AppLocale = "zh";

export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isAppLocale(value: string | undefined | null): value is AppLocale {
  return value === "zh" || value === "en";
}
