import { describe, expect, it } from "vitest";
import {
  buildCurrentTimeBlock,
  getCurrentTimeFacts,
  isCurrentDateTimeQuery,
  withCurrentTimeContext,
} from "../current-time";

describe("enterprise current time grounding", () => {
  it("builds a block with today's local date", () => {
    const now = new Date("2026-08-01T13:34:00+08:00");
    const block = buildCurrentTimeBlock(now);
    expect(block).toContain("## 当前时间");
    expect(block).toContain("2026-08-01");
    expect(block).toContain("禁止");
    expect(getCurrentTimeFacts(now).date).toBe("2026-08-01");
  });

  it("detects pure date/time questions and rejects lunar/news", () => {
    expect(isCurrentDateTimeQuery("今天几号啊")).toBe(true);
    expect(isCurrentDateTimeQuery("今天几号")).toBe(true);
    expect(isCurrentDateTimeQuery("现在几点")).toBe(true);
    expect(isCurrentDateTimeQuery("今天星期几")).toBe(true);
    expect(isCurrentDateTimeQuery("What's the date today?")).toBe(true);
    expect(isCurrentDateTimeQuery("今天农历是什么")).toBe(false);
    expect(isCurrentDateTimeQuery("今天有什么新闻")).toBe(false);
    expect(isCurrentDateTimeQuery("今天天气怎么样")).toBe(false);
  });

  it("injects current time once into system messages", () => {
    const once = withCurrentTimeContext([{ role: "user", content: "今天几号" }]);
    expect(once[0]?.role).toBe("system");
    expect(String(once[0]?.content)).toContain("当前时间");
    const twice = withCurrentTimeContext(once);
    expect(String(twice[0]?.content).split("## 当前时间").length - 1).toBe(1);
  });
});
