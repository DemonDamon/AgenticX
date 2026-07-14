# Near show_widget 自动布局与防重叠

Planned-with: GPT-5.6 Sol
Suggested-Impl-Model: gpt-5.6-sol-medium

> **Goal**：让 Near 生成流程图、架构图、链路图和时序图时默认走 Mermaid 自动布局，避免模型手写 SVG 绝对坐标导致节点与文字大面积重叠；保留 SVG、HTML 和 `stock_chart` 的既有能力与兼容性。

> **Architecture**：在 `show_widget` 协议中新增可选 `widget_format`，取值为 `svg | html | mermaid`。流程/架构/时序类图默认传 Mermaid 源码，Desktop 复用现有 `MermaidBlock` 渲染；未声明格式的历史消息继续按现有前缀推断。手写 SVG 仍用于 Mermaid 无法表达的自由矢量图，不引入启发式碰撞搬移或自动重试。

> **Tech Stack**：Python tool schema / prompt、React 18、TypeScript strict、Mermaid 11、Vitest、pytest、Electron PDF 导出。

> **For implementer**：按 TDD 顺序实施。不要修改 `agenticx/studio/server.py`、SSE 事件协议、`agent_runtime.py` 或现有渐进 SVG 节流链路。本计划以 Composer 2.5 可脱离对话独立实施为最低标准。

---

## 1. 结论：Composer 2.5 的分析哪些对，哪些需修正

### 1.1 正确结论

1. **主因确实是模型手写 SVG 坐标错误。**
   - `agenticx/cli/agent_tools.py::_tool_show_widget()` 只做非空校验和 JSON 包装，不计算布局。
   - `desktop/src/components/messages/WidgetBlock.tsx::fitSvgViewBoxToContent()` 只扩大 `viewBox` 以避免裁切，不会移动 `<rect>`、`<text>` 或 `<foreignObject>`。
   - 截图中不同颜色的框体本身已经相交，证明错误存在于 SVG 内部坐标，而不是文字渲染层单独错位。

2. **前端等比缩放不是主要原因。**
   - `SvgWidget` 使用相同宽高比例缩放整个 SVG。统一缩放不会改变元素之间的相对位置，因此不能把原本分离的节点变成相交节点。

3. **流式预览可能让中间帧更乱，但不能解释完成态持续重叠。**
   - `show-widget-partial.ts::finalizePartialSvg()` 会给半截 SVG 临时补 `</svg>`。
   - `WidgetBlock.tsx::SvgWidget()` 在 `streaming=true` 时跳过最终 `getBBox()` 适配。
   - 这些行为会造成绘制中的缺元素或裁切，但最终 `tool_result` 到达后仍重叠，根因仍是最终 SVG 源码。

4. **Mermaid 自动布局是比继续堆 prompt 更对症的主方案。**
   - 仓库已有 `desktop/src/components/messages/MermaidBlock.tsx`，包含 Mermaid 渲染、主题、缩放、平移、源码复制和 PNG 下载。
   - 对流程图、架构图、链路图和时序图而言，交给 Mermaid 布局比让 LLM 计算绝对坐标稳定。

### 1.2 需要修正或补充的地方

1. **“Mermaid 一定不重叠”不能作为保证。**
   - Mermaid 可以避免大多数节点矩形碰撞，但过长标签、过多跨层边、错误语法仍可能造成拥挤或渲染失败。
   - Prompt 仍需约束短标签、合理方向和必要的 `<br/>` 换行。

2. **不能只在 `WidgetBlock` 里识别 Mermaid 前缀。**
   - `show_widget` 当前还支持任意 HTML；仅凭 `flowchart` 等前缀猜测会产生协议歧义。
   - 应新增显式 `widget_format`，同时保留缺省推断以兼容历史数据。

3. **直接复用 `MermaidBlock` 还不够，必须处理 PDF 导出。**
   - 当前 `export-pdf-html.ts::widgetBlockHtml()` 只会把原始 SVG 内联到 PDF。
   - Mermaid payload 存的是源码，不先渲染为 SVG就只能导出占位文字，会倒退“show_widget 图必须进入 PDF”的既有能力。

