import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { shouldShowAssistantFollowups, shouldShowAssistantIconButtons } from "../../utils/im-bubble-actions";
import { ImBubble } from "./ImBubble";

const baseVisible = {
  hideActions: false,
  isUser: false,
  isStreaming: false,
  isGroupTyping: false,
  isMetaPendingWork: false,
  hasBody: true,
  sessionBusy: false,
  isLastAssistantInPane: false,
};

describe("shouldShowAssistantIconButtons", () => {
  it("shows actions for a normal assistant message", () => {
    expect(shouldShowAssistantIconButtons(baseVisible)).toBe(true);
  });

  it("hides actions while streaming placeholder is active", () => {
    expect(shouldShowAssistantIconButtons({ ...baseVisible, isStreaming: true })).toBe(false);
  });

  it("suppresses last assistant actions when session is busy", () => {
    expect(
      shouldShowAssistantIconButtons({
        ...baseVisible,
        sessionBusy: true,
        isLastAssistantInPane: true,
      })
    ).toBe(false);
  });

  it("keeps historical assistant actions when session is busy", () => {
    expect(
      shouldShowAssistantIconButtons({
        ...baseVisible,
        sessionBusy: true,
        isLastAssistantInPane: false,
      })
    ).toBe(true);
  });

  it("restores last assistant actions when session is idle", () => {
    expect(
      shouldShowAssistantIconButtons({
        ...baseVisible,
        sessionBusy: false,
        isLastAssistantInPane: true,
      })
    ).toBe(true);
  });
});

const baseFollowups = {
  isUser: false,
  isStreaming: false,
  isGroupTyping: false,
  omitSuggestedQuestions: false,
  hasBody: true,
  hasSuggestedQuestions: true,
  hasFollowupHandler: true,
  sessionBusy: false,
  isLastAssistantInPane: false,
};

describe("shouldShowAssistantFollowups", () => {
  it("shows followups for a completed assistant message", () => {
    expect(shouldShowAssistantFollowups(baseFollowups)).toBe(true);
  });

  it("hides followups while streaming placeholder is active", () => {
    expect(shouldShowAssistantFollowups({ ...baseFollowups, isStreaming: true })).toBe(false);
  });

  it("suppresses last assistant followups when session is busy", () => {
    expect(
      shouldShowAssistantFollowups({
        ...baseFollowups,
        sessionBusy: true,
        isLastAssistantInPane: true,
      })
    ).toBe(false);
  });

  it("keeps historical assistant followups when session is busy", () => {
    expect(
      shouldShowAssistantFollowups({
        ...baseFollowups,
        sessionBusy: true,
        isLastAssistantInPane: false,
      })
    ).toBe(true);
  });

  it("hides followups when assistant body is empty", () => {
    expect(shouldShowAssistantFollowups({ ...baseFollowups, hasBody: false })).toBe(false);
  });
});

describe("ImBubble group expert identity", () => {
  it("shows a prominent expert label without avatar chrome when showSenderIdentity", () => {
    const html = renderToStaticMarkup(
      <ImBubble
        message={{
          id: "expert-1",
          role: "assistant",
          content: "收到，按 T1–T5 拆解。\n\n## 结论\n1. T1\n2. T2",
          avatarName: "架构师·阿析",
        }}
        showSenderIdentity
        senderAvatarId="avatar-architect"
        assistantName="架构师·阿析"
      />,
    );

    expect(html).toContain("架构师·阿析");
    expect(html).toContain("折叠");
    expect(html).toContain("border-color:");
    expect(html).not.toContain("agx-im-avatar");
  });
});

// Ported-ref: fix/glm-stream-common-finalization@5bf63d3e
describe("ImBubble assistant protocol boundary", () => {
  it("does not render an unclosed followups tail from historical messages", () => {
    const raw =
      "全部修复完成。\n\n粒子间距离 < 120px 时自动连线。\n\n<followups>粒子动画太卡了怎么优化\n待办事项能不能按分类筛选\n背景粒子颜色能不能换成其他配色";
    const html = renderToStaticMarkup(
      <ImBubble message={{ id: "historical-assistant", role: "assistant", content: raw }} />,
    );

    expect(html).toContain("全部修复完成。");
    expect(html).not.toContain("followups");
    expect(html).not.toContain("粒子动画太卡了怎么优化");
  });

  it("does not render a ReasoningBlock when reasoning only echoes the body", () => {
    const body =
      "## 总结\n\n当前目录有两个 .py 文件：\n- `analyze_cursor_cost.py`\n- `simple.py`";
    const html = renderToStaticMarkup(
      <ImBubble
        message={{
          id: "dup-reasoning",
          role: "assistant",
          content: body,
          reasoning: body,
          reasoningSeconds: 5,
        }}
      />,
    );

    expect(html).toContain("总结");
    expect(html).not.toContain("思考了");
    expect(html).not.toContain("Thought");
  });
});
