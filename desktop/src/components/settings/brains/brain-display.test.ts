import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "../../../i18n/i18n";
import { displayBrainName } from "./brain-display";

describe("displayBrainName", () => {
  afterEach(async () => {
    await i18n.changeLanguage("zh");
  });

  it("localizes the stock default docs brain", async () => {
    expect(displayBrainName({ id: "default_docs", name: "默认文档库" })).toBe("默认文档库");
    await i18n.changeLanguage("en");
    expect(displayBrainName({ id: "default_docs", name: "默认文档库" })).toBe("Default document library");
  });

  it("keeps a renamed default brain", async () => {
    await i18n.changeLanguage("en");
    expect(displayBrainName({ id: "default_docs", name: "Team docs" })).toBe("Team docs");
  });
});
