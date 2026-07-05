# Sub-Plan D：富渲染（show_widget + ECharts MVP → 专用 StockChartWidget 组件）

Planned-with: Claude Sonnet 5
Plan-Id: 2026-07-05-data-source-rich-visualization
Plan-File: .cursor/plans/2026-07-05-data-source-rich-visualization.plan.md
父规划: `.cursor/plans/2026-07-05-unified-data-source-gateway.plan.md`
前置依赖: Sub-Plan B（需要真实数据形状）、Sub-Plan C（Desktop 侧展示位置/主题变量已就绪）

## 1. 需求

### FR

- **FR-1（MVP，必须）**：Agent 拿到 `query_data_source` 的行情数据后，调用既有 `show_widget` 工具，`widget_code` 为内嵌 ECharts 的 HTML 片段渲染 K 线图，复用 `WidgetBlock.tsx` 已允许的 CDN 白名单（`cdnjs`/`esm.sh`/`jsdelivr`/`unpkg`）。此路径**零框架改动**，只靠 Skill/系统提示约束 Agent 的调用顺序（详见 Sub-Plan E）。
- **FR-2（产品级，本子规划的主体交付）**：新增 `show_widget` 的一个**结构化变体**：当 `widget_code` 是一段以 `{"type":"stock_chart",...}` 开头的 JSON（而非 SVG/HTML）时，`WidgetBlock.tsx` 路由到专用的 `StockChartWidget.tsx` 组件渲染，而不是走通用 SVG/HTML 沙箱路径。这样可以做到：暗色/浅色主题自动适配（用 CSS 变量而非 Agent 手写颜色）、涨跌配色遵循 A股「红涨绿跌」约定、悬浮 tooltip、数据来源角标常驻展示。
- **FR-3**：`StockChartWidget` 支持最小三态：K 线（蜡烛图）、成交量子图（双轴联动）、简单折线（宏观指标场景，如 GDP 走势不适合蜡烛图）。数据形状由 `query_data_source` 返回的 `data` 字段直接映射，不需要 Agent 手写图表 option。
- **FR-4**：`StockChartWidget` 展示 `attribution` 字段（如「数据来源：AkShare」）为常驻角标，不可被 Agent 省略或篡改（前端固定读取 payload 里的 `attribution`，Agent 只负责传递 `query_data_source` 原样返回的字段，不重新编造）。

### NFR

- **NFR-1**：`StockChartWidget` 复用现有 `WidgetBlock.tsx` 的 `ZoomableViewport`/放大弹窗/复制导出交互，不重新实现一套（保持产品体验一致性）。
- **NFR-2**：数据点数量超过一定阈值（如 500）时前端需做降采样或滚动条，避免渲染卡顿。
- **NFR-3**：`show_widget` 的结构化变体解析失败（JSON 损坏、`type` 未知）时必须优雅降级为现有「图表内容被压缩截断」式的警告展示，不能白屏。

### AC

- **AC-1**：MVP 路径（FR-1）在没有任何前端代码改动的情况下，今天就能跑通：Agent 用 ECharts HTML 画出真实 K 线并在暗色主题下可读。
- **AC-2**：产品级路径（FR-2/3）中，传入一段 `stock_chart` 结构化 payload，聊天气泡内渲染出蜡烛图 + 成交量双轴图，涨跌配色遵循「红涨绿跌」。
- **AC-3**：传入损坏的 `stock_chart` payload（缺 `data` 字段）不导致整个消息渲染失败，显示明确的降级提示文案。
- **AC-4**：`attribution` 角标在浅色/暗色/暗灰三套主题下均可读（对齐 AGENTS.md 关于三态主题可读性的既定要求）。

## 2. 技术方案

### 2.1 MVP 路径（FR-1）— 无代码改动，仅约定 payload 形状

Agent 侧调用顺序示例（写入 Sub-Plan E 的 Skill 文档，此处仅记录技术形状）：

```python
# 1. 取数
result = query_data_source(data_source_name="akshare", api_name="stock_price_history", params={"symbol": "603678"})
# 2. 渲染（Agent 自行把 result.data 编译成 ECharts option 字符串塞进 HTML）
show_widget(
    title="火炬电子（603678.SH）近120日走势",
    widget_code="""
    <div id="c" style="width:100%;height:340px"></div>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
    <script>
      const opt = {/* candlestick option built from result.data */};
      echarts.init(document.getElementById('c')).setOption(opt);
    </script>
    """,
)
```

