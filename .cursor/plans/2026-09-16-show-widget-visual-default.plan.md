# show_widget 默认出图改 SVG/HTML + 延迟自愈对齐

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Composer 2.5

> **For implementer:** 只改本文件列出的符号。禁止把 `show_widget` 加回 `CORE_ALWAYS_LOAD_TOOLS`（token diet 仍要它延迟）。禁止改 `server.py` 顶部 import 区。不要 commit，除非用户明确要求。

**Goal:** 对话出图默认走可视化效果最好的 `show_widget`（静态结构用 SVG，交互/数据驱动用 HTML）；仅当用户明确要 Mermaid 时才用 mermaid。同时修掉「直调未加载 `show_widget` 被硬拒、模型改吐 markdown mermaid」的必现坑。

**Architecture:** 两处独立改动。(1) catalog 的 `always_load` 与 `is_deferred_builtin` 用同一套 CORE 规则，直调延迟工具走已有 auto-load，不再硬拒。(2) 系统提示只留短触发规则；格式选择细则留在 `SHOW_WIDGET_USAGE` / 工具 description；`widget_flow_guard` 把 ` ```mermaid ` 当作非法替代。

**Tech Stack:** Python runtime prompts + ToolSearch catalog；现有 pytest。

---

## 根因与证据链（实施者勿依赖对话记忆）

会话 `~/.agenticx/sessions/782cf11a-1c9e-408f-908c-1773c0ddc736/`：

- 用户：「给个完整的技术流程图我」
- 模型按提示直调 `show_widget`（`widget_format=mermaid`，参数完整）
- 工具结果：`工具 'show_widget' 不在当前允许列表中，已拒绝执行。`
- `context_stats.jsonl`：`tool_search_applied=true`，`tool_search_loaded_count=0`
- 第二轮模型放弃，吐 ` ```mermaid ` 代码块；Desktop `MermaidBlock` 渲染，不是 widget 卡

策略打架：

- `is_deferred_builtin()`（`agenticx/runtime/tool_search.py` L703–705）=「不在 `CORE_ALWAYS_LOAD_TOOLS` 就延迟」。`show_widget` 不在 CORE → 投影不含 schema。
- `build_builtin_catalog()`（`agenticx/runtime/tool_search_runtime.py` L94）仍用旧白名单：`always = name in CORE or name not in BUILTIN_DEFER_ALLOWLIST`。`show_widget` 早已不在 allowlist → catalog `always_load=True`。
- `is_tool_pending_next_round()`（`tool_search.py` L774–775）看到 `always_load` 就返回 False → 跳过 `auto_load_deferred_tool` → 硬拒。
- 系统提示仍写「直接调用即可，系统会加载」+「流程类图优先 Mermaid」。
- `widget_flow_guard` 只在 `show_widget in allowed_tool_names` 时重写；且 `test_mermaid_block_not_flagged` 明确放过 mermaid 围栏。

同类坑：`analyze_image` / `get_current_datetime` / `verify_run` 等 9 个「漏网常驻 → 现已延迟」工具直调也会硬拒。对齐 `always_load` 一并修好。

## In scope

- 对齐 `always_load` 与 `is_deferred_builtin`
- 出图默认 SVG/HTML；仅用户点名 Mermaid
- guard 拦截 mermaid 代码块替代
- 对应单测

## Out of scope

- 不把 `show_widget` 加回 CORE
- 不改 Desktop `MermaidBlock` / `WidgetBlock` 渲染实现
- 不改 `stock_chart` JSON 路径
- 不改 `server.py` 顶部 import
- 不做可编辑画布 / 第三方 MCP

## 推荐实施模型

| 子任务 | 推荐模型 | 理由 |
|---|---|---|
| 全程 | Composer 2.5 | 提示词短改 + catalog 一行对齐 + 既有 pytest，无跨栈审美 |

---

## FR-1：catalog `always_load` 对齐延迟闸门

**落点：** `agenticx/runtime/tool_search_runtime.py` L11–12 的 `BUILTIN_DEFER_ALLOWLIST` import，以及 L94。

**Before：**

```python
always = name in CORE_ALWAYS_LOAD_TOOLS or name not in BUILTIN_DEFER_ALLOWLIST
```

**After：**

```python
always = name in CORE_ALWAYS_LOAD_TOOLS
```

并从该文件 import 列表删除未再使用的 `BUILTIN_DEFER_ALLOWLIST`。不要删 `tool_search.py` 里的 allowlist 常量（测试仍引用）。

**AC-1：** `tests/test_agent_runtime_tool_search.py` 新增 `test_catalog_always_load_matches_defer_gate`：用 `studio_tools_for_session` + `ToolSearchConfig(mode="always")` 建 ctx，对每个 `kind=="builtin"` 的 descriptor 断言 `d.always_load is (not is_deferred_builtin(d.name))`。

**AC-2：** 同文件新增 `test_show_widget_direct_call_is_pending_not_hard_denied`：在 `_make_pool()` 上 append `show_widget`，`project_tools_for_round` 不含该名，但 `is_tool_pending_next_round(..., "show_widget", ...)` 为 True，且 catalog 里该 descriptor `always_load is False`。现有 `test_show_widget_is_deferred_until_loaded` 必须仍绿（继续延迟，只是自愈能走通）。

---

