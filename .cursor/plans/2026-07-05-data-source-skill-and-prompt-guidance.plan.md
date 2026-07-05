# Sub-Plan E：Skill + System Prompt 联动纪律 + 端到端冒烟测试矩阵

Planned-with: Claude Sonnet 5
Plan-Id: 2026-07-05-data-source-skill-and-prompt-guidance
Plan-File: .cursor/plans/2026-07-05-data-source-skill-and-prompt-guidance.plan.md
父规划: `.cursor/plans/2026-07-05-unified-data-source-gateway.plan.md`
前置依赖: Sub-Plan B（真实插件可用）、Sub-Plan D（渲染路径确定）

## 1. 需求

### FR

- **FR-1**：新增 Skill `~/.agents/skills/query-data-source/SKILL.md`（或仓库内 `.cursor/skills/`，实施时对齐既有 skill 落点惯例——本仓库同时有 `agenticx/skills/agenticx-tool-creator/SKILL.md` 这类内置 skill 目录，需先确认新 skill 该落在哪一层，避免散落），内容覆盖：
  - 何时该用 `query_data_source` 而非猜测/编造数据（**硬性纪律**：涉及股价、财务指标、宏观数据等可查证事实时，禁止凭训练记忆直接回答，必须先 `list_data_sources`/`query_data_source`）。
  - 取数后必须用 `show_widget`（K 线/走势场景）而不是纯文字表格罗列（对齐现有 `show_widget` 系统提示纪律「凡是流程/链路图必须 show_widget」的同一套产品哲学，本规划把它扩展到「凡是时间序列数据可视化」）。
  - 三元组调用示例（`data_source_name`/`api_name`/`params`）与常见参数陷阱（如 `symbol` 是否带交易所后缀）。
  - 各插件的能力边界与降级策略（`ifind` 未授权时应转用 `akshare`/`tushare`，不得静默失败或编造数据）。
- **FR-2**：`agenticx/runtime/prompts/meta_agent.py` 新增一段系统提示注入（参照现有 `_build_active_subagents_context`/`show_widget` 纪律段落的写法），明确：
  - `query_data_source` 存在及其触发条件（可查证的量化事实类问题）。
  - 与 `show_widget` 的组合纪律（取数 → 渲染 → 解读三段式，参照现有「先写 1-3 句衔接语 → show_widget 出图 → 后分节解读」的既定格式）。
  - **禁止编造数据的红线**：即使工具调用失败，也必须明确告知用户「数据源暂不可用」，不得用训练记忆里的过时数字冒充实时数据。
- **FR-3**：新增 `agenticx/runtime/data_source_flow_guard.py`（参照已有 `widget_flow_guard.py` 的检测模式），检测助手回复中是否出现「疑似编造的具体数值 + 未见任何 `query_data_source` 工具调用记录」的组合信号，命中时注入纠偏提示要求模型重新走工具调用路径。此为 **P1（可选强化项）**，若时间不足可降级为仅靠 Skill+提示词软约束，不做硬检测。
- **FR-4**：端到端冒烟测试矩阵，覆盖主规划里定义的里程碑场景（用户问「火炬电子最近走势」→ `query_data_source` → `show_widget` → 图表 + 来源标注），以及至少一个非金融领域场景（如「中国过去5年GDP增速」→ `world_bank` → 折线图），验证「跨领域」这一 Kimi 对标的核心卖点确实成立，而不是只做了金融这一个垂类。

### NFR

- **NFR-1**：Skill 与系统提示新增内容不得与现有 `show_widget` 纪律段落冲突或重复描述（复用同一套「衔接语 → 工具调用 → 解读」表达范式，只扩展触发条件，不重写整套纪律）。
- **NFR-2**：系统提示新增内容需控制长度，避免像 AGENTS.md 记忆中提到的「知识库长备注」问题那样过度膨胀 system prompt token 消耗——优先把详细 API 目录放进 Skill（渐进披露），系统提示只放触发纪律的精简版。

### AC

- **AC-1**：给定「贵州茅台最近半年涨了多少」这类问题，端到端跑通「调用 `list_data_sources`/`query_data_source` → `show_widget` 渲染 → 文字解读」全链路，且解读中的具体数字与工具返回数据一致（人工核对，不接受编造）。
- **AC-2**：给定「中国过去5年GDP增速」，走 `world_bank` 或 `imf` 路径，验证非金融领域数据同样可用，产出折线图而非蜡烛图（`StockChartWidget` 的 `chart_type: "line"` 分支）。
- **AC-3**：故意断网或停用所有数据源插件后提问股价，Agent 明确告知「当前数据源不可用」，不得给出编造的具体数字。
- **AC-4**：Skill 文档本身通过仓库既有 skill 校验流程（若有 `skill_use`/`scan_skill` 之类的安全扫描，需确保新 Skill 不触发误报）。

