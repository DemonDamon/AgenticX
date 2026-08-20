import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./mermaid-render", () => ({
  mermaidThemeFromApp: (theme: string) => (theme === "light" ? "default" : "dark"),
  renderMermaidSvg: vi.fn(async ({ code }: { code: string }) => {
    if (code.includes("FAIL")) throw new Error("render failed");
    return `<svg viewBox="0 0 100 40"><text>${code.slice(0, 24)}</text></svg>`;
  }),
}));

import { renderMermaidSvg } from "./mermaid-render";
import { SHARE_WIDGET_HINT, buildShareImageTurns } from "./share-image-model";
import {
  hydrateShareGraphic,
  hydrateShareImageTurns,
} from "./share-image-graphics";
import type { Message } from "../store";

function msg(partial: Partial<Message> & Pick<Message, "id" | "role" | "content">): Message {
  return partial as Message;
}

describe("hydrateShareGraphic", () => {
  beforeEach(() => {
    vi.mocked(renderMermaidSvg).mockClear();
  });

  it("inlines SVG markup for show_widget svg payloads", async () => {
    const graphic = await hydrateShareGraphic(
      {
        kind: "svg",
        title: "对比图",
        code: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
      },
      { appTheme: "dark", renderId: "share-svg-1" },
    );
    expect(graphic).toMatchObject({ status: "ready", title: "对比图" });
    if (graphic.status === "ready") {
      expect(graphic.svgHtml).toContain("<svg");
      expect(graphic.svgHtml).toContain("rect");
    }
  });

  it("renders mermaid source to static SVG", async () => {
    const graphic = await hydrateShareGraphic(
      { kind: "mermaid", title: "链路", code: "flowchart LR\n  A --> B" },
      { appTheme: "dark", renderId: "share-mmd-1" },
    );
    expect(renderMermaidSvg).toHaveBeenCalled();
    expect(graphic.status).toBe("ready");
    if (graphic.status === "ready") {
      expect(graphic.svgHtml).toContain("<svg");
      expect(graphic.svgHtml).toContain("flowchart LR");
      expect(graphic.title).toBe("链路");
    }
  });

  it("falls back when mermaid render fails", async () => {
    const graphic = await hydrateShareGraphic(
      { kind: "mermaid", title: "链路", code: "FAIL flowchart" },
      { appTheme: "dark", renderId: "share-mmd-fail" },
    );
    expect(graphic).toEqual({
      status: "fallback",
      hint: "[图表：链路]（Mermaid 静态渲染失败，请在应用内查看）",
    });
  });

  it("keeps unsupported widgets as a muted hint", async () => {
    const graphic = await hydrateShareGraphic(
      { kind: "unsupported", title: "行情", hint: SHARE_WIDGET_HINT },
      { appTheme: "dark", renderId: "share-html-1" },
    );
    expect(graphic).toEqual({ status: "fallback", hint: SHARE_WIDGET_HINT });
  });
});

describe("hydrateShareImageTurns", () => {
  it("hydrates widget and in-place mermaid parts in conversation order", async () => {
    const turns = buildShareImageTurns([
      msg({ id: "u1", role: "user", content: "画图" }),
      msg({
        id: "w1",
        role: "tool",
        toolName: "show_widget",
        content: JSON.stringify({
          type: "widget",
          title: "对比图",
          widget_code: '<svg viewBox="0 0 8 8"><circle r="4"/></svg>',
        }),
      }),
      msg({
        id: "a1",
        role: "assistant",
        content: "如下\n\n```mermaid\nflowchart LR\n  Home --> Office\n```\n\n结束",
      }),
    ]);
    const hydrated = await hydrateShareImageTurns(turns, { appTheme: "dark" });
    expect(hydrated[0]).toEqual({ kind: "user", text: "画图" });
    expect(hydrated[1]).toMatchObject({
      kind: "widget",
      graphic: { status: "ready", title: "对比图" },
    });
    const assistant = hydrated[2];
    expect(assistant?.kind).toBe("assistant");
    if (assistant?.kind === "assistant") {
      expect(assistant.parts[0]).toEqual({ kind: "md", text: "如下" });
      expect(assistant.parts[1]).toMatchObject({
        kind: "graphic",
        graphic: { status: "ready" },
      });
      expect(assistant.parts[2]).toEqual({ kind: "md", text: "结束" });
    }
  });
});
