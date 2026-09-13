import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhCommon from "../../locales/zh/common.json";
import enCommon from "../../locales/en/common.json";
import zhSettings from "../../locales/zh/settings.json";
import enSettings from "../../locales/en/settings.json";
import zhChat from "../../locales/zh/chat.json";
import enChat from "../../locales/en/chat.json";
import zhSidebar from "../../locales/zh/sidebar.json";
import enSidebar from "../../locales/en/sidebar.json";
import zhWorkspace from "../../locales/zh/workspace.json";
import enWorkspace from "../../locales/en/workspace.json";
import { LOCALE_STORAGE_KEY } from "./locales";
import { resolveAppLocale } from "./resolve-locale";

function readStoredLocale(): string | null {
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

const initial = resolveAppLocale({
  saved: typeof window !== "undefined" ? readStoredLocale() : null,
  osTag: typeof navigator !== "undefined" ? navigator.language : undefined,
});

void i18n.use(initReactI18next).init({
  lng: initial,
  fallbackLng: "zh",
  defaultNS: "common",
  ns: ["common", "settings", "chat", "sidebar", "workspace"],
  resources: {
    zh: {
      common: zhCommon,
      settings: zhSettings,
      chat: zhChat,
      sidebar: zhSidebar,
      workspace: zhWorkspace,
    },
    en: {
      common: enCommon,
      settings: enSettings,
      chat: enChat,
      sidebar: enSidebar,
      workspace: enWorkspace,
    },
  },
  interpolation: { escapeValue: false },
  returnNull: false,
});

export { i18n };
