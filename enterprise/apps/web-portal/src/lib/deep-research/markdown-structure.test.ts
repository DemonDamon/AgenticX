import { describe, expect, it } from "vitest";
import {
  isMarkdownFenceLine,
  isMarkdownHeadingLine,
  isMarkdownTableDividerLine,
  splitMarkdownSentences,
} from "./markdown-structure";

describe("markdown structure", () => {
  it("recognizes block structure without classifying ordinary prose", () => {
    expect(isMarkdownFenceLine("```ts")).toBe(true);
    expect(isMarkdownFenceLine("  ~~~")).toBe(true);
    expect(isMarkdownHeadingLine("## 结论")).toBe(true);
    expect(isMarkdownTableDividerLine("| --- | :---: |")).toBe(true);
    expect(isMarkdownHeadingLine("正文 # 标签")).toBe(false);
    expect(isMarkdownTableDividerLine("正常正文---继续")).toBe(false);
  });

  it("splits CJK and unambiguous Latin sentence boundaries", () => {
    expect(splitMarkdownSentences("第一句。第二句！第三句")).toEqual([
      "第一句。",
      "第二句！",
      "第三句",
    ]);
    expect(splitMarkdownSentences("First claim. Second claim. [1] Evidence")).toEqual([
      "First claim.",
      "Second claim.",
      "[1] Evidence",
    ]);
  });
});