风险点：Agent 手写 ECharts option 容易出错（字段映射、主题变量），因此 MVP 只作为「今天就能演示」的过渡路径，FR-2 才是稳定形态。

### 2.2 产品级路径（FR-2/3）

**Files:**
- Modify: `desktop/src/components/messages/widget-preview.ts`（`parseWidgetPayload` 增加对 `type: "stock_chart"` 的分支识别）
- Create: `desktop/src/components/messages/StockChartWidget.tsx`
- Modify: `desktop/src/components/messages/WidgetBlock.tsx`（顶层根据 `payload.kind === "stock_chart"` 路由到 `StockChartWidget`，否则走既有 SVG/HTML 分支）
- Modify: `agenticx/cli/agent_tools.py`（`_tool_show_widget` 放宽校验：`widget_code` 允许是以 `{"type":"stock_chart"` 开头的 JSON，而不仅是 `<svg` 或 HTML）

`widget-preview.ts` 新增类型与解析分支：

```typescript
export type StockChartSeriesPoint = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type StockChartPayload = {
  kind: "stock_chart";
  title: string;
  chartType: "candlestick" | "line";
  points: StockChartSeriesPoint[];
  attribution?: string;
};

export type WidgetPayload =
  | { title: string; widgetCode: string; loadingMessages: string[]; kind: "svg" | "html" }
  | StockChartPayload;

export function parseWidgetPayload(content: string): WidgetPayload | null {
  const raw = String(content ?? "").trim();
  if (!raw.startsWith("{") || !raw.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.type === "stock_chart") {
      const points = Array.isArray(parsed.points) ? (parsed.points as StockChartSeriesPoint[]) : [];
      if (points.length === 0) return null; // graceful degradation: caller falls back to warning UI
      return {
        kind: "stock_chart",
        title: typeof parsed.title === "string" ? parsed.title : "",
        chartType: parsed.chart_type === "line" ? "line" : "candlestick",
        points,
        attribution: typeof parsed.attribution === "string" ? parsed.attribution : undefined,
      };
    }
    // ... existing "widget" (svg/html) branch unchanged below
    if (parsed.type !== "widget") return null;
    // (existing implementation continues)
  } catch {
    return null;
  }
  return null;
}
```

`StockChartWidget.tsx`（骨架，用 ECharts 作为渲染引擎，因为项目已在 MVP 阶段验证 CDN 可用性；若希望离线可用可评估打包 `echarts` 为前端依赖而非 CDN——**实施者需在开工前二选一并记录决策**，推荐打包为 npm 依赖以避免用户断网时图表空白）：

```tsx
import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { StockChartPayload } from "./widget-preview";

type Props = { payload: StockChartPayload };

export function StockChartWidget({ payload }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    const dates = payload.points.map((p) => p.date);
    const option =
      payload.chartType === "candlestick"
        ? buildCandlestickOption(dates, payload.points)
        : buildLineOption(dates, payload.points);
    chart.setOption(option);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [payload]);

  return (
    <div className="w-full min-w-0 px-4">
      <div className="rounded border border-border bg-surface-card p-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[13px] font-medium text-text-strong">{payload.title}</span>
          {payload.attribution ? (
            <span className="text-[11px] text-text-muted">{payload.attribution}</span>
          ) : null}
        </div>
        <div ref={ref} style={{ width: "100%", height: 340 }} />
      </div>
    </div>
  );
}

function buildCandlestickOption(dates: string[], points: StockChartPayload["points"]) {
  return {
    xAxis: { type: "category", data: dates },
    yAxis: { type: "value", scale: true },
    series: [
      {
        type: "candlestick",
        data: points.map((p) => [p.open, p.close, p.low, p.high]),
        itemStyle: { color: "#ef4444", color0: "#22c55e", borderColor: "#ef4444", borderColor0: "#22c55e" },
      },
    ],
    tooltip: { trigger: "axis" },
  };
}

function buildLineOption(dates: string[], points: StockChartPayload["points"]) {
  return {
    xAxis: { type: "category", data: dates },
    yAxis: { type: "value" },
    series: [{ type: "line", data: points.map((p) => p.close), smooth: true }],
    tooltip: { trigger: "axis" },
  };
}
```

`_tool_show_widget` 校验放宽（`agenticx/cli/agent_tools.py`）：

