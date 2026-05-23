import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { defaultLocale, isAppLocale, LOCALE_COOKIE } from "./routing";

function resolveLocaleFromAcceptLanguage(header: string | null): "zh" | "en" {
  if (!header) return defaultLocale;
  const lower = header.toLowerCase();
  if (lower.includes("en")) return "en";
  return defaultLocale;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  let locale = isAppLocale(cookieLocale) ? cookieLocale : defaultLocale;

  if (!isAppLocale(cookieLocale)) {
    const acceptLanguage = (await headers()).get("accept-language");
    locale = resolveLocaleFromAcceptLanguage(acceptLanguage);
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
