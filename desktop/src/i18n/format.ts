import type { AppLocale } from "./locales";

export function dateLocale(locale: AppLocale): string {
  return locale === "en" ? "en-US" : "zh-CN";
}

export function formatClock(ts: number | string | Date, locale: AppLocale): string {
  return new Date(ts).toLocaleTimeString(dateLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTime(
  ts: number | string | Date,
  locale: AppLocale,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Date(ts).toLocaleString(dateLocale(locale), options);
}
