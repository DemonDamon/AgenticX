import { describe, expect, it } from "vitest";
import type { Message } from "../store";
import {
  buildMessagesPdfHtml,
  expandSelectionForCompletePdfExport,
  isThinkOnlyAssistantMessage,
  messageContributesToPdfExport,
} from "./export-pdf-html";
import { isShowWidgetToolMessage } from "../components/messages/widget-preview";

function msg(partial: Partial<Message> & Pick<Message, "id" | "role" | "content">): Message {
  return partial as Message;
}

describe("export-pdf-html complete export", () => {
  it("skips think-only assistant scraps and never falls back to raw <think> text", () => {
    const thinkOnly = msg({
      id: "t1",
      role: "assistant",
      content: "<think> The system is flagging my response because I used ASCII arrows.</think>",
    });
    expect(isThinkOnlyAssistantMessage(thinkOnly)).toBe(true);
    expect(messageContributesToPdfExport(thinkOnly)).toBe(false);

    const html = buildMessagesPdfHtml({
      messages: [
        msg({ id: "u1", role: "user", content: "画个架构图" }),
        thinkOnly,
        msg({
          id: "a1",
          role: "assistant",
          content: "## AgenticX 分层记忆管理架构解读\n\n正文在这里。",
        }),
      ],
      exportedAt: Date.UTC(2026, 6, 14, 1, 58, 0),
    });
    expect(html).toContain("分层记忆管理架构解读");
    expect(html).toContain("正文在这里");
    expect(html).not.toContain("flagging");
    expect(html).not.toContain("page-break-inside: avoid");
    expect(html).toContain("page-break-inside: auto");
  });

  it("keeps show_widget even when toolName is missing (content / call-id recovery)", () => {
    const widget = msg({
      id: "w1",
      role: "tool",
      toolCallId: "functions.show_widget:1",
      content: JSON.stringify({
        type: "widget",
        title: "AgenticX 分层记忆管理架构图",
        widget_code: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
      }),
    });
    expect(isShowWidgetToolMessage(widget)).toBe(true);
    expect(messageContributesToPdfExport(widget)).toBe(true);

    const html = buildMessagesPdfHtml({
      messages: [widget],
      exportedAt: Date.UTC(2026, 6, 14, 1, 58, 0),
    });
    expect(html).toContain("分层记忆管理架构图");
    expect(html).toContain("<svg");
  });

  it("expands partial ReAct multi-select to the full turn so the final answer is not omitted", () => {
    const user = msg({ id: "u1", role: "user", content: "画图" });
    const think = msg({
      id: "t1",
      role: "assistant",
      content: "<think>planning</think>",
    });
    const widget = msg({
      id: "w1",
      role: "tool",
      toolName: "show_widget",
      content: JSON.stringify({
        type: "widget",
        title: "图",
        widget_code: "<svg></svg>",
      }),
    });
    const finalAnswer = msg({
      id: "a1",
      role: "assistant",
      content: "AgenticX 分层记忆管理架构解读",
    });
    const all = [user, think, widget, finalAnswer];

    // User only selected the think scrap — export must still pull in widget + final.
    const expanded = expandSelectionForCompletePdfExport([think], all);
    expect(expanded.map((m) => m.id)).toEqual(["u1", "t1", "w1", "a1"]);

    const html = buildMessagesPdfHtml({
      messages: expanded,
      exportedAt: Date.UTC(2026, 6, 14, 1, 58, 0),
    });
    expect(html).toContain("分层记忆管理架构解读");
    expect(html).toContain("<svg");
    expect(html).not.toContain("planning");
  });

  it("strips think tags but keeps the real response body", () => {
    const mixed = msg({
      id: "a1",
      role: "assistant",
      content: "<think>internal</think>\n\n## 正式回答\n\n可见正文",
    });
    expect(isThinkOnlyAssistantMessage(mixed)).toBe(false);
    const html = buildMessagesPdfHtml({
      messages: [mixed],
      exportedAt: Date.UTC(2026, 6, 14, 1, 58, 0),
    });
    expect(html).toContain("正式回答");
    expect(html).toContain("可见正文");
    expect(html).not.toContain("internal");
  });
});
