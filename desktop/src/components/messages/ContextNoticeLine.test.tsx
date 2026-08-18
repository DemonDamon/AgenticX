import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { noticeKindForRuntimeWarning } from "../../utils/context-notice";
import { ContextNoticeLine } from "./ContextNoticeLine";

describe("ContextNoticeLine", () => {
  it.each([
    ["token_warning_yellow", "token-warning-yellow"],
    ["token_warning_red", "token-warning-red"],
    ["enterprise_quota", "enterprise-quota"],
    ["context_compact", "context-limit"],
  ] as const)("renders %s with its own visual status", (kind, status) => {
    const html = renderToStaticMarkup(
      <ContextNoticeLine kind={kind} text="会话用量提醒" />,
    );
    expect(html).toContain(`data-status-kind="${status}"`);
    expect(html).toContain("会话用量提醒");
  });

  it("maps runtime warning metadata without changing context-compaction notices", () => {
    expect(noticeKindForRuntimeWarning("token_budget_warning", "yellow")).toBe(
      "token_warning_yellow",
    );
    expect(noticeKindForRuntimeWarning("token_budget_session_reached", "red")).toBe(
      "token_warning_red",
    );
    expect(noticeKindForRuntimeWarning("enterprise_quota", "")).toBe(
      "enterprise_quota",
    );
    expect(noticeKindForRuntimeWarning("context_window", "")).toBe("context_compact");
  });
});
