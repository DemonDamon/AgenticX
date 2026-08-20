import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { shouldShowAssistantFollowups, shouldShowAssistantIconButtons } from "../../utils/im-bubble-actions";
import { ChatImAvatar, ImBubble } from "./ImBubble";

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

  it("keeps group committed reply actions while the session is still busy", () => {
    expect(
      shouldShowAssistantIconButtons({
        ...baseVisible,
        sessionBusy: true,
        isLastAssistantInPane: true,
        keepActionsWhileBusy: true,
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

  it("keeps group committed reply followups while the session is still busy", () => {
    expect(
      shouldShowAssistantFollowups({
        ...baseFollowups,
        sessionBusy: true,
        isLastAssistantInPane: true,
        keepActionsWhileBusy: true,
      })
    ).toBe(true);
  });
});

describe("ImBubble group expert identity", () => {
  it("shows digital expert avatar and compact solid bubble in group chat", () => {
    const html = renderToStaticMarkup(
      <ImBubble
        message={{
          id: "g1",
          role: "assistant",
          content: "结论：建议采用方案 A。",
          avatarName: "架构师",
          avatarUrl: "https://example.test/avatar.png",
        }}
        showSenderIdentity
        senderAvatarId="architect"
        assistantName="架构师"
        assistantAvatarUrl="https://example.test/avatar.png"
      />,
    );
    expect(html).toContain("agx-im-avatar");
    expect(html).toContain("https://example.test/avatar.png");
    expect(html).toContain("agx-im-group-bubble");
    expect(html).toContain("架构师");
    expect(html).toContain("结论：建议采用方案 A。");
    expect(html).not.toContain("展开");
    expect(html).not.toContain("折叠");
  });

  it("keeps copy/quote on a group reply while the session is still running", () => {
    const html = renderToStaticMarkup(
      <ImBubble
        message={{
          id: "g-busy",
          role: "assistant",
          content: "结论：今天可以出门。",
          avatarName: "途鉴",
        }}
        showSenderIdentity
        senderAvatarId="tujian"
        assistantName="途鉴"
        sessionBusy
        isLastAssistantInPane
        onCopyMessage={() => {}}
        onQuoteMessage={() => {}}
        onFavoriteMessage={() => {}}
      />,
    );
    expect(html).toContain("agx-assistant-action-icons");
    expect(html).toContain("lucide-copy");
    expect(html).toContain("lucide-quote");
    expect(html).toContain("lucide-bookmark");
  });

  it("still hides Meta last-assistant actions while the session is busy", () => {
    const html = renderToStaticMarkup(
      <ImBubble
        message={{
          id: "meta-busy",
          role: "assistant",
          content: "我来帮你看一下这段代码。",
        }}
        assistantName="Near"
        sessionBusy
        isLastAssistantInPane
        onCopyMessage={() => {}}
        onQuoteMessage={() => {}}
        onFavoriteMessage={() => {}}
      />,
    );
    expect(html).not.toContain("agx-assistant-action-icons");
    expect(html).not.toContain("lucide-copy");
  });

  it("keeps Meta single chat free of group avatar chrome", () => {
    const metaHtml = renderToStaticMarkup(
      <ImBubble
        message={{
          id: "meta-1",
          role: "assistant",
          content: "我来帮你看一下这段代码。",
        }}
        assistantName="Near"
      />,
    );
    expect(metaHtml).toContain("我来帮你看一下这段代码。");
    expect(metaHtml).not.toContain("agx-im-avatar");
    expect(metaHtml).not.toContain("agx-im-group-bubble");
  });
});

describe("ChatImAvatar", () => {
  it("renders an image with the sm size class", () => {
    const html = renderToStaticMarkup(
      <ChatImAvatar label="调研" imageUrl="https://example.test/r.png" size="sm" />,
    );
    expect(html).toContain("agx-im-avatar");
    expect(html).toContain("h-7 w-7");
    expect(html).toContain("https://example.test/r.png");
  });

  it("keeps the default md size at 32px", () => {
    const html = renderToStaticMarkup(<ChatImAvatar label="N" />);
    expect(html).toContain("agx-im-avatar");
    expect(html).toContain("h-8 w-8");
    expect(html).toContain("N");
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

  it("does not render a MiniMax followflows alias block as markdown body", () => {
    const raw =
      "总结正文\n<followflows>客户追问 Qoder Work 和 Cursor 怎么选 客户想看 Qoder Work 的具体功能演示 客户问 Qoder Work 价格和订阅方案</followflows>";
    const html = renderToStaticMarkup(
      <ImBubble message={{ id: "minimax-followflows", role: "assistant", content: raw }} />,
    );

    expect(html).toContain("总结正文");
    expect(html).not.toContain("followflows");
    expect(html).not.toContain("客户追问 Qoder Work 和 Cursor 怎么选");
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
