import { useEffect, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { useAppStore } from "../store";
import { i18n } from "./i18n";
import { htmlLangFor } from "./locales";

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useAppStore((s) => s.locale);

  useEffect(() => {
    if (i18n.language !== locale) {
      void i18n.changeLanguage(locale);
    }
    document.documentElement.lang = htmlLangFor(locale);
  }, [locale]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