```python
def _tool_show_widget(arguments: Dict[str, Any]) -> str:
    title = str(arguments.get("title") or "").strip()
    widget_code = str(arguments.get("widget_code") or "")
    raw_msgs = arguments.get("loading_messages")
    loading_messages = (
        [str(m).strip() for m in raw_msgs if str(m).strip()]
        if isinstance(raw_msgs, list)
        else []
    )
    if not widget_code.strip():
        return "ERROR: show_widget requires non-empty widget_code."
    stripped = widget_code.strip()
    if stripped.startswith("{") and '"type"' in stripped and '"stock_chart"' in stripped:
        # Structured stock-chart payload: pass through as-is (already valid JSON string).
        return stripped
    payload = {
        "type": "widget",
        "title": title,
        "widget_code": widget_code,
        "loading_messages": loading_messages,
    }
    return json.dumps(payload, ensure_ascii=False)
```

> 实施者注意：上面的字符串探测（`'"type"' in stripped`）是简化写法，实际实现应 `json.loads` 后判断 `type == "stock_chart"`，解析失败时按普通 widget 路径处理，避免 false positive。

## 3. 验收标准与用例

### 前端单测（新增 `desktop/src/components/messages/__tests__/stock-chart-widget-parse.test.ts`，若仓库已有 vitest/jest 配置则复用现有 runner）

```typescript
import { describe, expect, it } from "vitest";
import { parseWidgetPayload } from "../widget-preview";

describe("parseWidgetPayload stock_chart branch", () => {
  it("parses a valid stock_chart payload", () => {
    const raw = JSON.stringify({
      type: "stock_chart",
      title: "603678.SH",
      chart_type: "candlestick",
      points: [{ date: "2026-07-01", open: 80, high: 90, low: 78, close: 85 }],
      attribution: "数据来源：AkShare",
    });
    const parsed = parseWidgetPayload(raw);
    expect(parsed?.kind).toBe("stock_chart");
  });

  it("returns null (graceful degradation) when points are missing", () => {
    const raw = JSON.stringify({ type: "stock_chart", title: "x", points: [] });
    expect(parseWidgetPayload(raw)).toBeNull();
  });
});
```

> 实施者需先确认仓库前端测试框架（vitest vs jest）与已有测试文件放置惯例，对齐后再落地路径。

### 人工用例

| 用例 | 步骤 | 预期 |
|---|---|---|
| UC-1 | 走 MVP 路径（FR-1）问「画一下火炬电子K线」 | ECharts HTML 在暗色主题下正常显示蜡烛图 |
| UC-2 | 走产品级路径，Agent 直接输出 `stock_chart` payload | `StockChartWidget` 渲染，含红涨绿跌配色与来源角标 |
| UC-3 | 故意构造缺字段的 `stock_chart` payload | 显示降级警告文案而非白屏或报错 |
| UC-4 | 切换深色/浅色/暗灰主题 | 图表背景与来源角标文字始终可读 |

## 4. 风险与资源排期

| 风险 | 影响 | 缓解 |
|---|---|---|
| ECharts 走 CDN 在断网环境下图表空白 | 影响离线/内网部署场景 | 产品级路径（FR-2）评估把 `echarts` 打包为 Desktop npm 依赖而非 CDN，MVP 路径（FR-1）保持 CDN 仅作为过渡演示 |
| Agent 手写 ECharts option（MVP 路径）出错率高 | 演示效果不稳定 | MVP 仅作为 Sub-Plan B/C 完成前的临时验证手段，产品级路径尽快替换 |
| `_tool_show_widget` 的字符串探测逻辑 false positive/negative | 正常 SVG 被误判或结构化 payload 被误判为普通 widget | 用严格 `json.loads` + `type` 字段判断，禁止用子串匹配做最终判断（示例代码中已标注为「简化写法」） |
| 大数据量（如年线跨度）渲染卡顿 | 图表交互体验差 | NFR-2 降采样/滚动条，超过阈值时默认收窄到最近 N 条并提示「已收起早期数据」 |

**预估工作量**：2 人天（MVP 路径 0.2 天验证 + 产品级组件 1.3 天 + 测试联调 0.5 天）。
**前置条件**：Sub-Plan B（拿到真实 `stock_price_history` 数据形状）、Sub-Plan C（主题变量与 Tab 已就位，非硬阻塞但建议顺序开发）。
**产出物**：`StockChartWidget.tsx`、`widget-preview.ts` 扩展、`_tool_show_widget` 放宽校验、前端单测。
