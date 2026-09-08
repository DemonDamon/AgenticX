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

export function localeFromOsTag(tag: string | null | undefined): AppLocale {
  const lower = String(tag ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (lower.startsWith("en")) return "en";
  return "zh";
}

/** 已保存 > OS。saved 非法则当缺失。 */
export function resolveAppLocale(input: {
  saved?: unknown;
  osTag?: string | null;
}): AppLocale {
  if (isAppLocale(input.saved)) return input.saved;
  return localeFromOsTag(input.osTag);
}
