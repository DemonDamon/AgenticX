import { describe, expect, it } from "vitest";
import { stripThinkBlocks } from "./content-clean";

describe("stripThinkBlocks", () => {
  it("removes closed think blocks and keeps report body", () => {
    const open = "<" + "think" + ">";
    const close = "<" + "/" + "think" + ">";
    const raw = `${open}internal plan${close}\n\n# 报告\n\n正文`;
    expect(stripThinkBlocks(raw)).toBe("# 报告\n\n正文");
  });

  it("removes an orphan closing tag without dropping the following markdown", () => {
    const close = "<" + "/" + "think" + ">";
    const raw = `${close}\n\n\`\`\`mermaid\ngraph TD\n\`\`\``;
    expect(stripThinkBlocks(raw)).toBe("```mermaid\ngraph TD\n```");
  });

  it("drops trailing content from an unclosed reasoning block", () => {
    const open = "<" + "think" + ">";
    expect(stripThinkBlocks(`# 正文\n\n${open}internal plan`)).toBe("# 正文");
  });
});
