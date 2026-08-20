import { describe, expect, it } from "vitest";
import type { Message } from "../store";
import { messagesForShareExport } from "./export-pdf-html";
import {
  SHARE_WIDGET_HINT,
  buildShareImageTurns,
  formatShareCardDate,
} from "./share-image-model";

function msg(partial: Partial<Message> & Pick<Message, "id" | "role" | "content">): Message {
  return partial as Message;
}

describe("buildShareImageTurns", () => {
  it("pairs user bubble text with assistant markdown and drops ordinary tools", () => {
    const turns = buildShareImageTurns([
      msg({ id: "u1", role: "user", content: "分析 AgenticX" }),
      msg({ id: "t1", role: "assistant", content: "<think>plan</think>\n\n先说结论" }),
      msg({ id: "tool1", role: "tool", toolName: "web_search", content: "hits" }),
    ]);
    expect(turns).toEqual([
      { kind: "user", text: "分析 AgenticX" },
      { kind: "assistant", parts: [{ kind: "md", text: "先说结论" }] },
    ]);
  });

  it("emits show_widget SVG as its own graphic turn instead of a text hint", () => {
    const turns = buildShareImageTurns([
      msg({ id: "u1", role: "user", content: "画图" }),
      msg({
        id: "w1",
        role: "tool",
        toolName: "show_widget",
        content: JSON.stringify({
          type: "widget",
          title: "网络路径对比",
          widget_code: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
        }),
      }),
      msg({ id: "a1", role: "assistant", content: "如图所示" }),
    ]);
    expect(turns).toEqual([
      { kind: "user", text: "画图" },
      {
        kind: "widget",
        source: {
          kind: "svg",
          title: "网络路径对比",
          code: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
        },
      },
      { kind: "assistant", parts: [{ kind: "md", text: "如图所示" }] },
    ]);
  });

  it("emits show_widget Mermaid as a mermaid graphic source", () => {
    const turns = buildShareImageTurns([
      msg({
        id: "w1",
        role: "tool",
        toolName: "show_widget",
        content: JSON.stringify({
          type: "widget",
          title: "任务链路",
          widget_format: "mermaid",
          widget_code: "flowchart LR\n  A --> B",
        }),
      }),
    ]);
    expect(turns).toEqual([
      {
        kind: "widget",
        source: {
          kind: "mermaid",
          title: "任务链路",
          code: "flowchart LR\n  A --> B",
        },
      },
    ]);
  });

  it("keeps interactive / unparseable widgets as a fallback hint", () => {
    const turns = buildShareImageTurns([
      msg({
        id: "w1",
        role: "tool",
        toolName: "show_widget",
        content: JSON.stringify({
          type: "widget",
          title: "交互图",
          widget_format: "html",
          widget_code: "<div id='chart'></div><script>draw()</script>",
        }),
      }),
      msg({
        id: "w2",
        role: "tool",
        toolName: "show_widget",
        content: "not-json",
      }),
    ]);
    expect(turns).toEqual([
      {
        kind: "widget",
        source: { kind: "unsupported", title: "交互图", hint: SHARE_WIDGET_HINT },
      },
      {
        kind: "widget",
        source: { kind: "unsupported", hint: SHARE_WIDGET_HINT },
      },
    ]);
  });

  it("keeps show_widget after share-export expansion of a selected final answer", () => {
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
        title: "对比图",
        widget_code: '<svg viewBox="0 0 4 4"><rect width="4" height="4"/></svg>',
      }),
    });
    const answer = msg({ id: "a1", role: "assistant", content: "如图所示" });
    const all = [user, think, widget, answer];
    const turns = buildShareImageTurns(messagesForShareExport([answer], all));
    expect(turns.map((t) => t.kind)).toEqual(["user", "widget", "assistant"]);
    expect(turns[1]).toMatchObject({
      kind: "widget",
      source: { kind: "svg", title: "对比图" },
    });
  });

  it("splits assistant mermaid fences into in-place graphic parts", () => {
    const turns = buildShareImageTurns([
      msg({
        id: "a1",
        role: "assistant",
        content: "先画图\n\n```mermaid\nflowchart LR\n  Home --> Office\n```\n\n再解释",
      }),
    ]);
    expect(turns).toEqual([
      {
        kind: "assistant",
        parts: [
          { kind: "md", text: "先画图" },
          { kind: "graphic", source: { kind: "mermaid", code: "flowchart LR\n  Home --> Office" } },
          { kind: "md", text: "再解释" },
        ],
      },
    ]);
  });
});

describe("formatShareCardDate", () => {
  it("formats as YYYY 年 M 月 D 日 without zero-padding", () => {
    expect(formatShareCardDate(Date.UTC(2026, 7, 13, 12, 0, 0))).toMatch(/2026 年 \d+ 月 \d+ 日/);
    const local = formatShareCardDate(new Date(2026, 7, 13).getTime());
    expect(local).toBe("2026 年 8 月 13 日");
  });
});
