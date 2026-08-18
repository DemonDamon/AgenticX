import { describe, expect, it } from "vitest";
import {
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
