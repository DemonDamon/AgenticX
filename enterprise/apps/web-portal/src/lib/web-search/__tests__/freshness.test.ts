import { describe, expect, it } from "vitest";
import { resolveFreshness } from "../freshness";

describe("resolveFreshness", () => {
  it("maps weather / realtime queries to oneDay", () => {
    expect(resolveFreshness("广州南沙天气如何")).toBe("oneDay");
  });

  it("maps news / earnings queries to oneWeek", () => {
    expect(resolveFreshness("英伟达最新财报")).toBe("oneWeek");
  });

  it("returns undefined for stable facts", () => {
    expect(resolveFreshness("勾股定理证明")).toBeUndefined();
  });

  it("returns undefined for empty query", () => {
    expect(resolveFreshness("")).toBeUndefined();
  });
});
