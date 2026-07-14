import { describe, expect, it } from "vitest";
import { parseWidgetPayload } from "./widget-preview";

describe("parseWidgetPayload widget_format", () => {
  it("returns kind mermaid when widget_format is mermaid", () => {
    const payload = parseWidgetPayload(
      JSON.stringify({
        type: "widget",
        title: "流程",
        widget_format: "mermaid",
        widget_code: "flowchart LR\n  A --> B",
      }),
    );
    expect(payload?.kind).toBe("mermaid");
    if (payload && payload.kind !== "stock_chart") {
      expect(payload.widgetCode).toContain("flowchart");
    }
  });

  it("prefers explicit svg over source prefix", () => {
    const payload = parseWidgetPayload(
      JSON.stringify({
        type: "widget",
        title: "svg",
        widget_format: "svg",
        widget_code: "<div>not svg prefix</div>",
      }),
    );
    expect(payload?.kind).toBe("svg");
  });

  it("returns html for explicit html format", () => {
    const payload = parseWidgetPayload(
      JSON.stringify({
        type: "widget",
        title: "html",
        widget_format: "html",
        widget_code: "<div>chart</div>",
      }),
    );
    expect(payload?.kind).toBe("html");
  });

  it("infers svg from <svg prefix when format is absent", () => {
    const payload = parseWidgetPayload(
      JSON.stringify({
        type: "widget",
        title: "legacy",
        widget_code: '<svg viewBox="0 0 10 10"></svg>',
      }),
    );
    expect(payload?.kind).toBe("svg");
  });

  it("infers html from non-svg when format is absent", () => {
    const payload = parseWidgetPayload(
      JSON.stringify({
        type: "widget",
        title: "legacy html",
        widget_code: "<div>hello</div>",
      }),
    );
    expect(payload?.kind).toBe("html");
  });

  it("ignores unknown format and falls back to prefix inference", () => {
    const payload = parseWidgetPayload(
      JSON.stringify({
        type: "widget",
        title: "unknown",
        widget_format: "canvas",
        widget_code: '<svg viewBox="0 0 1 1"></svg>',
      }),
    );
    expect(payload?.kind).toBe("svg");
  });

  it("keeps stock_chart parsing unchanged", () => {
    const payload = parseWidgetPayload(
      JSON.stringify({
        type: "stock_chart",
        title: "603678.SH",
        chart_type: "candlestick",
        points: [
          { date: "2026-07-01", open: 80, high: 90, low: 78, close: 85 },
        ],
      }),
    );
    expect(payload?.kind).toBe("stock_chart");
  });
});
