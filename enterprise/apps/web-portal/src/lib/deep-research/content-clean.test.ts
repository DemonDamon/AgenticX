import { describe, expect, it } from "vitest";
import { stripThinkBlocks } from "./content-clean";

describe("stripThinkBlocks", () => {
  it("removes closed think blocks and keeps report body", () => {
    const open = "<" + "think" + ">";
    const close = "<" + "/" + "think" + ">";
    const raw = `${open}internal plan${close}\n\n# 报告\n\n正文`;
    expect(stripThinkBlocks(raw)).toBe("# 报告\n\n正文");
  });
});