4. **不建议把碰撞检测 + 自动搬移作为本期方案。**
   - `getBBox()` 交集只能发现部分问题，无法可靠判断“合法覆盖”“连线穿越”“标签属于哪个节点”。
   - 自动移动元素还必须同步改连线、箭头、分组和 viewBox，实质上是在重新实现图布局引擎。

---

## 2. 方案比较与最终选择

| 方案 | 收益 | 成本 / 风险 | 结论 |
|---|---|---|---|
| A. 只加强 SVG prompt | 改动极小 | 现有 prompt 已有防叠字规范，复杂图仍依赖模型算坐标 | 仅作辅助 |
| B. `show_widget` 显式支持 Mermaid | 从源头移除流程图绝对坐标计算；复用现有依赖 | 需扩展协议、流式状态和 PDF 导出 | **本期主方案** |
| C. SVG 碰撞检测后自动重试 | 可发现部分坏图 | 误报、额外模型轮次、流式误判、无法可靠修图 | 本期不做 |
| D. 引入 ELK/Dagre 自定义 JSON 图协议 | 可完全控制布局和样式 | 新协议、编辑器、渲染器及迁移成本明显过高 | YAGNI |

最终采用 **B + A**：

- 流程、架构、链路、时序：`widget_format="mermaid"`。
- 自由矢量插图、特殊视觉编码：`widget_format="svg"`。
- 交互与通用数据可视化：`widget_format="html"`。
- 股票 / 宏观时间序列：继续使用现有结构化 `stock_chart`。

---

## 3. In scope / Out of scope

### In scope

- 扩展 `show_widget` tool schema 和返回 payload，增加可选 `widget_format`。
- Meta-Agent prompt 改为流程类图 Mermaid-first。
- Desktop payload 解析新增 `kind: "mermaid"`。
- `WidgetBlock` 复用 `MermaidBlock` 渲染 Mermaid widget。
- Mermaid 流式参数阶段显示稳定的“正在编排图表…”状态，完整 tool result 到达后一次渲染。
- PDF 导出前将 Mermaid 源码渲染为静态 SVG，避免图表丢失。
- 补 Python 与 TypeScript 单测。

### Out of scope / no-scope-creep

- 不修改 `agenticx/studio/server.py`。
- 不修改 `agenticx/runtime/agent_runtime.py`、`EventType`、SSE 格式或节流常量。
- 不重写 `MermaidBlock` 的交互 UI。
- 不给任意 SVG 做自动碰撞搬移、自动缩短文本或 silent retry。
- 不引入 ELK、Dagre 或新的 npm 依赖；继续使用已安装的 `mermaid`。
- 不改变 HTML widget、`stock_chart` 和历史 SVG widget 的现有展示。
- 不顺手调整 Near 其它 Markdown Mermaid、表格、消息气泡或导出样式。

---

## 4. 协议设计

### 4.1 Tool 入参

修改 `agenticx/cli/agent_tools.py` 中 `STUDIO_TOOLS` 的 `show_widget` schema，在 `widget_code` 后增加：

```python
"widget_format": {
    "type": "string",
    "enum": ["svg", "html", "mermaid"],
    "description": (
        "Explicit widget source format. Use mermaid for flowcharts, "
        "architecture, pipelines, and sequence diagrams; svg for custom "
        "free-form vector graphics; html for interactive widgets."
    ),
},
```

保持 `required` 为 `["title", "widget_code"]`，即该字段可选，兼容旧模型和旧调用。

### 4.2 Tool result

普通 widget 返回：

```json
{
  "type": "widget",
  "title": "任务执行链路",
  "widget_format": "mermaid",
  "widget_code": "flowchart LR\n  A[请求] --> B[路由]\n  B --> C[执行]",
  "loading_messages": []
}
```

兼容规则：

1. `widget_format` 为 `mermaid | svg | html` 时原样写入 payload。
2. `widget_format` 缺失时，后端不强行补值；前端继续按当前逻辑推断 `<svg` 为 SVG，其余为 HTML。
3. 现有 `stock_chart` 特判保持在普通 widget 包装之前，返回形状不变。
4. 非法 `widget_format` 不应静默降级，返回：

```text
ERROR: show_widget widget_format must be one of: svg, html, mermaid.
```

### 4.3 Desktop 类型

`desktop/src/components/messages/widget-preview.ts`：

```ts
export type HtmlWidgetPayload = {
  title: string;
  widgetCode: string;
  loadingMessages: string[];
  kind: "svg" | "html" | "mermaid";
};
```

