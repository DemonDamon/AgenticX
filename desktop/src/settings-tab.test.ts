import { describe, expect, it } from "vitest";
import {
  canConfigureSelfManagedServices,
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

  it("keeps provider management hidden by default", () => {
    expect(resolveDeliverySettingsTab("provider")).toBe("account");
  });

  it("lets signed-out self-managed users reach the existing provider page", () => {
    const access = { enterpriseLoggedIn: false, enterpriseStrict: false };
    expect(canConfigureSelfManagedServices(access)).toBe(true);
    expect(resolveDeliverySettingsTab("provider", access)).toBe("provider");
  });

  it.each([
    { enterpriseLoggedIn: true, enterpriseStrict: false },
    { enterpriseLoggedIn: false, enterpriseStrict: true },
    { enterpriseLoggedIn: true, enterpriseStrict: true },
  ])("redirects managed provider deep links to the account page: %o", (access) => {
    expect(canConfigureSelfManagedServices(access)).toBe(false);
    expect(resolveDeliverySettingsTab("provider", access)).toBe("account");
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
