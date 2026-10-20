import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@agenticx/core-api";
import {
  parseAssistantContent,
  prepareAssistantContinuation,
  recoverIncompleteCodeFences,
  STREAM_EMPTY_RESPONSE_ERROR,
  stripModelCitationTags,
  stripPlaceholderCitationMarkers,
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
  const unfinished: ChatMessage = {
    id: "unfinished",
    session_id: "s1",
    tenant_id: "t1",
    user_id: "u1",
    role: "assistant",
    content: "<think>尚在分析问题",
    created_at: "2026-10-15T00:00:00.000Z",
  };

  it.each(["cancelled", "disconnected", "failed"] as const)(
    "presents a recoverable terminal state for %s reasoning without an answer",
    (reason) => {
      const message = { ...unfinished, interruption: { reason, contentLength: unfinished.content.length } };
      const parsed = parseAssistantContent(message, false);
      expect(parsed.thinkingInProgress).toBe(false);
      expect(parsed.reasoningContent).toBe("尚在分析问题");
      expect(parsed.displayContent).toBe(STREAM_EMPTY_RESPONSE_ERROR);
      expect(parsed.displayContent).toContain("继续生成");
      expect(message.content).toBe(unfinished.content);
    },
  );

  it("settles legacy history without interruption metadata when the stream is not live", () => {
    expect(parseAssistantContent(unfinished, true)).toMatchObject({
      thinkingInProgress: true,
      displayContent: "",
    });
    expect(parseAssistantContent(unfinished, false)).toMatchObject({
      thinkingInProgress: false,
      displayContent: expect.stringContaining("尚未生成最终答复"),
    });
  });

  it("keeps an active stream running when its persisted checkpoint is marked disconnected", () => {
    const checkpoint = {
      ...unfinished,
      interruption: { reason: "disconnected" as const, contentLength: unfinished.content.length },
    };
    expect(parseAssistantContent(checkpoint, true)).toMatchObject({
      thinkingInProgress: true,
      displayContent: "",
    });
  });

  it("retains a partial answer without injecting a missing-answer notice", () => {
    const partial = "<think>分析</think>已有部分答案";
    const message = {
      ...unfinished,
      content: partial,
      interruption: { reason: "disconnected" as const, contentLength: partial.length },
    };
    expect(parseAssistantContent(message, false)).toMatchObject({
      thinkingInProgress: false,
      displayContent: "已有部分答案",
      reasoningContent: "分析",
    });
  });

  it("does not announce failure for a durable research run", () => {
    const research = { runId: "run", status: "running" as const, events: [] };
    expect(parseAssistantContent({ ...unfinished, deep_research: research }, false).displayContent).toBe("");
  });

  it("closes an open reasoning block for continuation and drops it from the model request", () => {
    const prepared = prepareAssistantContinuation(unfinished.content);
    expect(prepared.retainedContent.endsWith("</think>")).toBe(true);
    expect(prepared.requestContent.trim()).toBe("");
    expect(prepareAssistantContinuation("<think>分析</think>已生成的正文").requestContent).toBe("已生成的正文");
  });

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

  it("strips leaked MiniMax tool-call XML from visible assistant content", () => {
    const thinkOpen = "<" + "think" + ">";
    const thinkClose = "<" + "/" + "think" + ">";
    const parsed = parseAssistantContent({
      id: "m3",
      session_id: "s1",
      tenant_id: "t1",
      user_id: "u1",
      role: "assistant",
      content:
        `${thinkOpen}需要联网搜索${thinkClose}\n\n我来帮您搜索关于王虹的最新新闻。\n` +
        `<minimax:tool_call>\n<invoke name="web_search">\n` +
        `<parameter name="query">王虹 新闻 2026年8月</parameter>\n` +
        `</invoke>\n</minimax:tool_call>`,
      created_at: "2026-08-11T08:38:34.000Z",
    });
    expect(parsed.displayContent).toBe("我来帮您搜索关于王虹的最新新闻。");
    expect(parsed.displayContent).not.toContain("minimax:tool_call");
    expect(parsed.displayContent).not.toContain("invoke");
    expect(parsed.displayContent).not.toContain("web_search");
  });
});
