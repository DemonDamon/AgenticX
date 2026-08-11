import { describe, expect, it } from "vitest";
import { formatToolDisplayName } from "./tool-display-name";

describe("formatToolDisplayName", () => {
  it("formats MCP compound tool ids", () => {
    expect(formatToolDisplayName("mcp__metaso-search__metaso_search")).toBe(
      "metaso-search · metaso_search",
    );
  });

  it("returns non-MCP names as-is", () => {
    expect(formatToolDisplayName("web_search")).toBe("web_search");
  });

  it("falls back for empty input", () => {
    expect(formatToolDisplayName("")).toBe("工具");
    expect(formatToolDisplayName("   ")).toBe("工具");
  });
});
