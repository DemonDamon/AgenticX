import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isSettingsFocus,
  isSettingsTab,
  SECURITY_RULES_FOCUS,
  SETTINGS_TAB_IDS,
} from "./settings-tab";

describe("settings deep-link", () => {
  it("accepts the security rules focus used by 自定义", () => {
    expect(isSettingsFocus(SECURITY_RULES_FOCUS)).toBe(true);
    expect(isSettingsTab("security")).toBe(true);
    expect(isSettingsFocus("security")).toBe(false);
    expect(isSettingsFocus("")).toBe(false);
  });

  it("only lists tabs that the settings panel can open", () => {
    const source = readFileSync(new URL("./components/SettingsPanel.tsx", import.meta.url), "utf8");
    for (const id of SETTINGS_TAB_IDS) {
      expect(source).toContain(`{ id: "${id}",`);
    }
    expect(isSettingsTab("hooks")).toBe(false);
    expect(isSettingsTab("workspace")).toBe(false);
  });
});
