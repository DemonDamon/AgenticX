import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "../i18n/i18n";
import { formatBackendChipLabel } from "./backend-scope";

describe("formatBackendChipLabel", () => {
  afterEach(async () => {
    await i18n.changeLanguage("zh");
  });

  it("uses the current locale for local mode", async () => {
    expect(formatBackendChipLabel("local", "local")).toBe(i18n.t("composer.local", { ns: "chat" }));
    await i18n.changeLanguage("en");
    expect(formatBackendChipLabel("local", "local")).toBe("Local");
    expect(formatBackendChipLabel("local", "local")).not.toBe("本地");
  });
});