解析优先级：

```ts
function widgetKind(
  widgetCode: string,
  declaredFormat: unknown,
): "svg" | "html" | "mermaid" {
  if (
    declaredFormat === "svg" ||
    declaredFormat === "html" ||
    declaredFormat === "mermaid"
  ) {
    return declaredFormat;
  }
  return widgetCode.trimStart().toLowerCase().startsWith("<svg")
    ? "svg"
    : "html";
}
```

禁止在未声明格式时根据 `flowchart`、`graph` 等文本前缀自动猜 Mermaid，避免把普通 HTML / 文本 widget 错判。

---

## 5. 子规划与推荐实施模型

| 子任务 | 推荐模型 | 理由 |
|---|---|---|
| T1 Python 协议 + prompt | composer-2.5-fast | schema、透传和文案测试边界明确 |
| T2 Desktop payload + 流式状态 | composer-2.5-fast | 纯解析与分支接线，测试可直接约束 |
| T3 Mermaid renderer 复用 + PDF 异步导出 | gpt-5.6-sol-medium | 涉及 React 生命周期、Mermaid 全局初始化和同步 API 改异步，回归风险较高 |
| T4 全链路验收 | gpt-5.6-sol-medium | 需同时核对历史兼容、主题、导出和真实模型行为 |

整体实施建议使用 `gpt-5.6-sol-medium`；若拆分执行，T1/T2 可用 Composer 2.5 降低成本。

---

## 6. 实施任务

### Task 1：先用测试锁定后端协议

**Files**

- Modify: `tests/test_smoke_show_widget_stock_chart.py`
- Modify: `agenticx/cli/agent_tools.py`

**Step 1：写失败测试**

在 `tests/test_smoke_show_widget_stock_chart.py` 追加：

```python
def test_show_widget_preserves_declared_mermaid_format():
    result = _tool_show_widget(
        {
            "title": "流程",
            "widget_format": "mermaid",
            "widget_code": "flowchart LR\n  A --> B",
        }
    )
    parsed = json.loads(result)
    assert parsed["type"] == "widget"
    assert parsed["widget_format"] == "mermaid"
    assert parsed["widget_code"].startswith("flowchart")


def test_show_widget_rejects_unknown_widget_format():
    result = _tool_show_widget(
        {
            "title": "流程",
            "widget_format": "canvas",
            "widget_code": "anything",
        }
    )
    assert result == (
        "ERROR: show_widget widget_format must be one of: svg, html, mermaid."
    )


def test_show_widget_keeps_legacy_payload_without_format():
    result = _tool_show_widget(
        {"title": "legacy", "widget_code": "<svg viewBox='0 0 10 10'></svg>"}
    )
    parsed = json.loads(result)
    assert "widget_format" not in parsed
```

**Step 2：验证测试先失败**

```bash
pytest -q tests/test_smoke_show_widget_stock_chart.py
```

Expected：Mermaid format 测试因 payload 缺字段失败；非法 format 测试失败。

**Step 3：最小实现**

在 `agenticx/cli/agent_tools.py::_tool_show_widget()` 中：

1. 在 `widget_code` 非空检查之后读取：

```python
widget_format_raw = arguments.get("widget_format")
widget_format = (
    str(widget_format_raw).strip().lower()
    if widget_format_raw is not None
    else ""
)
```

2. 若非空且不在 `{"svg", "html", "mermaid"}`，返回明确 `ERROR:`。
3. 构造普通 `payload` 后，仅在 `widget_format` 非空时写入：

```python
if widget_format:
    payload["widget_format"] = widget_format
```

4. 不改变 `_looks_like_stock_chart_payload()` 和 stock chart 提前返回路径。
5. 在 show_widget tool schema 中加入可选 `widget_format`；同步修改工具 description，删除 “NEVER ... mermaid source”，改为“流程/架构/时序优先 Mermaid source，不要加 Markdown fence”。

**Step 4：验证**

```bash
pytest -q tests/test_smoke_show_widget_stock_chart.py
```

Expected：全部通过。

---

### Task 2：把系统纪律改成 Mermaid-first，而不是继续要求手写 SVG

**Files**

- Modify: `agenticx/runtime/prompts/meta_agent.py::_build_widget_capability_block`
- Modify: `tests/test_smoke_show_widget_prompt.py`

