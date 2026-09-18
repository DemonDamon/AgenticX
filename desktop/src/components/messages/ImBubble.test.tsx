import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { shouldShowAssistantFollowups, shouldShowAssistantIconButtons } from "../../utils/im-bubble-actions";
import { ChatImAvatar, ImBubble } from "./ImBubble";
import {
  BUNDLED_META_AVATAR_IM_ZOOM_CLASS,
  DEFAULT_META_AVATAR_URL,
} from "../../constants/meta-avatar";

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

  it("zooms the bundled Near logo inside the same 28px circle as expert portraits", () => {
    const html = renderToStaticMarkup(
      <ChatImAvatar label="Near" imageUrl={DEFAULT_META_AVATAR_URL} size="sm" />,
    );
    expect(html).toContain("agx-im-avatar");
    expect(html).toContain("h-7 w-7");
    expect(html).toContain("overflow-hidden");
    expect(html).toContain('data-avatar-fit="logo"');
    expect(html).toContain(BUNDLED_META_AVATAR_IM_ZOOM_CLASS);
    expect(html).toContain(DEFAULT_META_AVATAR_URL);
  });

  it("does not zoom a regular expert portrait", () => {
    const html = renderToStaticMarkup(
      <ChatImAvatar label="调研" imageUrl="https://example.test/r.png" size="sm" />,
    );
    expect(html).not.toContain('data-avatar-fit="logo"');
    expect(html).not.toContain(BUNDLED_META_AVATAR_IM_ZOOM_CLASS);
  });
});

