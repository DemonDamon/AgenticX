import { describe, expect, it } from "vitest";

import { extractPartialShowWidgetArgs, finalizePartialSvg } from "./show-widget-partial";

describe("extractPartialShowWidgetArgs", () => {
  it("extracts complete title and svg", () => {
    const raw = JSON.stringify({
      title: "故障时间线",
      widget_code: "<svg viewBox='0 0 10 10'><rect x='0' y='0' width='1' height='1'/></svg>",
    });
    const parsed = extractPartialShowWidgetArgs(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe("故障时间线");
    expect(parsed?.widgetCode).toContain("<svg");
    expect(parsed?.readyForPreview).toBe(true);
  });

  it("extracts truncated widget_code prefix", () => {
    const raw = '{"title":"x","widget_code":"<svg viewBox=\\"0 0 10 10\\"><rect x=\\"0\\" y=\\"0\\"';
    const parsed = extractPartialShowWidgetArgs(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe("x");
    expect(parsed?.widgetCode).toContain("<svg");
    expect(parsed?.readyForPreview).toBe(true);
  });

  it("returns title-only scaffold when widget_code is absent", () => {
    const parsed = extractPartialShowWidgetArgs('{"title":"x"');
    expect(parsed).toEqual({
      title: "x",
      widgetCode: "",
      readyForPreview: false,
    });
  });

  it("handles escaped quotes in title", () => {
    const parsed = extractPartialShowWidgetArgs('{"title":"say \\"hello\\"","widget_code":"<svg"}');
    expect(parsed?.title).toBe('say "hello"');
  });
});

describe("finalizePartialSvg", () => {
  it("appends closing tag for incomplete svg", () => {
    const fixed = finalizePartialSvg("<svg viewBox='0 0 10 10'><rect x='0' y='0' width='5' height='5'");
    expect(fixed).not.toBeNull();
    expect(fixed?.toLowerCase()).toContain("</svg>");
  });

  it("returns null for non-svg content", () => {
    expect(finalizePartialSvg("hello")).toBeNull();
  });
});
