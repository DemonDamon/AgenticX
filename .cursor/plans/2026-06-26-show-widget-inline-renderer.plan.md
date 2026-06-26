# Near `show_widget` 内联可视化渲染能力

Planned-with: claude-opus-4.8

> 实施提示（给执行模型）：本 plan 已给出**精确文件路径 + 行号锚点 + 可照抄的现有范式**。所有新代码必须模仿仓库内已存在的同类范式（见每个任务的「参照范式」），不要自创风格。Python 文件头必须有 `Author: Damon Li`、注释/docstring 全英文、禁止相对 import（见 `.cursor/rules/google-python-style.mdc`）。前端用 TypeScript strict，禁止 `any`。

---

## 目标

为 Near Desktop 实现与 WorkBuddy 同等的 `show_widget` 能力：AI 可在聊天里直接渲染 **SVG 矢量图** 或 **HTML+JS 交互组件**（柱状图、流程图等），CSS 变量继承当前主题，HTML 模式下 CDN 脚本在 sandbox iframe 内受 CSP 约束执行。

非目标（本期不做）：服务端渲染、把 widget 导出为图片/PNG、widget 与宿主双向 RPC（`sendPrompt` 回调）。这些列为「未来扩展」。

---

## 核心实现范式（最重要 — 先读这一节）

Near 已有一个**和本需求几乎同构**的现成范式：`skill_manage` 工具返回一段 JSON 字符串 → 落到 `message.content` → 前端在 `ToolCallCard` 的展开详情区 `detailBody` 内解析并渲染自定义卡片 `SkillPatchPreviewCard`。

`show_widget` **完全复用这条链路**，不要新发明：

```
模型调用 show_widget(title, widget_code, loading_messages)
    ↓
agenticx/cli/agent_tools.py：dispatch 直接返回 JSON 字符串
    （形如 {"type":"widget","title":...,"widget_code":...,"loading_messages":[...]}）
    ↓
该字符串作为 tool_result 经 SSE 落到前端 message.content（与 skill_manage 完全一致）
    ↓
ToolCallCard 内：parseWidgetPayload(message.content) 解析成功
    → 在 detailBody 渲染 <WidgetBlock>（替代原始 JSON 文本展示）
    ↓
WidgetBlock：SVG 走 innerHTML 注入；HTML 走 <iframe srcdoc sandbox>
```

要照抄的两个现成文件：
- 解析器范式：`desktop/src/components/messages/skill-manage-preview.ts`（`parseSkillPatchPreviewPayload`）
- 卡片渲染 + 在 ToolCallCard 内接线：`desktop/src/components/messages/SkillPatchPreviewCard.tsx` + `ToolCallCard.tsx` 第 160-167 行（`skillPreviewPayload` useMemo）、第 202-208 行（detailBody 内条件渲染）

**因此原计划里「在 ImBubble 单独接线 WidgetBlock」是多余的 — 渲染全部发生在 ToolCallCard 内部，删除该任务。**

---

## WorkBuddy 接口对齐（工具参数）

| 参数 | 类型 | 说明 |
|------|------|------|
| `title` | string（必填） | 图表标题，前端用作 ToolCallCard 标题 |
| `widget_code` | string（必填） | SVG 字符串（`<svg ...>`）或 HTML 片段（可含 `<style>`/`<script>`） |
| `loading_messages` | string[]（可选） | 渲染前轮播的加载提示 |

HTML 模式 CDN 白名单（写进 CSP 的 `script-src`）：
`cdnjs.cloudflare.com`、`esm.sh`、`cdn.jsdelivr.net`、`unpkg.com`

---

## 任务拆解

### P0 — 后端工具注册（agenticx/cli/agent_tools.py）

