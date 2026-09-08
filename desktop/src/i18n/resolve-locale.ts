import { isAppLocale, type AppLocale } from "./locales";

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
