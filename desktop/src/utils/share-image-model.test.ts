import { describe, expect, it } from "vitest";
import type { Message } from "../store";
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
      { kind: "assistant", text: "先说结论" },
    ]);
  });

  it("attaches a widget hint to the assistant turn instead of rasterizing the chart", () => {
    const turns = buildShareImageTurns([
      msg({ id: "u1", role: "user", content: "画图" }),
      msg({
        id: "w1",
        role: "tool",
        toolName: "show_widget",
        content: JSON.stringify({
          type: "widget",
          title: "图",
          widget_code: "<svg></svg>",
        }),
      }),
      msg({ id: "a1", role: "assistant", content: "如图所示" }),
    ]);
    expect(turns).toEqual([
      { kind: "user", text: "画图" },
      { kind: "assistant", text: "如图所示", hasWidgetHint: true },
    ]);
    expect(SHARE_WIDGET_HINT).toContain("图表");
  });
});

describe("formatShareCardDate", () => {
  it("formats as YYYY 年 M 月 D 日 without zero-padding", () => {
    expect(formatShareCardDate(Date.UTC(2026, 7, 13, 12, 0, 0))).toMatch(/2026 年 \d+ 月 \d+ 日/);
    const local = formatShareCardDate(new Date(2026, 7, 13).getTime());
    expect(local).toBe("2026 年 8 月 13 日");
  });
});
