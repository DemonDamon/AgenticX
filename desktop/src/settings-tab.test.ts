import { describe, expect, it } from "vitest";
import {
  isSettingsFocus,
  isSettingsTab,
  SECURITY_RULES_FOCUS,
} from "./settings-tab";

describe("settings deep-link", () => {
  it("accepts the security rules focus used by 自定义", () => {
    expect(isSettingsFocus(SECURITY_RULES_FOCUS)).toBe(true);
    expect(isSettingsTab("security")).toBe(true);
    expect(isSettingsFocus("security")).toBe(false);
    expect(isSettingsFocus("")).toBe(false);
  });
});