**T1: 注册 `show_widget` 到 `STUDIO_TOOLS`**
- 文件：`agenticx/cli/agent_tools.py`
- 位置：在 `STUDIO_TOOLS`（`List[Dict[str, Any]]`，约第 291 行起）内追加一个 tool dict。参照范式：紧邻的 `session_search`（约第 979-1006 行）或 `liteparse`（约第 1023-1043 行）的写法。
- schema：
  ```python
  {
      "type": "function",
      "function": {
          "name": "show_widget",
          "description": (
              "Render an inline visualization widget in the chat. "
              "Pass hand-written SVG (vector diagrams, flow charts) or an HTML "
              "fragment (with <style>/<script>, may load Chart.js/D3 from the CDN "
              "allowlist). Use SVG for static diagrams; use HTML for interactive "
              "or data-driven charts. The widget inherits the chat theme CSS vars."
          ),
          "parameters": {
              "type": "object",
              "properties": {
                  "title": {"type": "string", "description": "Widget title shown on the card."},
                  "widget_code": {
                      "type": "string",
                      "description": (
                          "SVG string starting with '<svg' OR an HTML fragment. "
                          "SVG should use viewBox='0 0 680 H' width='100%' and "
                          "CSS vars like var(--font-sans), var(--color-text-primary)."
                      ),
                  },
                  "loading_messages": {
                      "type": "array",
                      "items": {"type": "string"},
                      "description": "Optional rotating loading messages shown before render.",
                  },
              },
              "required": ["title", "widget_code"],
              "additionalProperties": False,
          },
      },
  }
  ```

**T2: 标记为并发安全**
- 文件：同上，`_CONCURRENCY_SAFE_STUDIO_TOOLS = frozenset(...)`（约第 115 行）
- 把 `"show_widget"` 加入该 frozenset（它无副作用，纯透传）。

**T3: dispatch 透传处理**
- 文件：同上，`dispatch_tool_async`（约第 5851 行起）。参照范式：`if name == "session_search":`（约第 6001 行）这类分支。
- 新增分支（放在其它 `if name == ...` 同级），实现一个模块级 helper 并调用：
  ```python
  if name == "show_widget":
      return _tool_show_widget(arguments)
  ```
- helper（放在文件内其它 `_tool_*` 同步函数附近，如 `_tool_session_search` 旁）：
  ```python
  def _tool_show_widget(arguments: Dict[str, Any]) -> str:
      """Return a widget payload JSON consumed by the Desktop ToolCallCard.

      The backend does no rendering; it validates and passes the widget code
      through to the frontend as a structured JSON string.
      """
      title = str(arguments.get("title") or "").strip()
      widget_code = str(arguments.get("widget_code") or "")
      raw_msgs = arguments.get("loading_messages")
      loading_messages = [
          str(m).strip() for m in raw_msgs if str(m).strip()
      ] if isinstance(raw_msgs, list) else []
      if not widget_code.strip():
          return "ERROR: show_widget requires non-empty widget_code."
      payload = {
          "type": "widget",
          "title": title,
          "widget_code": widget_code,
          "loading_messages": loading_messages,
      }
      return json.dumps(payload, ensure_ascii=False)
  ```
- 确认文件顶部已 `import json`（已有则不动）。

**T4: 系统提示注入 `show_widget` 使用规范**
- 文件：`agenticx/runtime/prompts/meta_agent.py`
- 新增一个 builder 函数 `_build_widget_capability_block() -> str`，参照范式：`_build_web_search_capability_block`（约第 560 行）/ `_build_url_vision_capability_block`（约第 592 行）的写法（返回一段以 `## 标题\n` 开头、以 `\n\n` 结尾的中文字符串）。
- 在 `build_meta_agent_system_prompt` 的 `base_prompt` f-string 里，把 `f"{_build_widget_capability_block()}"` 插在 `f"{_build_url_vision_capability_block()}"`（约第 817 行）之后、`f"{_build_followup_questions_block()}"` 之前。
- 文案要点（写进该 block）：
  - 何时用：用户要「图/示意图/流程图/架构图/图表/可视化」，或解释复杂结构/数据时主动用 `show_widget`。
  - SVG vs HTML：静态示意/流程/架构 → 手写 SVG；需要交互或数据驱动（柱状/折线/饼） → HTML + Chart.js（从 CDN 白名单加载）。
  - SVG 规范：`viewBox="0 0 680 H"`、`width="100%"`、文字用 `var(--font-sans)`、颜色用主题变量（见 T8 变量清单），箭头 marker 用 `stroke="context-stroke"`。
  - CDN 白名单仅这四个域名（列出）。
  - 一次只渲染一个 widget；`title` 必填且简短。

