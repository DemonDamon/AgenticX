import { describe, expect, it } from "vitest";
import { parseContextNotice } from "./context-notice";

describe("parseContextNotice — widget flow rewrite", () => {
  it("recognizes the notice by kind", () => {
    const parsed = parseContextNotice({
      role: "tool",
      content: "正文按图示规范重写中，上一稿已撤回。",
      noticeKind: "widget_flow_retry",
    });
    expect(parsed?.kind).toBe("widget_flow_retry");
    expect(parsed?.text).toMatch(/图示规范重写/);
  });

  it("recognizes the notice by text when kind is absent", () => {
    const parsed = parseContextNotice({
      role: "tool",
      content: "正文按图示规范重写中，上一稿已撤回。",
    });
    expect(parsed?.kind).toBe("widget_flow_retry");
  });
});
