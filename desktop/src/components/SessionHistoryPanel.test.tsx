import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChatPane } from "../store";
import { SessionHistoryPanel } from "./SessionHistoryPanel";

describe("SessionHistoryPanel", () => {
  it("renders a question directory without another search field", () => {
    const pane = {
      id: "pane-1",
      sessionId: "session-1",
      historyOpen: true,
      messages: [
        { id: "u1", role: "user", content: "第一轮要分析什么？" },
        { id: "a1", role: "assistant", content: "回答" },
        { id: "u2", role: "user", content: "第二轮继续补充。" },
      ],
    } as ChatPane;

    const html = renderToStaticMarkup(<SessionHistoryPanel pane={pane} />);
    expect(html).toContain("本会话提问");
    expect(html).toContain("2 轮");
    expect(html).toContain("第一轮要分析什么？");
    expect(html).not.toContain('aria-label="搜索本会话提问"');
  });
});