### P1 — 前端渲染

**T5: 新建解析器 `widget-preview.ts`**
- 文件：`desktop/src/components/messages/widget-preview.ts`（新建）
- 严格照抄 `skill-manage-preview.ts` 的结构（trim → 必须以 `{` 开头 `}` 结尾 → `JSON.parse` → 字段校验 → 失败返回 null）。
- 导出：
  ```ts
  import type { Message } from "../../store";

  export type WidgetPayload = {
    title: string;
    widgetCode: string;
    loadingMessages: string[];
    /** "svg" when widgetCode starts with <svg, else "html". */
    kind: "svg" | "html";
  };

  export function parseWidgetPayload(content: string): WidgetPayload | null { /* ... */ }
  export function isShowWidgetToolMessage(message: Message): boolean {
    return String(message.toolName ?? "").trim() === "show_widget";
  }
  ```
- `parseWidgetPayload`：解析 JSON，要求 `parsed.type === "widget"` 且 `typeof parsed.widget_code === "string"` 且非空，否则返回 null；`kind` 由 `widget_code.trimStart().toLowerCase().startsWith("<svg")` 决定；`loadingMessages` 容错为 string[]。

**T6: 新建 CSS 变量收集工具 `widget-theme.ts`**
- 文件：`desktop/src/utils/widget-theme.ts`（新建）
- 导出 `collectThemeCssVars(): string`：从 `getComputedStyle(document.documentElement)` 读取 Near 主题变量（变量名清单见 T8），拼成 `"--font-sans: ...; --color-text-primary: ...;"`。读不到的变量跳过。仅在 HTML/iframe 模式调用。

