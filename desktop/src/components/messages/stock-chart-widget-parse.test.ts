import { describe, expect, it } from "vitest";
import {
  isBrokenStockChartAttempt,
  parseWidgetPayload,
  stockChartDegradedMessage,
} from "./widget-preview";

describe("parseWidgetPayload stock_chart branch", () => {
  it("parses a valid stock_chart payload", () => {
    const raw = JSON.stringify({
      type: "stock_chart",
      title: "603678.SH",
      chart_type: "candlestick",
      points: [{ date: "2026-07-01", open: 80, high: 90, low: 78, close: 85, volume: 1200 }],
      attribution: "数据来源：AkShare",
    });
    const parsed = parseWidgetPayload(raw);
    expect(parsed?.kind).toBe("stock_chart");
    if (parsed?.kind === "stock_chart") {
      expect(parsed.points).toHaveLength(1);
      expect(parsed.attribution).toBe("数据来源：AkShare");
    }
  });

  it("normalizes akshare chinese column names", () => {
    const raw = JSON.stringify({
      type: "stock_chart",
      title: "火炬电子",
      points: [{ 日期: "2026-07-01", 开盘: 80, 最高: 90, 最低: 78, 收盘: 85, 成交量: 999 }],
    });
    const parsed = parseWidgetPayload(raw);
    expect(parsed?.kind).toBe("stock_chart");
  });

  it("returns null when points are missing", () => {
    const raw = JSON.stringify({ type: "stock_chart", title: "x", points: [] });
    expect(parseWidgetPayload(raw)).toBeNull();
  });

  it("detects broken stock_chart attempts for degradation UI", () => {
    expect(isBrokenStockChartAttempt(JSON.stringify({ type: "stock_chart", points: [] }))).toBe(true);
    expect(parseWidgetPayload(JSON.stringify({ type: "stock_chart", points: [] }))).toBeNull();
    expect(stockChartDegradedMessage()).toMatch(/无法渲染/);
  });
});
