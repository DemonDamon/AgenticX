import { describe, expect, it } from "vitest";
import { findComposerImplicitRetryUserIndex } from "./composer-implicit-retry";

describe("findComposerImplicitRetryUserIndex", () => {
  it("does not treat a later same-text composer send as retry of an interrupted turn", () => {
    const messages = [
      { role: "user", content: "请用 liteparse 解析桌面的任意一个表格" },
      { role: "tool", content: "list_files" },
      { role: "user", content: "刚才解析到哪了" },
      { role: "assistant", content: "上一轮解析被截断了，我重新完整解析一次。" },
    ];

    expect(findComposerImplicitRetryUserIndex(messages, "刚才解析到哪了")).toBe(-1);
  });

  it("does not treat same-text after a completed answer as retry", () => {
    const messages = [
      { role: "user", content: "刚才解析到哪了" },
      { role: "assistant", content: "解析完成。" },
    ];

    expect(findComposerImplicitRetryUserIndex(messages, "刚才解析到哪了")).toBe(-1);
  });
});