## 2. 技术方案

### 2.1 Skill 文档骨架

**Files:**
- Create: `<待实施时确认落点>/query-data-source/SKILL.md`

```markdown
---
name: query-data-source
description: Use when the user asks about verifiable quantitative facts (stock prices, macro indicators, company registry, academic metrics, legal statutes) that must come from a live data source rather than training memory.
---

# Query Data Source

## When to use
- Any question about stock price / financial indicator / macro economic data / company
  registry / academic citation counts / legal statute text that has a real, checkable
  current value.
- Do NOT answer from training memory for these categories — training data is stale and
  the user can verify against a real source.

## How to call
1. If unsure which `data_source_name`/`api_name` fits, call `list_data_sources` first
   (optionally with a `domain` filter: finance/macro/academic/enterprise/legal).
2. Call `query_data_source(data_source_name=..., api_name=..., params=...)`.
3. For time-series results intended for visualization (price history, macro trend),
   follow up with `show_widget` — either the MVP ECharts-HTML form or, once available,
   the structured `{"type":"stock_chart", ...}` form. Do not dump a raw markdown table
   as a substitute for a chart.
4. Write 1-3 sentences of visible intro prose before the `show_widget` call, then explain
   the data afterward (same discipline as existing show_widget flow rules).

## Fallback discipline
- If the chosen plugin returns MissingCredentialError (e.g. `ifind`, or `tushare` without
  a connected MCP), try a free alternative (`akshare`, `world_bank`) before telling the
  user data is unavailable.
- If ALL applicable sources fail, say so explicitly ("当前数据源暂不可用，无法核实最新数据").
  Never substitute a remembered/guessed number.

## Known plugins (see list_data_sources for the live, authoritative list)
| domain | plugin | notes |
|---|---|---|
| finance | akshare | free, no credential, A股/港股/美股行情 |
| finance | tushare | requires connected `tushareMcp` |
| finance | ifind | enterprise-only, currently credential-gated stub |
| macro | world_bank | free, global development indicators |
| macro | imf | free, macro indicators (if not descoped) |
```

### 2.2 系统提示注入

**Files:**
- Modify: `agenticx/runtime/prompts/meta_agent.py`

在现有 `show_widget` 纪律段落函数（约 L607-631 附近，`_build_show_widget_discipline` 或同名函数）旁新增一个精简的姊妹段落函数，例如：

```python
def _build_data_source_discipline() -> str:
    """Describe when the model must call query_data_source instead of guessing facts."""
    return (
        "## 查数纪律（query_data_source）— 硬性纪律\n"
        "- 涉及股价/财务指标/宏观经济数据/企业工商/学术引用等**可核实的量化事实**时，"
        "**禁止**凭训练记忆直接给出具体数字，必须先调用 `list_data_sources`（如不确定用哪个源）"
        "再调用 `query_data_source` 取得真实数据。\n"
        "- 取到的时间序列数据用于可视化时，按 show_widget 纪律渲染图表，不要退化为纯文字表格。\n"
        "- 若所选数据源返回凭证缺失/连接失败，先尝试免费替代源（如 akshare/world_bank）；"
        "全部失败时必须明确告知用户「当前数据源暂不可用」，**严禁编造具体数值**。\n"
    )
```

并在组装整体 system prompt 的位置（现有 `show_widget` 段落被拼接进最终 prompt 的那一处调用点）追加拼接 `_build_data_source_discipline()`，保持与既有段落同样的注入方式，不新建一条平行的拼接管道。

### 2.3（P1，可选）`data_source_flow_guard.py`

**Files:**
- Create: `agenticx/runtime/data_source_flow_guard.py`（参照 `agenticx/runtime/widget_flow_guard.py` 的检测思路：用正则/启发式判断回复文本里是否出现「具体股价/百分比数字 + 本轮未见 query_data_source 工具调用」的组合）

```python
#!/usr/bin/env python3
"""Detect answers that assert verifiable quantitative facts without a
query_data_source tool call in the same turn, and nudge the model to redo it.

Author: Damon Li
"""

from __future__ import annotations

import re
from typing import Sequence

_SUSPECT_PATTERN = re.compile(
    r"(涨了|跌了|收盘于|GDP\s*增速|同比增长)\s*[\d.]+%?"
)

_NUDGE_MESSAGE = (
    "检测到回复中包含具体量化数据，但本轮未见 query_data_source 工具调用记录。"
    "请先调用 list_data_sources / query_data_source 核实真实数据后再回答，"
    "禁止使用训练记忆中的数字。"
)


def detect_uncited_quant_claim(reply_text: str, tool_calls_this_turn: Sequence[str]) -> str | None:
    """Return a nudge message if reply_text asserts a quant fact without backing tool calls."""
    if "query_data_source" in tool_calls_this_turn:
        return None
    if _SUSPECT_PATTERN.search(reply_text):
        return _NUDGE_MESSAGE
    return None
```

