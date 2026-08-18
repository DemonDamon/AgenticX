import { describe, expect, it } from "vitest";
import {
  DELIVERY_DEVELOPER_SETTINGS_TAB_ID,
  DELIVERY_VISIBLE_SETTINGS_TAB_IDS,
  resolveDeliverySettingsTab,
} from "./settings-tab";

describe("delivery settings navigation", () => {
  it("keeps one ordered level of ordinary user tasks", () => {
    expect(DELIVERY_VISIBLE_SETTINGS_TAB_IDS).toEqual([
      "account",
      "general",
      "permissions",
      "skills",
      "mcp",
      "connectors",
      "favorites",
    ]);
  });

  it("routes provider management to the enterprise account", () => {
    expect(resolveDeliverySettingsTab("provider")).toBe("account");
  });

  it("keeps advanced controls behind one separate developer page", () => {
    expect(DELIVERY_DEVELOPER_SETTINGS_TAB_ID).toBe("developer");
    expect(DELIVERY_VISIBLE_SETTINGS_TAB_IDS).not.toContain("developer");
    expect(resolveDeliverySettingsTab("developer")).toBe("developer");
  });

  it.each([
    "tools",
    "knowledge",
    "data_sources",
    "memory",
    "hooks",
    "automation",
    "voice",
    "email",
    "workspace",
    "server",
    "unknown",
  ])("routes hidden section %s to general preferences", (tab) => {
    expect(resolveDeliverySettingsTab(tab)).toBe("general");
  });
});
