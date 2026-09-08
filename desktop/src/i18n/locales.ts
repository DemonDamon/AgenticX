export const APP_LOCALES = ["zh", "en"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "zh";
export const LOCALE_STORAGE_KEY = "agx-locale";

export function isAppLocale(value: unknown): value is AppLocale {
  return value === "zh" || value === "en";
}

export function htmlLangFor(locale: AppLocale): string {
  return locale === "en" ? "en" : "zh-CN";
}