**T7: 新建渲染组件 `WidgetBlock.tsx`**
- 文件：`desktop/src/components/messages/WidgetBlock.tsx`（新建）
- Props：`{ payload: WidgetPayload }`
- 内部分两个子组件：

  **SVG 模式（安全 strip 后 innerHTML）**：
  ```tsx
  function SvgWidget({ code }: { code: string }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (!ref.current) return;
      // Strip <script> and on* handlers before injecting (SVG must be inert).
      const doc = new DOMParser().parseFromString(code, "image/svg+xml");
      doc.querySelectorAll("script").forEach((n) => n.remove());
      doc.querySelectorAll("*").forEach((el) => {
        [...el.attributes].forEach((a) => {
          if (a.name.toLowerCase().startsWith("on")) el.removeAttribute(a.name);
        });
      });
      const svg = doc.documentElement;
      ref.current.replaceChildren(svg);
    }, [code]);
    return <div ref={ref} className="w-full overflow-x-auto" />;
  }
  ```

  **HTML 模式（sandbox iframe + CSP + 自适应高度）**：
  ```tsx
  const CDN_ALLOW = "https://cdnjs.cloudflare.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com";
  function HtmlWidget({ code }: { code: string }) {
    const [height, setHeight] = useState(200);
    const cssVars = useMemo(() => collectThemeCssVars(), []);
    const srcDoc = useMemo(() => `<!doctype html><html><head>
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:; script-src 'unsafe-inline' ${CDN_ALLOW}; connect-src ${CDN_ALLOW};">
      <style>:root{${cssVars}} body{margin:0;background:transparent;font-family:var(--font-sans,system-ui);color:var(--color-text-primary,#222)}</style>
      </head><body>${code}
      <script>(function(){function r(){var h=document.body.scrollHeight;parent.postMessage({__agxWidget:1,height:h},'*');}new ResizeObserver(r).observe(document.body);window.addEventListener('load',r);r();})();</script>
      </body></html>`, [code, cssVars]);
    useEffect(() => {
      function onMsg(e: MessageEvent) {
        const d = e.data;
        if (d && d.__agxWidget && typeof d.height === "number") {
          setHeight(Math.min(Math.max(d.height, 80), 1200));
        }
      }
      window.addEventListener("message", onMsg);
      return () => window.removeEventListener("message", onMsg);
    }, []);
    return (
      <iframe
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        title="widget"
        style={{ width: "100%", border: "none", height }}
      />
    );
  }
  ```
  注意：`sandbox="allow-scripts"` **不含** `allow-same-origin`，iframe 内 JS 无法访问父 DOM；`postMessage` 上报高度是允许的。

  **Loading 轮播**：`payload.loadingMessages` 非空时，渲染前先显示轮播（1.2s 间隔，参照 `Shimmer` 组件 `desktop/src/components/ds/Shimmer.tsx` 的用法），可简化为：内容已随消息一次性到达，故 loading 主要用于 iframe 未 load 完成期间；用 iframe `onLoad` 切换显隐即可，无 loadingMessages 时显示「渲染中…」。

**T8: ToolCallCard 接线（核心集成点）**
- 文件：`desktop/src/components/messages/ToolCallCard.tsx`
- 改动 1（标题）：`buildToolCardTitle`（约第 50-76 行）内，在返回前加：
  ```ts
  if (name === "show_widget") {
    const t = String((args as Record<string, unknown>).title ?? "").trim();
    return t || "可视化图表";
  }
  ```
  注意 `show_widget` 的 title 也可能不在 `toolArgs` 而在已解析 payload 里；优先用 `args.title`，兜底用解析 `message.content`。
- 改动 2（图标）：`pickToolIcon`（约第 78-85 行）加 `if (name === "show_widget") return BarChart3;`，并在顶部 lucide import 补 `BarChart3`。
- 改动 3（解析 payload，参照 `skillPreviewPayload` useMemo 第 160-163 行）：
  ```ts
  const widgetPayload = useMemo(() => {
    if ((message.toolName ?? "").trim() !== "show_widget") return null;
    return parseWidgetPayload(message.content);
  }, [message.toolName, message.content]);
  ```
- 改动 4（detailBody 内渲染，参照第 202-208/227-231 行）：在 `detailBody` 的 JSX 里，`skillPreviewPayload` 分支之后加 `widgetPayload` 分支渲染 `<WidgetBlock payload={widgetPayload} />`；并在「原始 content 文本」那段（第 227 行 `message.content && !skillPreviewPayload && !skillManageError`）的条件里追加 `&& !widgetPayload`，避免同时显示原始 JSON。
- 改动 5（默认展开）：`show_widget` 应默认展开。在组件内 `shouldForceExpand` 计算处（约第 151 行）追加：`const shouldForceExpand = forceExpand || matchedByHighlight || widgetPayload != null;`（注意 `widgetPayload` 的声明需移到该行之前）。
- import 顶部补：`import { WidgetBlock } from "./WidgetBlock";` 和 `import { parseWidgetPayload } from "./widget-preview";`

### P2 — 给模型的设计规范常量

**T9: Near 主题 CSS 变量清单（供 T4 提示文案与 T6 收集逻辑共用）**
- 先用 grep 确认 Near 实际存在的主题 CSS 变量名（在 `desktop/src/index.css` 与主题 token 文件中搜索 `--color-`、`--font-`、`--theme-color-rgb`），**以仓库真实变量名为准**，不要照搬 WorkBuddy 的变量名。
- 把确认到的变量清单同时写进：
  - T4 系统提示文案（告诉模型 SVG/HTML 里能用哪些 `var(--...)`）。
  - T6 `collectThemeCssVars` 的读取列表。
- 候选变量（需用 grep 核实后保留真实存在的）：`--font-sans`、`--color-text-primary`、`--color-text-secondary`、`--color-background-primary`、`--color-border-primary`、`--theme-color-rgb`。

---

## 文件变更清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `agenticx/cli/agent_tools.py` | 修改 | T1 schema、T2 并发安全集合、T3 dispatch + `_tool_show_widget` |
| `agenticx/runtime/prompts/meta_agent.py` | 修改 | T4 `_build_widget_capability_block` + 插入 base_prompt |
| `desktop/src/components/messages/widget-preview.ts` | 新建 | T5 解析器（照抄 skill-manage-preview.ts） |
| `desktop/src/utils/widget-theme.ts` | 新建 | T6 CSS 变量收集 |
| `desktop/src/components/messages/WidgetBlock.tsx` | 新建 | T7 SVG + iframe 渲染 |
| `desktop/src/components/messages/ToolCallCard.tsx` | 修改 | T8 标题/图标/解析/渲染/默认展开 |

（注意：**不改** `ImBubble.tsx` — 渲染全在 ToolCallCard 内，与 skill_manage 一致。）

---

## 验收标准

- **AC-1 SVG**：模型调用 `show_widget` 传 SVG，气泡内工具卡默认展开并渲染矢量图；`var(--font-sans)` 继承当前界面字体；dark/dim/light 三主题均正常。
- **AC-2 HTML/Chart.js**：传含 Chart.js CDN 的 HTML，柱状图正常渲染；iframe 高度随内容自适应（postMessage 生效）；devtools 可见 CSP 阻止非白名单域名。
- **AC-3 安全**：SVG 模式 `<script>` 和 `on*` 属性被 strip（传一段带 `<script>alert(1)</script>` 的 SVG，不执行）；HTML iframe 为 `sandbox="allow-scripts"`，无 `allow-same-origin`，iframe 内 `parent.document` 访问被拦截。
- **AC-4 卡片**：工具卡标题显示 `title` 而非 `show_widget`；图标为 BarChart3；折叠后再展开内容不丢失。
- **AC-5 回退**：`widget_code` 为空时后端返回 `ERROR:` 文本，前端按普通工具错误展示，不崩溃；`parseWidgetPayload` 返回 null 时回退为原始 content 文本展示。
- **AC-6 构建**：`desktop` 端 `npm run typecheck` 与 `npm run build` 通过（无新增 TS 错误 / 无 `any`）。

---

## 实施顺序

1. T1+T2+T3（后端，最小闭环，可用一段真实 SVG 手测 dispatch 返回的 JSON）。
2. T9 grep 核实变量名（前端组件依赖它）。
3. T5+T6+T7（前端组件，可在独立测试页或直接喂一条 mock 工具消息验证）。
4. T8（接进 ToolCallCard）。
5. T4（系统提示，让模型「会主动用」），全链路联调 + 跑 AC。

---

## 关键风险与对策

| 风险 | 对策 |
|------|------|
| iframe 高度未知 / 抖动 | iframe 内 `ResizeObserver` + `postMessage` 上报 `scrollHeight`，父层 clamp 到 [80,1200] |
| SVG 注入恶意脚本 | T7 用 `DOMParser` 解析后移除所有 `<script>` 与 `on*` 属性再注入 |
| 主题切换后 iframe 不更新 CSS 变量 | 本期可接受（widget 是历史消息快照）；如需实时，监听主题事件向 iframe postMessage 更新，列入未来扩展 |
| tool_result 是否真落到 message.content | 已确认与 `skill_manage` 同链路：`SkillPatchPreviewCard` 正是读 `message.content` 渲染，范式可复用 |
| 主题变量名臆造 | T9 强制 grep 仓库真实变量名，不照搬 WorkBuddy |
| 模型不会用 / 滥用 | T4 提示明确「何时用 + SVG vs HTML + 一次一个 + CDN 白名单」 |
