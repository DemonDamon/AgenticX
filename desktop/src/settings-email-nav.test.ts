import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import enSettings from "../locales/en/settings.json";
import zhSettings from "../locales/zh/settings.json";

describe("settings email nav", () => {
  it("shows the email tab in the left nav and renders its panel", () => {
    const source = readFileSync(new URL("./components/SettingsPanel.tsx", import.meta.url), "utf8");
    expect(source).toContain('{ id: "email", icon: Mail }');
    expect(source).toContain('tab === "email" && <EmailSettingsTab />');
    expect(zhSettings.tabs.email).toBe("邮件");
    expect(enSettings.tabs.email).toBe("Email");
  });
});