**Step 1：写失败测试**

追加断言：

```python
def test_widget_capability_block_prefers_mermaid_for_connected_diagrams() -> None:
    block = _build_widget_capability_block()
    assert 'widget_format="mermaid"' in block
    assert "流程图、架构图、链路图、时序图" in block
    assert "不要包 Markdown 代码围栏" in block
    assert "短标签" in block
    assert 'widget_format="svg"' in block
```

**Step 2：验证先失败**

```bash
pytest -q tests/test_smoke_show_widget_prompt.py
```

**Step 3：精确修改 prompt**

修改 `_build_widget_capability_block()` 的以下锚点：

- 将“SVG vs HTML”改为“格式选择”：
  - 流程图、架构图、链路图、时序图：`widget_format="mermaid"`。
  - 自由矢量插图或 Mermaid 无法表达的特殊几何：`widget_format="svg"`。
  - 交互图：`widget_format="html"`。
- 将“静态示意、流程图、架构图 → 手写 SVG”替换为 Mermaid-first。
- 保留 SVG 尺寸、防裁切规范，但明确它只约束 `widget_format="svg"`。
- Mermaid 规范写全：
  - `widget_code` 直接从 `flowchart`、`sequenceDiagram` 等声明开始；
  - 不要包 ```` ```mermaid ```` 代码围栏；
  - 每个节点优先使用短标签；
  - 长标签拆成 `<br/>`，不要塞完整段落；
  - 根据结构选择 `TB` 或 `LR`，避免为了横向展示塞入过多同层节点；
  - 不在 Mermaid 中写大段自定义 HTML/CSS。

**Step 4：验证**

```bash
pytest -q tests/test_smoke_show_widget_prompt.py
```

Expected：全部通过，原有“禁止文字流程图”和“可见衔接语”测试不回归。

---

### Task 3：扩展 Desktop payload 解析

**Files**

- Modify: `desktop/src/components/messages/widget-preview.ts`
- Create: `desktop/src/components/messages/widget-preview-format.test.ts`

**Step 1：写失败测试**

覆盖以下用例：

1. `widget_format: "mermaid"` 返回 `kind: "mermaid"`。
2. 显式 `widget_format: "svg"` 优先于源码前缀。
3. 显式 `widget_format: "html"` 返回 HTML。
4. 无格式 + `<svg` 仍返回 SVG。
5. 无格式 + `<div>` 仍返回 HTML。
6. 未知格式不采用未知值，回退到历史推断。
7. `stock_chart` 解析不受影响。

核心断言示例：

```ts
const payload = parseWidgetPayload(JSON.stringify({
  type: "widget",
  title: "流程",
  widget_format: "mermaid",
  widget_code: "flowchart LR\n  A --> B",
}));
expect(payload?.kind).toBe("mermaid");
```

**Step 2：验证先失败**

```bash
cd desktop
npx vitest run src/components/messages/widget-preview-format.test.ts
```

**Step 3：最小实现**

- 将 `HtmlWidgetPayload.kind` 扩为 `"svg" | "html" | "mermaid"`。
- 修改 `widgetKind(widgetCode, declaredFormat)`，采用第 4.3 节的显式优先、旧逻辑兜底。
- `parseWidgetPayload()` 返回普通 widget 时调用：

```ts
kind: widgetKind(widgetCode, parsed.widget_format),
```

- 不改 stock chart 解析路径和 `isShowWidgetToolMessage()`。

**Step 4：验证**

```bash
npx vitest run \
  src/components/messages/widget-preview-format.test.ts \
  src/components/messages/stock-chart-widget-parse.test.ts
