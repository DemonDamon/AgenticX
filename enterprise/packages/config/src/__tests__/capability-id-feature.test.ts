import { describe, expect, it } from "vitest";

import {
  featureCapabilityId,
  formatCapabilityId,
  isCapabilityId,
  parseCapabilityId,
  parseFeatureCapabilityId,
} from "../capability-id";

const ULID = "01JQMZ8K3N4P5Q6R7S8T9VWXYZ";

describe("platform features as capabilities", () => {
  it("formats and parses a feature id", () => {
    expect(featureCapabilityId("web_search")).toBe("feature:web_search");
    expect(parseCapabilityId("feature:deep_research")).toEqual({
      kind: "feature",
      rowId: "deep_research",
    });
  });

  it("goes through the same entry point as mcp and skill", () => {
    // 能力包成员一律经 formatCapabilityId 构造，功能不该有第二条拼字符串的路径。
    expect(formatCapabilityId("feature", "web_search")).toBe("feature:web_search");
    expect(formatCapabilityId("mcp", ULID)).toBe(`mcp:${ULID}`);
  });

  it("refuses a feature nobody defined", () => {
    // 打错的功能名不能冒充一个能力：包里放进去之后谁都拿不到，而界面上看起来是配好了。
    expect(parseCapabilityId("feature:web_serach")).toBeNull();
    expect(parseFeatureCapabilityId("feature:")).toBeNull();
    expect(isCapabilityId("feature:anything")).toBe(false);
    expect(() => formatCapabilityId("feature", "nope")).toThrow(/unknown platform feature/);
  });

  it("still requires a ULID for rows, not a name", () => {
    // feature 是常量所以免了 ULID；mcp/skill 指向可改名的行，那条理由依然成立。
    expect(() => formatCapabilityId("mcp", "market-data")).toThrow(/requires a ULID/);
    expect(parseCapabilityId("skill:my-skill")).toBeNull();
  });
});
