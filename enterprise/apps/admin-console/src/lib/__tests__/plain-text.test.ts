import { describe, expect, it } from "vitest";

import { plainText } from "../plain-text";

describe("plainText", () => {
  it("unwraps inline code but keeps the command inside it", () => {
    // SkillHub 上 Github 那条说明就是这个样子的，原样显示就是一串反引号。
    expect(plainText("使用 `gh` CLI 与 GitHub 交互，通过 `gh issue`、`gh pr` 管理")).toBe(
      "使用 gh CLI 与 GitHub 交互，通过 gh issue、gh pr 管理",
    );
  });

  it("keeps link text and drops the url", () => {
    expect(plainText("见 [文档](https://example.com/docs)")).toBe("见 文档");
  });

  it("leaves underscores in identifiers alone", () => {
    // 下划线强调和标识符长得一样，宁可漏掉强调也不能把 web_search 拆成 websearch。
    expect(plainText("控制 web_search 与 deep_research")).toBe("控制 web_search 与 deep_research");
  });

  it("flattens headings, lists, and hard wraps into one line", () => {
    expect(plainText("## 用途\n\n- 建议\n- 复核\n")).toBe("用途 建议 复核");
  });

  it("returns an empty string for nothing", () => {
    expect(plainText(undefined)).toBe("");
    expect(plainText("")).toBe("");
  });
});