```

Expected：全部通过。

---

### Task 4：让流式 show_widget 识别声明格式，但不增量解析半截 Mermaid

**Files**

- Modify: `desktop/src/components/messages/show-widget-partial.ts`
- Modify: `desktop/src/components/messages/show-widget-partial.test.ts`
- Modify: `desktop/src/components/messages/ToolCallCard.tsx`

**Step 1：扩展部分参数类型**

```ts
export type PartialShowWidget = {
  title: string;
  widgetCode: string;
  widgetFormat: "svg" | "html" | "mermaid" | "";
  readyForPreview: boolean;
};
```

解析 `"widget_format"` 的完整 JSON string；字段尚未完整时返回空字符串。

**Step 2：定义流式策略**

- 只有 `widgetFormat !== "mermaid"` 且源码已包含 `<svg` 时，`readyForPreview=true`。
- Mermaid 在工具参数流式阶段不调用 `mermaid.render()`，避免每 100–120ms 对半截语法重复解析和闪烁。
- `ToolCallCard` 在 `showWidgetPartial.widgetFormat === "mermaid"` 且状态为 running/pending 时显示：

```text
流程 · 正在编排图表…
```

- 最终 `tool_result` 到达后仍走 `widgetPayload` 完成态分支。
- 现有 SVG 渐进预览、`longestShowWidgetPartialRef` 和 `finalizePartialSvg()` 完全保留。

**Step 3：测试**

在 `show-widget-partial.test.ts` 增加：

- 完整 `widget_format:"mermaid"` 能解析。
- Mermaid 源码即使以 `flowchart` 开头，`readyForPreview` 仍为 false。
- 旧 SVG 参数无 `widget_format` 时仍 `readyForPreview=true`。
- 部分 JSON 尚未出现 format 时保持空字符串。

运行：

```bash
npx vitest run src/components/messages/show-widget-partial.test.ts
```

Expected：全部通过。

---

### Task 5：抽取共享 Mermaid 渲染器并接入 WidgetBlock

**Files**

- Create: `desktop/src/utils/mermaid-render.ts`
- Create: `desktop/src/utils/mermaid-render.test.ts`
- Modify: `desktop/src/components/messages/MermaidBlock.tsx`
- Modify: `desktop/src/components/messages/WidgetBlock.tsx`

**Step 1：创建共享渲染器**

把 `MermaidBlock` 中 `mermaid.initialize()` + `mermaid.render()` 的调用抽到顶层 import 使用的工具文件，禁止 inline import：

```ts
import mermaid from "mermaid";

export type MermaidRenderTheme = "dark" | "default";

export async function renderMermaidSvg(args: {
  code: string;
  id: string;
  theme: MermaidRenderTheme;
}): Promise<string> {
  const code = args.code.trim();
  if (!code) throw new Error("Mermaid source is empty.");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: args.theme,
  });
  const { svg } = await mermaid.render(args.id, code);
  return svg;
}

export function mermaidThemeFromApp(
  appTheme: string,
): MermaidRenderTheme {
  return appTheme === "light" ? "default" : "dark";
}
```

`MermaidBlock.tsx` 改为调用该 helper，现有 loading、failed、缩放、平移、复制和 PNG 下载行为保持不变。

**Step 2：测试共享 helper**

在 `mermaid-render.test.ts` 使用 `vi.mock("mermaid", ...)`：

- 验证初始化参数固定为 `startOnLoad:false`、`securityLevel:"strict"`。
- 验证传入的 `theme` 和唯一 `id`。
- 验证返回 mock SVG。
- 空源码抛出明确错误。
- `light -> default`，`dark/dim -> dark`。

**Step 3：WidgetBlock 增加 Mermaid 分支**

在 `WidgetBlock()` 的 `stock_chart` 分支之后、SVG helper 定义之前增加：

```tsx
if (payload.kind === "mermaid") {
  return <MermaidBlock code={payload.widgetCode} />;
}
```

顶部静态 import：

```ts
import { MermaidBlock } from "./MermaidBlock";
```

不要给 Mermaid 外面再套 SVG 的 `WidgetMenu`，因为 `MermaidBlock` 已包含源码复制、PNG 下载、缩放和平移工具。

**Step 4：验证**

```bash
npx vitest run \
  src/utils/mermaid-render.test.ts \
  src/components/messages/widget-preview-format.test.ts