> 此文件为 **P1 可选强化项**，实施时先评估现有 `widget_flow_guard.py` 的接线点（在 `agent_runtime.py` 的哪个 hook 调用），确认接入成本可控才落地；若时间紧张可先跳过，仅靠 2.1/2.2 的软约束上线。

## 3. 验收标准与用例

### 冒烟测试（新增 `tests/test_smoke_data_source_skill_discipline.py`）

```python
"""Smoke tests for the data source query discipline (system prompt content
and the optional flow guard heuristic).

Author: Damon Li
"""

from agenticx.runtime.prompts.meta_agent import _build_data_source_discipline


def test_data_source_discipline_mentions_key_tools():
    block = _build_data_source_discipline()
    assert "query_data_source" in block
    assert "list_data_sources" in block
    assert "编造" in block


def test_flow_guard_flags_uncited_quant_claim():
    from agenticx.runtime.data_source_flow_guard import detect_uncited_quant_claim

    reply = "火炬电子今天涨了5.18%。"
    nudge = detect_uncited_quant_claim(reply, tool_calls_this_turn=[])
    assert nudge is not None


def test_flow_guard_allows_claim_backed_by_tool_call():
    from agenticx.runtime.data_source_flow_guard import detect_uncited_quant_claim

    reply = "火炬电子今天涨了5.18%。"
    nudge = detect_uncited_quant_claim(reply, tool_calls_this_turn=["query_data_source"])
    assert nudge is None
```

### 端到端冒烟测试矩阵（人工，跑在真实 Desktop + `agx serve`，需联网）

| # | 场景 | 领域 | 预期工具链 | 验收点 |
|---|---|---|---|---|
| E2E-1 | 「火炬电子最近走势」 | finance/akshare | `list_data_sources`?→`query_data_source`→`show_widget` | K线图 + 「数据来源：AkShare」角标，文字解读数字与图表一致 |
| E2E-2 | 「中国过去5年GDP增速」 | macro/world_bank | `query_data_source`→`show_widget`（折线） | 折线图，验证非金融领域可用 |
| E2E-3 | 「用同花顺数据查一下贵州茅台财务指标」 | finance/ifind | `query_data_source`（ifind） | 返回「需企业授权」提示并主动改用 akshare，不假装拿到数据 |
| E2E-4 | 停用所有插件后问股价 | finance | `list_data_sources`（空） | 明确告知数据源不可用，不编造数字 |
| E2E-5 | 「用 Tushare 查一下平安银行日线」但未连接 MCP | finance/tushare | `query_data_source`（tushare）→ 引导连接 MCP | 提示去设置连接 `tushareMcp`，不裸抛异常 |

## 4. 风险与资源排期

| 风险 | 影响 | 缓解 |
|---|---|---|
| Skill 落点目录未定（仓库内 `.cursor/skills/` vs 用户级 `~/.agents/skills/` vs 内置 `agenticx/skills/`） | 新 skill 可能装错位置导致不生效 | 实施第一步先 `Grep "SKILL.md"` 确认 `SkillBundleLoader` 实际扫描的核心路径优先级，选择与本项目其他内置 skill（如 `agenticx-tool-creator`）一致的落点 |
| 系统提示膨胀 | 每轮 token 成本上升 | 严格执行 NFR-2，详细 API 目录留在 Skill 渐进披露，系统提示只放触发纪律 |
| `data_source_flow_guard` 正则误报（如新闻类文本提到涨跌幅但确实来自工具结果的转述） | 无谓打扰、重复调用工具浪费配额 | 定位为 P1 可选项，先小流量/仅日志观察模式验证误报率，再决定是否启用纠偏注入 |
| 端到端用例依赖真实网络与真实数据源 | CI 无法稳定跑，需人工验收 | 明确标注 E2E 矩阵为人工验收，不纳入自动化 CI 主干；自动化部分仅覆盖 2.1/2.2/2.3 的单元测试 |

**预估工作量**：1.5 人天（Skill 撰写 0.5 天 + 系统提示接线 0.3 天 + 可选 flow guard 0.4 天 + 端到端人工验收 0.3 天）。
**前置条件**：Sub-Plan B、Sub-Plan D 完成，具备真实数据与真实渲染路径可供端到端验收。
**产出物**：Skill 文档、`meta_agent.py` 新增段落、（可选）`data_source_flow_guard.py`、`tests/test_smoke_data_source_skill_discipline.py`、人工验收记录。
