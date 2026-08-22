import { describe, expect, it } from "vitest";
import {
  isWidgetFlowRetryNotice,
  parseContextNotice,
  WIDGET_FLOW_RETRY_NOTICE,
} from "./context-notice";

describe("parseContextNotice — widget flow rewrite", () => {
  it("recognizes the notice by kind", () => {
    const parsed = parseContextNotice({
      role: "tool",
      content: WIDGET_FLOW_RETRY_NOTICE,
      noticeKind: "widget_flow_retry",
    });
    expect(parsed?.kind).toBe("widget_flow_retry");
    expect(isWidgetFlowRetryNotice({
      role: "tool",
      content: WIDGET_FLOW_RETRY_NOTICE,
      noticeKind: "widget_flow_retry",
    })).toBe(true);
  });

  it("recognizes the notice by text when kind is absent", () => {
    const parsed = parseContextNotice({
      role: "tool",
      content: WIDGET_FLOW_RETRY_NOTICE,
    });
    expect(parsed?.kind).toBe("widget_flow_retry");
    expect(isWidgetFlowRetryNotice({
      role: "tool",
      content: WIDGET_FLOW_RETRY_NOTICE,
    })).toBe(true);
  });
});