npm run build
```

Expected：测试通过，TypeScript 与 Vite build 通过。

---

### Task 6：保持 PDF 导出包含 Mermaid 图

**Files**

- Modify: `desktop/src/utils/export-pdf-html.ts`
- Modify: `desktop/src/utils/export-pdf-html.test.ts`
- Modify: `desktop/src/components/ChatPane.tsx::exportSelectedMessagesToPdf`

**根因**

`widgetBlockHtml()` 当前同步返回字符串。Mermaid payload 只有源码，必须先异步调用 `renderMermaidSvg()` 得到静态 SVG。

**Step 1：写失败测试**

Mock `renderMermaidSvg()` 返回：

```html
<svg viewBox="0 0 100 40"><text>rendered mermaid</text></svg>
```

新增测试：

- Mermaid widget 的导出 HTML 包含标题和渲染后的 `<svg>`。
- 不把 `flowchart LR` 原始源码直接写进 PDF body。
- Mermaid 渲染失败时输出明确占位：

```text
[图表：任务执行链路]（Mermaid 静态渲染失败，请在应用内查看）
```

- 现有 SVG widget 仍原样内联。

**Step 2：将导出构造改为异步**

精确修改：

```ts
async function widgetBlockHtml(message: Message): Promise<string>

export async function buildMessagesPdfHtml(args: {
  ...
}): Promise<string>
```

将：

```ts
const rendered = exportable.map(...)
```

改为：

```ts
const rendered = (
  await Promise.all(
    exportable.map(async (message) => {
      ...
      const body = isWidget
        ? await widgetBlockHtml(message)
        : messageBodyHtml(message);
      ...
    }),
  )
).filter((block): block is string => Boolean(block));
```

Mermaid 分支：

```ts
if (payload.kind === "mermaid") {
  try {
    const svg = await renderMermaidSvg({
      code: payload.widgetCode,
      id: `pdf-mermaid-${stableUniqueSuffix}`,
      theme: mermaidThemeFromApp(appTheme),
    });
    return `${title}<div class="widget-graphic">${svg}</div>`;
  } catch {
    return `${title}<div class="widget-fallback">...</div>`;
  }
}
```

要求：

- `buildMessagesPdfHtml` 参数增加可选 `appTheme?: string`，默认 `"dark"`，便于测试及非 DOM 调用。
- Mermaid render id 必须在同一次导出内唯一，可使用消息 id 经安全字符归一化后加 map index；禁止固定 id。
- SVG / HTML / stock chart 原分支语义不变。

**Step 3：更新调用方**

`ChatPane.tsx::exportSelectedMessagesToPdf()` 已是 async，只需：

```ts
const html = await buildMessagesPdfHtml({
  ...,
  appTheme: document.documentElement.getAttribute("data-theme") || "dark",
});
```

将 `export-pdf-html.test.ts` 中所有 `buildMessagesPdfHtml()` 调用改为 `await`，对应 `it()` 回调改为 `async`。

**Step 4：验证**

```bash
npx vitest run src/utils/export-pdf-html.test.ts
npm run build
```

Expected：全部通过；现有“show_widget graphic cannot be omitted”断言继续成立。

---

### Task 7：全链路回归与人工验收

**Automated verification**

仓库根目录：

```bash
pytest -q \
  tests/test_smoke_show_widget_stock_chart.py \
  tests/test_smoke_show_widget_prompt.py \
  tests/test_show_widget_delta_emit.py \
  tests/test_smoke_widget_flow_guard.py
```

Desktop：

```bash
cd desktop
npx vitest run \
  src/components/messages/widget-preview-format.test.ts \
  src/components/messages/show-widget-partial.test.ts \
  src/components/messages/stock-chart-widget-parse.test.ts \
  src/utils/mermaid-render.test.ts \
  src/utils/export-pdf-html.test.ts