## FR-2：默认出图策略（用户点名才 Mermaid）

触发规则留 system prompt（短）；用法细则留 description。禁止把 CDN / viewBox / prefers-color-scheme 写回 prompt（`test_widget_render_details_are_not_duplicated_into_the_prompt` / `test_meta_static_prompt_stays_under_char_budget` ≤ 12500）。

### FR-2a Meta 触发块

**落点：** `agenticx/runtime/prompts/meta_agent.py` `_build_widget_capability_block()` 约 L739–740。

**Before：** `show_widget(title=..., widget_format="mermaid", ...)` + 「流程类图优先 Mermaid」

**After：** 仍要求衔接语 → `show_widget` → 解读；改为「默认 SVG 或 HTML，选可视化效果最好的；仅当用户明确要 Mermaid 时才 mermaid；禁止用 ```mermaid 代码块代替」。不要写进思考块。保留「直接调用即可，系统会加载」。

**AC-3：** 改 `tests/test_smoke_show_widget_prompt.py` 的 `test_widget_capability_block_prefers_mermaid_for_connected_diagrams`：

- 重命名为 `test_widget_capability_block_defaults_to_best_visual_format`
- prompt 块断言含「SVG」「HTML」、以及「明确」+「Mermaid」（用户点名才用）
- prompt 块断言 **不含** `widget_format="mermaid"` 与「流程类图优先 Mermaid」
- `SHOW_WIDGET_USAGE` 仍含「流程图/架构图/链路图/时序图」、`svg`、以及用户点名才 mermaid 的语义（断言「明确」与 `'mermaid'`）
- 保留「不要包 Markdown 代码围栏」「短标签」

### FR-2b 用法细则

**落点：** `agenticx/runtime/prompts/tool_discipline.py` `SHOW_WIDGET_USAGE` 首段「【格式选择】」（约 L25–27）。

**After 意图：** 默认选可视化效果最好的形式，禁止图省事默认 Mermaid。流程/架构/链路/时序/对比 → `'svg'`；交互或数据驱动 → `'html'` + Chart.js/D3 + CDN 白名单；**仅当用户明确要求 Mermaid / mermaid 图 / mermaid 源码** 才 `'mermaid'`。后面的【Mermaid 规范】【SVG 规范】整段保留。

### FR-2c 工具 schema 文案

**落点：** `agenticx/cli/agent_tools.py` `show_widget` 定义约 L2120–2158。

- `description`：删「For flowcharts ... set widget_format='mermaid'」。改为默认 SVG（静态结构图）/ HTML（交互或数据驱动）；mermaid **only** when the user explicitly asks。继续禁止 markdown 文本/箭头链，并禁止 ` ```mermaid ` 围栏代替工具。
- `widget_code.description`：SVG / HTML 写在前面，Mermaid 放后。
- `widget_format.description`：默认 svg（静态）或 html（交互）；mermaid only if the user explicitly asks。

`stock_chart` JSON 要求一句不动。

**AC-4：** `tests/test_prompt_token_diet.py` 的 `test_tool_usage_rules_live_in_the_description_not_the_prompt`（marker `CDN 白名单`）与 `test_show_widget_trigger_rules_stay_in_the_prompt` 仍绿。`test_smoke_show_widget_stock_chart.py` 全绿。

### FR-2d 分身提示

**落点：** `agenticx/studio/server.py` 约 L3649–3650（「出 SVG 图」那一行）。**只改这一句**，禁止整段替换、禁止碰文件顶部 import。

改为：`show_widget` 出图（默认 SVG 或 HTML；仅用户明确要 Mermaid 时才 mermaid）。禁止 ` ```text ` / 正文箭头链，也禁止用 ` ```mermaid ` 代替。

---

## FR-3：guard 拦截 mermaid 围栏

**落点：** `agenticx/runtime/widget_flow_guard.py`

1. `find_text_flow_diagram_hits()`（约 L134–136）：对 `info.lower() in ("mermaid", "mmd")` 且 body 非空的围栏追加 `TextFlowHit("用 mermaid 代码块代替 show_widget", snippet)`。语言围栏不再被跳过。
2. `WIDGET_FLOW_RETRY_HINT`（约 L175–183）：删「或在简单场景用 ```mermaid``` 代码块」。改为必须 `show_widget`：默认 SVG，交互/数据驱动 HTML；仅用户明确要求时才 `widget_format='mermaid'`；禁止 mermaid/text 围栏或正文箭头链代替。

**AC-5：** `tests/test_smoke_widget_flow_guard.py`：把 `test_mermaid_block_not_flagged` 改成 `test_mermaid_block_is_flagged_as_widget_substitute`，断言 `contains_text_flow_diagram` 为 True；`test_retry_hint_includes_hit_snippet` 仍绿，并断言 hint **不含**「简单场景用 ```mermaid」。

---

## 验证

```bash
pytest tests/test_agent_runtime_tool_search.py tests/test_smoke_show_widget_prompt.py tests/test_smoke_show_widget_stock_chart.py tests/test_smoke_widget_flow_guard.py tests/test_prompt_token_diet.py tests/test_tool_search.py tests/test_tool_search_adaptive_threshold.py -q
```

预期全绿。`test_meta_static_prompt_stays_under_char_budget` 若超 12500，只压缩 FR-2a 触发句，禁止把细则搬回 prompt。
