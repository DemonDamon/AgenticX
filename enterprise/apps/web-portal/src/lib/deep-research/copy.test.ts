import { describe, expect, it } from "vitest";
import { deepResearchCopy, languageDirective } from "./copy";

describe("languageDirective", () => {
  it("locks the English instruction", () => {
    expect(languageDirective("en")).toContain("Write ALL user-facing");
  });

  it("locks the Chinese instruction", () => {
    expect(languageDirective("zh")).toContain("所有面向用户的文本使用简体中文");
  });
});

describe("deepResearchCopy", () => {
  it("keeps zh recon narrative identical to the historical canned string", () => {
    expect(deepResearchCopy("zh").reconNarrative).toBe(
      "我先快速检索最新公开资料，校准调研前提。",
    );
  });

  it("locks the English recon narrative", () => {
    expect(deepResearchCopy("en").reconNarrative).toBe(
      "I'll quickly search the latest public sources to calibrate the research premise.",
    );
  });
});
