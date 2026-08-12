import { describe, expect, it } from "vitest";
import {
  markdownToPlainText,
  parseAssistantContent,
  recoverIncompleteCodeFences,
  stripModelCitationTags,
  stripPlaceholderCitationMarkers,
  toCopyableMessageText,
} from "./assistant-content";

describe("recoverIncompleteCodeFences", () => {
  it("fills code body from reasoning when visible output stops at opening fence", () => {
    const display = "示例：\n\n```cpp\n";
    const reasoning = "计划…\n\n```cpp\n#include <iostream>\n\nint main() {}\n```\n";
    expect(recoverIncompleteCodeFences(display, reasoning)).toBe(
      "示例：\n\n```cpp\n#include <iostream>\n\nint main() {}\n```"
    );
  });
});

describe("stripPlaceholderCitationMarkers", () => {
  it("removes [N] placeholder and attachment boilerplate prefix", () => {
    const raw =
      "[N] 技术方案原文\n- 文档内容基于提供的附件：方案.md\n\n## 摘要";
    expect(stripPlaceholderCitationMarkers(raw)).toBe("技术方案原文\n方案.md\n\n## 摘要");
  });
});

describe("stripModelCitationTags", () => {
  it("removes citation xml wrappers from assistant text", () => {
    const raw =
      "[N] 技术方案原文\n<citations> - 文档内容基于提供的附件：方案.md </citations>\n\n## 摘要\n正文";
    expect(stripModelCitationTags(raw)).toBe(
      "[N] 技术方案原文\n - 文档内容基于提供的附件：方案.md \n\n## 摘要\n正文",
    );
  });
});

describe("parseAssistantContent", () => {
  it("maps vendor think tags and recovers truncated code blocks", () => {
    const thinkOpen = "<" + "think" + ">";
    const thinkClose = "<" + "/" + "think" + ">";
    const parsed = parseAssistantContent({
      id: "m1",
      session_id: "s1",
      tenant_id: "t1",
      user_id: "u1",
      role: "assistant",
      content: `${thinkOpen}plan with \`\`\`cpp\n#include <iostream>\n\`\`\`${thinkClose}\n\n## Demo\n\n\`\`\`cpp\n`,
      created_at: "2026-05-21T00:00:00.000Z",
    });

    expect(parsed.displayContent).toContain("#include <iostream>");
    expect(parsed.displayContent).toContain("```");
    expect(parsed.reasoningContent).toContain("plan");
  });

  it("strips citation tags from visible assistant content", () => {
    const parsed = parseAssistantContent({
      id: "m2",
      session_id: "s1",
      tenant_id: "t1",
      user_id: "u1",
      role: "assistant",
      content: "摘要\n<citations>附件说明</citations>",
      created_at: "2026-05-21T00:00:00.000Z",
    });
    expect(parsed.displayContent).toBe("摘要\n附件说明");
    expect(parsed.displayContent).not.toContain("<citations>");
  });

  it("keeps repeated provider close tags and their fragments inside reasoning", () => {
    const parsed = parseAssistantContent({
      id: "m3",
      session_id: "s1",
      tenant_id: "t1",
      user_id: "u1",
      role: "assistant",
      content:
        "<think>判断检索意图</think>" +
        "准备搜索近期新闻。</think>" +
        "等待搜索结果。</think>" +
        "这是最终回答。",
      created_at: "2026-08-12T00:00:00.000Z",
    });

    expect(parsed.displayContent).toBe("这是最终回答。");
    expect(parsed.displayContent).not.toContain("</think>");
    expect(parsed.reasoningContent).toContain("判断检索意图");
    expect(parsed.reasoningContent).toContain("准备搜索近期新闻");
    expect(parsed.reasoningContent).toContain("等待搜索结果");
    expect(parsed.thinkingInProgress).toBe(false);
  });

  it("collects multiple balanced reasoning blocks without hiding visible text", () => {
    const parsed = parseAssistantContent({
      id: "m4",
      session_id: "s1",
      tenant_id: "t1",
      user_id: "u1",
      role: "assistant",
      content: "<think>第一步</think>正文一。<think>第二步</think>正文二。",
      created_at: "2026-08-12T00:00:00.000Z",
    });

    expect(parsed.displayContent).toBe("正文一。正文二。");
    expect(parsed.reasoningContent).toContain("第一步");
    expect(parsed.reasoningContent).toContain("第二步");
  });
});

describe("copyable assistant content", () => {
  it("removes Markdown syntax while keeping readable structure", () => {
    const markdown = [
      "# 标题",
      "",
      "> **重点** [1][2]",
      "",
      "- [链接](https://example.com)",
      "- `代码`",
      "",
      "| 项目 | 内容 |",
      "| --- | --- |",
      "| 一 | 二 |",
    ].join("\n");

    expect(markdownToPlainText(markdown)).toBe("标题\n\n重点\n\n• 链接\n• 代码\n\n项目\t内容\n一\t二");
  });

  it("does not copy assistant reasoning or raw citation markers", () => {
    const message = {
      id: "copy-1",
      session_id: "s1",
      tenant_id: "t1",
      user_id: "u1",
      role: "assistant" as const,
      content: "<think>不要复制的思考</think>\n## 正文 [12]\n**完成**",
      created_at: "2026-05-21T00:00:00.000Z",
    };

    expect(toCopyableMessageText(message)).toBe("正文\n完成");
  });
});
