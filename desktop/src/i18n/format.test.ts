import { describe, expect, it } from "vitest";
import { dateLocale, formatClock, formatDateTime } from "./format";

describe("date locale helpers", () => {
  it("maps app locales to Intl tags", () => {
    expect(dateLocale("en")).toBe("en-US");
    expect(dateLocale("zh")).toBe("zh-CN");
  });

  it("formats clock and datetime without throwing", () => {
    const ts = Date.UTC(2026, 8, 8, 5, 30, 0);
    expect(formatClock(ts, "en")).toMatch(/\d/);
    expect(formatClock(ts, "zh")).toMatch(/\d/);
    expect(formatDateTime(ts, "en")).toMatch(/2026/);
    expect(formatDateTime(ts, "zh")).toMatch(/2026/);
  });
});
