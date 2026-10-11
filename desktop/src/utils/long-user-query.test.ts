import { describe, expect, it } from "vitest";
import {
  LONG_USER_QUERY_CHAR_LIMIT,
  LONG_USER_QUERY_LINE_LIMIT,
  isLongUserQuery,
} from "./long-user-query";

describe("isLongUserQuery", () => {
  it("keeps a short task prompt expanded", () => {
    expect(isLongUserQuery("收盘后汇总今日成交额")).toBe(false);
  });

  it("collapses a single long line with no newlines", () => {
    const text = "Install with your AI agent".repeat(20);
    expect(text.includes("\n")).toBe(false);
    expect(text.length).toBeGreaterThan(LONG_USER_QUERY_CHAR_LIMIT);
    expect(isLongUserQuery(text)).toBe(true);
  });

  it("collapses once the prompt exceeds the character cap", () => {
    const text = "执行合同".repeat(LONG_USER_QUERY_CHAR_LIMIT);
    expect(text.length).toBeGreaterThan(LONG_USER_QUERY_CHAR_LIMIT);
    expect(isLongUserQuery(text)).toBe(true);
  });

  it("collapses a multi-line contract even when each line is short", () => {
    const text = Array.from({ length: LONG_USER_QUERY_LINE_LIMIT }, (_, index) => `- 规则 ${index + 1}`).join("\n");
    expect(text.length).toBeLessThanOrEqual(LONG_USER_QUERY_CHAR_LIMIT);
    expect(isLongUserQuery(text)).toBe(true);
  });

  it("ignores blank lines when counting", () => {
    expect(isLongUserQuery("第一行\n\n第二行\n\n第三行")).toBe(false);
  });
});
