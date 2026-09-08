import { describe, expect, it } from "vitest";
import { flattenMessageKeys } from "./flatten-messages";
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
import zhElectron from "../../locales/zh/electron.json";
import enElectron from "../../locales/en/electron.json";

const NAMESPACES: Array<{ name: string; zh: unknown; en: unknown }> = [
  { name: "common", zh: zhCommon, en: enCommon },
  { name: "settings", zh: zhSettings, en: enSettings },
  { name: "chat", zh: zhChat, en: enChat },
  { name: "sidebar", zh: zhSidebar, en: enSidebar },
  { name: "workspace", zh: zhWorkspace, en: enWorkspace },
  { name: "electron", zh: zhElectron, en: enElectron },
];

describe("i18n message key parity", () => {
  it("keeps zh and en keys aligned for every namespace", () => {
    const mismatches: string[] = [];
    for (const ns of NAMESPACES) {
      const zhKeys = flattenMessageKeys(ns.zh).sort();
      const enKeys = flattenMessageKeys(ns.en).sort();
      const zhSet = new Set(zhKeys);
      const enSet = new Set(enKeys);
      for (const key of zhKeys) {
        if (!enSet.has(key)) mismatches.push(`${ns.name}: missing en ${key}`);
      }
      for (const key of enKeys) {
        if (!zhSet.has(key)) mismatches.push(`${ns.name}: missing zh ${key}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("keeps English chrome strings free of Chinese characters", () => {
    const cjk = /[\u4e00-\u9fff]/;
    const leaks: string[] = [];
    for (const ns of NAMESPACES) {
      const walk = (node: unknown, prefix: string) => {
        if (typeof node === "string") {
          if (prefix === "display.languageZh") return;
          if (cjk.test(node)) leaks.push(`${ns.name}.${prefix}: ${node}`);
          return;
        }
        if (node && typeof node === "object") {
          for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            walk(value, prefix ? `${prefix}.${key}` : key);
          }
        }
      };
      walk(ns.en, "");
    }
    expect(leaks).toEqual([]);
  });
});