npm run build
```

**Manual acceptance**

使用同一个真实 Near 会话依次执行：

1. “画出一个包含 8 个节点、3 层、两条跨层连线的任务执行架构图。”
   - 工具参数应为 `widget_format: "mermaid"`。
   - `widget_code` 应从 `flowchart` 开始，不含 Markdown 围栏。
   - 完成态节点矩形不得像原截图那样互相覆盖。

2. “画一个登录鉴权 sequenceDiagram。”
   - 使用 Mermaid sequence diagram。
   - 中文标签可读，参与者不互相覆盖。

3. “画一个需要自由曲线和自定义几何的品牌矢量图。”
   - 允许显式走 SVG，不应被强制改成 Mermaid。

4. 打开一条历史 SVG show_widget。
   - 无 `widget_format` 仍按 SVG 渲染。
   - 渐进 SVG 预览仍可用。

5. 生成 HTML widget 和 `stock_chart`。
   - 展示行为与改动前一致。

6. 将包含 Mermaid widget 的完整轮次导出 PDF。
   - PDF 中出现静态图，不是 Mermaid 源码或空白占位。

7. 切换 dark / dim / light。
   - Mermaid 使用对应主题，文字和连线在三种主题下可读。

---

## 7. FR / NFR / AC

### FR-1：显式格式协议

- `show_widget` 接受可选 `widget_format: svg | html | mermaid`。
- 非法值明确报错。
- 缺省值保持历史推断，不迁移旧消息。

### FR-2：流程类图自动布局

- Meta-Agent 对流程图、架构图、链路图、时序图默认生成 Mermaid。
- Mermaid 源码必须通过 `show_widget` 展示，不退化成正文 Markdown 代码块。
- SVG 仍保留为特殊自由矢量图路径。

### FR-3：稳定渲染

- Desktop 解析显式 Mermaid kind 并复用 `MermaidBlock`。
- 半截 Mermaid 不做渐进语法渲染，避免解析闪烁。
- Mermaid 完成态支持缩放、平移、复制源码、PNG 下载和失败回退。

### FR-4：导出完整性

- PDF 导出将 Mermaid 源码转为静态 SVG。
- Mermaid 单图渲染失败不阻断整份 PDF，其位置显示明确占位。

### NFR-1：兼容性

- 旧 SVG / HTML widget 无需改数据。
- `stock_chart` 协议和展示不变。
- 不改变 SSE 事件和持久化消息结构的既有字段。

### NFR-2：安全

- Mermaid 保持 `securityLevel: "strict"`。
- 不允许 Mermaid 分支退化为不受控 HTML 注入。
- 所有 TypeScript 保持 strict，不新增 `any`。

### Acceptance Criteria

- **AC-1**：Python 协议测试覆盖 Mermaid、非法格式、legacy 缺省和 stock chart 回归。
- **AC-2**：前端 parser 测试覆盖三种显式 format 与旧推断。
- **AC-3**：真实 8 节点流程图完成态无节点框体互相覆盖。
- **AC-4**：Mermaid 流式阶段无反复错误闪烁，完成后一次稳定渲染。
- **AC-5**：旧 SVG 渐进预览不回归。
- **AC-6**：PDF 中包含 Mermaid 静态 SVG。
- **AC-7**：dark / dim / light 三主题可读。
- **AC-8**：指定 pytest、vitest 与 `npm run build` 全绿。

---

## 8. 风险与缓解

1. **Mermaid 标签过长仍拥挤**
   - Prompt 强制短标签和 `<br/>`。
   - 人工 AC 使用中文长短混合标签。

2. **Mermaid 全局 `initialize()` 在并行导出时互相覆盖主题**
   - 单次导出固定一个 `appTheme`。
   - `Promise.all` 中若并行 render 暴露全局状态问题，改为导出函数内顺序 `for...of await`，不要引入锁或新依赖。

3. **同步 PDF builder 改 async 影响调用**
   - 全仓当前只有 `ChatPane.tsx` 一个生产调用点。
   - 所有测试调用统一改为 `await`。

4. **老客户端不认识 `widget_format`**
   - Near Desktop 当前绑定本地后端，同版本交付。
   - 历史数据和新客户端兼容是强制目标；跨版本远程 backend 不在当前产品能力范围。

5. **Mermaid 语法错误**
   - `MermaidBlock` 已有失败态和源码复制。
   - PDF 只对单图降级占位，不中断整份导出。

---

## 9. 建议提交粒度

1. `feat(widget): add explicit Mermaid widget format`
   - Python schema / helper / prompt / Python tests。

2. `feat(desktop): render Mermaid show_widget payloads`
   - parser、partial state、共享 renderer、WidgetBlock、前端测试。

3. `fix(desktop): preserve Mermaid widgets in PDF exports`
   - async PDF builder、ChatPane 调用、导出测试。

每个 commit 仅暂存本计划直接涉及的文件，并按仓库规则写 trailers：

```text
Plan-Id: 2026-07-14-near-show-widget-mermaid-layout
Plan-File: .cursor/plans/2026-07-14-near-show-widget-mermaid-layout.plan.md
Plan-Model: GPT-5.6 Sol
Impl-Model: <由用户确认的实际实施模型>
Made-with: Damon Li
```

禁止编造 `Impl-Model`，禁止把无关工作区改动带入提交。