// Ported-ref: fix/glm-stream-common-finalization@5bf63d3e
describe("ImBubble assistant protocol boundary", () => {
  it("does not render a trailing group-control FINAL token", () => {
    const html = renderToStaticMarkup(
      <ImBubble
        message={{
          id: "leaked-control-token",
          role: "assistant",
          content: "字段已补进协议。 FINAL",
          avatarName: "后端·北辰",
        }}
      />,
    );
    expect(html).toContain("字段已补进协议。");
    expect(html).not.toContain("FINAL");
  });

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

  it("sits copy/quote actions to the right of a deliverable card", () => {
    const html = renderToStaticMarkup(
      <ImBubble
        message={{ id: "with-artifact", role: "assistant", content: "已写入 hello.txt" }}
        afterBody={<span>hello.txt-card</span>}
      />,
    );

    expect(html).toContain("agx-artifact-action-row");
    expect(html).toContain("flex-1");
    expect(html).toContain("hello.txt-card");
    const rowIdx = html.indexOf("agx-artifact-action-row");
    const cardIdx = html.indexOf("hello.txt-card");
    const iconsIdx = html.indexOf("agx-assistant-action-icons");
    expect(rowIdx).toBeGreaterThan(-1);
    expect(cardIdx).toBeGreaterThan(rowIdx);
    expect(iconsIdx).toBeGreaterThan(cardIdx);
  });

  it("keeps copy/usage and follow-up chips on a single clipped action line", () => {
    const html = renderToStaticMarkup(
      <ImBubble
        message={{
          id: "followup-squeeze",
          role: "assistant",
          content: "分析完毕。",
          suggestedQuestions: ["帮我估算100MW训练集群在内蒙古vs长三角的年度成本差"],
          usage: {
            inputTokens: 1100,
            outputTokens: 200,
            cachedTokens: 1038,
            reasoningTokens: 0,
            totalTokens: 1300,
          },
          model: "kimi-k2.6",
        }}
        onCopyMessage={() => {}}
        onQuoteMessage={() => {}}
        onFavoriteMessage={() => {}}
        onFollowupClick={() => {}}
      />,
    );

    expect(html).toMatch(/class="[^"]*agx-assistant-action-icons[^"]*\bflex-nowrap\b[^"]*"/);
    expect(html).toMatch(/class="[^"]*agx-assistant-action-icons[^"]*\boverflow-hidden\b[^"]*"/);
    expect(html).not.toMatch(/class="[^"]*agx-assistant-action-icons[^"]*\bflex-wrap\b[^"]*"/);
    expect(html).toContain("agx-followup-chip");
    expect(html).toContain("帮我估算100MW训练集群在内蒙古vs长三角的年度成本差");
    expect(html).toContain("缓存");
  });

  it("gives the model chip a 24px action line when there are no follow-ups", () => {
    const html = renderToStaticMarkup(
      <ImBubble
        message={{
          id: "no-followup-chip",
          role: "assistant",
          content: "分析完毕。",
          model: "glm-5.3-flash",
          usage: {
            inputTokens: 2330,
            outputTokens: 465,
            cachedTokens: 0,
            reasoningTokens: 0,
            totalTokens: 2795,
          },
        }}
        onCopyMessage={() => {}}
        onQuoteMessage={() => {}}
        onFavoriteMessage={() => {}}
      />,
    );

    expect(html).toContain("glm-5.3-flash");
    expect(html).not.toContain("agx-followup-chip");
    expect(html).toMatch(/class="[^"]*agx-assistant-action-line[^"]*\bh-6\b[^"]*"/);
    expect(html).toMatch(/class="[^"]*agx-turn-hover-reveal[^"]*\bgap-2.5\b[^"]*"/);
    expect(html).toMatch(/data-turn-model-chip=""[^>]*\bw-max\b/);
    expect(html).toMatch(/data-turn-model-chip=""[^>]*\bpx-3.5\b/);
    expect(html).toMatch(/data-turn-model-chip=""[^>]*\bshrink-0\b/);
    expect(html).not.toMatch(/data-turn-meta=""[^>]*\boverflow-x-hidden\b/);
    expect(html).not.toMatch(/data-turn-meta=""[^>]*\boverflow-hidden\b/);
  });

  it("puts the citation chip on the model/action row, not under the body", () => {
    const html = renderToStaticMarkup(
      <ImBubble
        message={{
          id: "cite-meta",
          role: "assistant",
          content: "补充分说明：搜索结果里还出现了派生仓库。",
          model: "glm-5.3-flash",
          timestamp: Date.parse("2026-09-14T00:59:00+08:00"),
          references: [
            {
              id: 1,
              title: "CowwAgent",
              url: "https://github.com/example/cow-agent",
              snippet: "",
              source: "web",
              domain: "github.com",
            },
          ],
        }}
        onCopyMessage={() => {}}
        onQuoteMessage={() => {}}
        onFavoriteMessage={() => {}}
        onOpenWorkspaceRefs={() => {}}
      />,
    );

    const lineIdx = html.indexOf("agx-assistant-action-line");
    const iconsIdx = html.indexOf("agx-assistant-action-icons");
    const chipIdx = html.indexOf('data-citation-chip="meta"');
    const modelIdx = html.indexOf("glm-5.3-flash");
    const timeIdx = html.indexOf("2026-09-14 00:59");
    expect(lineIdx).toBeGreaterThan(-1);
    expect(iconsIdx).toBeGreaterThan(lineIdx);
    expect(chipIdx).toBeGreaterThan(iconsIdx);
    expect(modelIdx).toBeGreaterThan(chipIdx);
    expect(timeIdx).toBeGreaterThan(modelIdx);
    expect(html).not.toContain('data-citation-chip="inline"');
    const hoverStart = html.indexOf("agx-turn-hover-reveal");
    expect(hoverStart).toBeGreaterThan(chipIdx);
    expect(hoverStart).toBeGreaterThan(-1);
    expect(html.indexOf("glm-5.3-flash", hoverStart)).toBeGreaterThan(hoverStart);
  });

  it("still shows the citation chip when only session-level refs exist", () => {
    const html = renderToStaticMarkup(
      <ImBubble
        message={{
          id: "cite-session-fallback",
          role: "assistant",
          content: "补充分说明：搜索结果里还出现了派生仓库。",
          model: "MiniMax-M2.1",
          suggestedQuestions: ["你想部署一个 CowAgent 吗？"],
        }}
        sessionWebRefs={[
          {
            id: 1,
            title: "example",
            url: "https://github.com/example/repo",
            snippet: "",
            source: "web",
            domain: "github.com",
          },
        ]}
        onCopyMessage={() => {}}
        onQuoteMessage={() => {}}
        onFavoriteMessage={() => {}}
        onFollowupClick={() => {}}
        onOpenWorkspaceRefs={() => {}}
      />,
    );

    expect(html).toContain("agx-assistant-action-line");
    expect(html).toContain('data-citation-chip="meta"');
    expect(html).not.toContain('data-citation-chip="inline"');
    expect(html).toContain("你想部署一个 CowAgent 吗？");
  });

  it("shows continue-in-new-task on assistant actions only", () => {
    const continueMark = "M12 12.5c.6-4.4 4.8-6.6 8.2-4.2";
    const assistant = renderToStaticMarkup(
      <ImBubble
        message={{ id: "a-continue", role: "assistant", content: "模型回复" }}
        onContinueFromMessage={() => {}}
      />,
    );
    const user = renderToStaticMarkup(
      <ImBubble
        message={{ id: "u-continue", role: "user", content: "飞书mcp" }}
        onContinueFromMessage={() => {}}
      />,
    );
    expect(assistant).toContain(continueMark);
    expect(user).not.toContain(continueMark);
  });
});

describe("ImBubble peer human speaker", () => {
  it("shows the peer display name on a user bubble", () => {
    const html = renderToStaticMarkup(
      <ImBubble
        message={{
          id: "peer-1",
          role: "user",
          content: "进度如何",
          speakerUserId: "human:feishu:ou_1",
          speakerName: "甲",
        }}
      />,
    );
    expect(html).toContain("甲");
    expect(html).toContain("进度如何");
    expect(html).not.toContain("agx-im-group-bubble");
  });

  it("keeps owner user rows labeled as me", () => {
    const html = renderToStaticMarkup(
      <ImBubble
        message={{
          id: "owner-1",
          role: "user",
          content: "hello",
        }}
      />,
    );
    expect(html).toContain("hello");
    expect(html).toContain("agx-im-user-bubble");
    expect(html).not.toContain("rounded-tr-[4px]");
    expect(html).not.toContain("rounded-xl");
    expect(html).not.toContain("甲");
    expect(html).not.toContain("text-text-faint");
  });
});
