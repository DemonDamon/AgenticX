# 当前时间接地（Current Time Grounding）：修复「问日期被联网搜索带偏」

Planned-with: claude-opus-5
Suggested-Impl-Model: cursor-grok-4.5-high-fast（改动集中在 Python 提示词与工具注册，落点明确、无跨栈风险，不需要顶配）

---

## 1. 问题现象

用户在 Desktop（Machi/Near）对话中问「今天几号」，模型触发 `web_search`（返回 10 条结果），随后回答：

> 今天是 **2025 年 7 月 9 日**，星期三，对应农历乙巳年（蛇年）六月十五 `[Jintianjihao][Time163][Riliqian]`

实际系统日期为 2026-08-01。回答日期错误约 13 个月，且带了来源角标，使错误显得「有据可依」，用户难以察觉。

该缺陷与分支无关，`main` 与 `hc-0730` 均会复现（根因在 runtime 提示词与工具契约层）。

---

## 2. 根因与证据链

### 证据 1：系统提示从未注入本机时间

`agenticx/runtime/prompts/meta_agent.py` 的 `build_meta_agent_system_prompt()`（第 757 行定义，`base_prompt` 从第 846 行起拼装）在 workspace / 身份 / 技能 / MCP / 记忆等所有区块中，**没有任何一处包含当前日期或时刻**。全仓搜索 `current_date` / `Current date` / `今天是` 在 `agenticx/**/prompts/**` 下零命中。

因此模型对「现在是何时」只有两种来源：训练截止期的先验（会给出过期日期），或调用工具。

### 证据 2：联网搜索文案主动把「时效性问题」推向 `web_search`

`agenticx/runtime/prompts/meta_agent.py` 第 613–624 行 `_build_web_search_capability_block()`：

```
"- 你 **内置** `web_search` 工具，可检索公开网页，获取最新资讯、实时数据、以及超出你知识截止日期的信息。\n"
"- 当用户问题明显依赖时效性、当前事实或外部网页时，应 **主动** 调用 `web_search`，无需用户额外开启开关。\n"
```

`agenticx/cli/agent_tools.py` 第 1806–1811 行 `web_search` 的 tool description 同样写着：

```
"Search the public web for up-to-date information (news, live data, documentation "
"beyond knowledge cutoff). Prefer this for time-sensitive or externally verifiable "
"facts before answering."
```

「今天几号」在语义上完全匹配「时效性 / 当前事实 / time-sensitive」，模型按纪律照做。

### 证据 3：搜索结果不构成可信时钟

命中的 `Jintianjihao`（今天几号）、`Time163`、`Riliqian`（日历千年）等站点是 SEO 日期页，正文日期由页面缓存/快照决定，与用户本机时钟无因果关系。搜索引擎索引滞后时会稳定返回过期日期。

### 结论

修复必须同时做两件事，缺一不可：

- 只加工具而不改提示词纪律 → 模型仍会优先 `web_search`（工具描述里明确写了 Prefer）。
- 只改纪律而不注入时间 → 模型不搜了，但只能凭训练先验瞎猜，错得更隐蔽。

---

## 3. 方案总览

| 编号 | 手段 | 说明 |
|------|------|------|
| FR-1 | 新增共享 helper `build_current_time_block()` | 单一实现，供所有 prompt 入口复用 |
| FR-2 | 在 6 个系统提示入口注入当前时间 | Meta / 分身直聊 / 委派 / 子智能体 / 群聊成员 / 定时任务执行器 |
| FR-3 | 收紧 `web_search` 纪律（提示词 + tool description） | 明确禁止用联网搜索查当前日期/时刻 |
| FR-4 | 新增本地工具 `get_current_datetime` | 兜底 + 显式可验证，供模型主动核对 |
| FR-5 | 冒烟测试 | 覆盖 helper 输出、6 个入口注入、工具行为 |

---

## 4. 需求明细

### FR-1：新增 `agenticx/runtime/prompts/current_time.py`

**新建文件**（遵循 `.cursor/rules/google-python-style.mdc`：英文注释/docstring、含 `Author: Damon Li`、禁止相对导入、无 emoji）：

```python
#!/usr/bin/env python3
"""Current local time block injected into agent system prompts.

Author: Damon Li
"""

from __future__ import annotations

from datetime import datetime, timezone

_WEEKDAY_CN = ("星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日")


def get_current_time_facts() -> dict[str, str]:
    """Return authoritative local clock facts from the host machine.

    Returns:
        Mapping with local ISO datetime, date, Chinese weekday name, timezone
        label, UTC offset and UTC ISO datetime.
    """
    local = datetime.now().astimezone()
    return {
        "local_iso": local.strftime("%Y-%m-%d %H:%M:%S"),
        "date": local.strftime("%Y-%m-%d"),
        "weekday_cn": _WEEKDAY_CN[local.weekday()],
        "tz_name": local.tzname() or "",
        "utc_offset": local.strftime("%z"),
        "utc_iso": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
    }


def build_current_time_block() -> str:
    """Build the system-prompt section describing the authoritative current time."""
    facts = get_current_time_facts()
    return (
        "## 当前时间（权威，来自本机系统时钟）\n"
        f"- 本地时间：{facts['local_iso']}（{facts['weekday_cn']}，"
        f"时区 {facts['tz_name']} UTC{facts['utc_offset']}）\n"
        f"- 今天日期：{facts['date']}\n"
        "- 回答「今天几号 / 现在几点 / 今年是哪一年 / 距离某日还有多久」等时间问题时，"
        "**必须**以上述本机时间为唯一权威来源。\n"
        "- **禁止**用 `web_search` 查询当前日期、星期或时刻；网页快照日期不可信，"
        "曾出现搜索结果给出过期日期导致回答错误一年以上的事故。\n"
        "- 农历、节气、节假日安排等**衍生信息**可以联网查询，但必须先锚定上述公历日期再检索，"
        "且不得让搜索结果反过来覆盖本机日期。\n"
        "- 需要在回答中显式核对时间时，可调用 `get_current_datetime` 工具获取结构化结果。\n\n"
    )
```

**要求**：

- 不新增任何配置项，时区一律取本机 `datetime.now().astimezone()`（`~/.agenticx/config.yaml` 不新增 `timezone` 字段，见 Out of scope）。
- 该函数每次调用都重新读时钟（不得缓存），因为系统提示每轮重建，跨零点会话必须自动翻页。

### FR-2：在 6 个系统提示入口注入

统一 `from agenticx.runtime.prompts.current_time import build_current_time_block`（顶部导入，禁止函数内 inline import；`agenticx/runtime/prompts/meta_agent.py` 除外的其余文件若已有 import 区，追加一行即可）。

| # | 文件 | 锚点 | 插入位置 |
|---|------|------|----------|
| 2.1 | `agenticx/runtime/prompts/meta_agent.py` | `base_prompt = (` 第 846 行，`f"{identity_line}"` 第 851 行 | 在 `f"{identity_line}"` **之后**新增一行 `f"{build_current_time_block()}"` |
| 2.2 | `agenticx/studio/server.py` | `_build_avatar_direct_prompt()` 第 3060 行，`prompt = (...)` 第 3067–3070 行 | 在第 3070 行 `)` 之后、`if sys_prompt:` 之前追加 `prompt += build_current_time_block()` |
| 2.3 | `agenticx/runtime/meta_tools.py` | `delegation_system_prompt = (` 第 1883 行 | 在第 1886 行 `)` 之后、`if avatar_sys_prompt:` 之前追加 `delegation_system_prompt += build_current_time_block()` |
| 2.4 | `agenticx/runtime/team_manager.py` | `base = (` 第 383 行，`"你是 AgenticX Studio 的子智能体。\n"` 第 384 行 | 在第 385 行（"你的核心目标…"）之后插入 `f"{build_current_time_block()}"` |
| 2.5 | `agenticx/runtime/group_router.py` | 群聊成员 `system_prompt = (` 第 886 行 | 在 `f"{addressing}\n"`（第 891 行）之后插入 `f"{build_current_time_block()}"` |
| 2.6 | `agenticx/studio/server.py` | 定时任务执行器 `lines: list[str] = [` 第 778 行 | 在第 781 行（"**当前是执行阶段…**"）之后插入一项 `build_current_time_block().rstrip()`，保持 list[str] 结构 |

**不要**触碰这 6 处以外的任何相邻代码。

> ⚠️ `agenticx/studio/server.py` 属高危文件（见 `AGENTS.md`）：只能精确增行，禁止整段替换 import 区或相邻代码块；改完必须做 FR-5 的 `agx serve` 冷启动验证。

### FR-3：收紧 `web_search` 纪律

**3.1** `agenticx/runtime/prompts/meta_agent.py` 第 613–624 行 `_build_web_search_capability_block()` 的 return 串中，在
`"- 当用户问题明显依赖时效性、当前事实或外部网页时，应 **主动** 调用 `web_search`…"`
这一行**之后**追加一行：

```
"- **例外（硬性）**：当前日期、星期、时刻**禁止**用 `web_search` 查询，一律以系统提示「当前时间」章节的本机时钟为准；"
"日期类网页存在缓存快照，曾导致回答日期偏差超过一年。若需结构化确认，用 `get_current_datetime`。\n"
```

**3.2** `agenticx/cli/agent_tools.py` 第 1806–1811 行 `web_search` 的 `description`，在结尾追加一句：

```
"Do NOT use this tool to determine the current date, weekday or clock time; "
"use get_current_datetime instead."
```

保持原有前半段文案不变。

### FR-4：新增本地工具 `get_current_datetime`

**4.1 schema** — `agenticx/cli/agent_tools.py`，在 `STUDIO_TOOLS`（第 374 行起）中 `web_search` 条目（第 1803–1828 行）**之后**追加：

```python
{
    "type": "function",
    "function": {
        "name": "get_current_datetime",
        "description": (
            "Return the authoritative current date and time from the local system clock "
            "(local ISO datetime, date, weekday, timezone and UTC offset). Use this instead "
            "of web_search whenever the current date, weekday or clock time matters."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
},
```

**4.2 实现** — 同文件，在 `_tool_web_search`（第 5604 行）之后新增：

```python
def _tool_get_current_datetime(arguments: Dict[str, Any]) -> str:
    """Return local clock facts as JSON for the model to quote verbatim."""
    from agenticx.runtime.prompts.current_time import get_current_time_facts

    payload = dict(get_current_time_facts())
    payload["source"] = "local_system_clock"
    return json.dumps(payload, ensure_ascii=False)
```

> 该处允许函数内 import：`agent_tools.py` 现有工具实现普遍采用惰性导入以避免循环依赖（参考 `_tool_web_search` 第 5610–5611 行）。若顶部导入不触发循环依赖，优先顶部导入。

**4.3 dispatch** — 同文件 `dispatch_tool_async` 中，在 `if name == "web_search":`（第 7861 行）分支**之后**追加：

```python
        if name == "get_current_datetime":
            return _tool_get_current_datetime(arguments)
```

**4.4 并发安全名单** — 同文件 `_CONCURRENCY_SAFE_STUDIO_TOOLS`（第 124–152 行），在 `"web_search",`（第 146 行）附近追加 `"get_current_datetime",`（纯读、无副作用）。

**4.5 tool_search 加载策略** — `agenticx/runtime/tool_search.py` 的 `BUILTIN_DEFER_ALLOWLIST`（第 65–121 行）**不要**添加该工具名。注释（第 64 行）已说明「未列入者默认 always-load」，我们需要它常驻，schema 极小（无参数），开销可忽略。

---

## 5. In scope / Out of scope

**In scope**

- 新建 `agenticx/runtime/prompts/current_time.py`
- 6 个系统提示入口的注入（FR-2 表格所列精确位置）
- `web_search` 提示词纪律 + tool description 补充
- `get_current_datetime` 工具（schema / 实现 / dispatch / 并发名单）
- 冒烟测试文件

**Out of scope（禁止顺手改）**

- 不新增 `~/.agenticx/config.yaml` 配置项（不做 `runtime.timezone` 用户可配时区）
- 不改 Desktop 前端（`desktop/`）任何文件
- 不改 `enterprise/` 任何文件
- 不重构 `_build_web_search_capability_block()` 的既有引用规范段落（第 617–623 行的 `[N]` 角标纪律保持原样）
- 不改 `agenticx/runtime/context_budget.py` 第 11 行的压缩态精简提示词
- 不调整 `web_search` 的检索实现、provider 或结果格式
- 不为 `datetime.now()` 引入 freezegun 等新依赖

---

## 6. 验收标准（AC）

新建测试文件 `tests/test_smoke_current_time_grounding.py`（命名对齐仓库既有 `test_smoke_*.py` 约定）。

- **AC-1**：`from agenticx.runtime.prompts.current_time import build_current_time_block`；断言返回串同时包含 `"## 当前时间"`、`datetime.now().strftime("%Y-%m-%d")` 的实际值、以及子串 `"禁止"` 与 `"get_current_datetime"`。
- **AC-2**：断言 `get_current_time_facts()["date"]` 等于 `datetime.now().astimezone().strftime("%Y-%m-%d")`，且 `weekday_cn` 属于 `("星期一"…"星期日")`。
- **AC-3**：源码级注入检查（避免构造 `StudioSession` 的重依赖）——读取下列文件文本，断言均出现 `build_current_time_block`：
  `agenticx/runtime/prompts/meta_agent.py`、`agenticx/studio/server.py`、`agenticx/runtime/meta_tools.py`、`agenticx/runtime/team_manager.py`、`agenticx/runtime/group_router.py`。
  其中 `server.py` 需出现 **2 次**（分身直聊 + 定时任务执行器）。
- **AC-4**：`_build_web_search_capability_block()` 返回串包含 `"禁止"` 且包含 `"get_current_datetime"`；同时断言原有 `"[N]"` 角标纪律文案仍在（防止误删）。
- **AC-5**：`from agenticx.cli.agent_tools import STUDIO_TOOLS`，断言存在 `name == "get_current_datetime"` 的 function 条目，且其 `parameters.properties == {}`；断言 `web_search` 的 description 含 `"Do NOT use this tool to determine the current date"`。
- **AC-6**：`_tool_get_current_datetime({})` 返回可 `json.loads` 的对象，包含键 `date` / `local_iso` / `weekday_cn` / `source`，且 `date` 与本机日期一致。
- **AC-7**：`from agenticx.cli.agent_tools import studio_tool_is_concurrency_safe`，断言 `studio_tool_is_concurrency_safe("get_current_datetime", {}) is True`。
- **AC-8（强制门禁，因改了 `server.py`）**：本地冷启动
  `agx serve --host 127.0.0.1 --port 65321`
  进程不崩溃，且 `curl --noproxy '*' http://127.0.0.1:65321/api/avatars` 与 `/api/sessions` 均返回 200。
  （`AGENTS.md` 明确要求：任何 `server.py` 改动必须通过冷启动 smoke，不能只看 diff 语义。）
- **AC-9（人工回归）**：Desktop 内提问「今天几号」，期望模型**不触发** `web_search`，直接答出与本机一致的日期与星期；再问「今天农历是什么」，允许联网但公历日期须与本机一致。

运行命令：

```bash
python -m pytest tests/test_smoke_current_time_grounding.py -v
```

---

## 7. 实施与分支流程

1. 本 plan 位于 `main` 的 `.cursor/plans/pending/`，审核通过后**移回** `.cursor/plans/` 根目录再开工。
2. 在 `main`（或自 `main` 拉出的功能分支）实施，**禁止**在 `hc-0730` 上落这部分底层代码。
3. commit trailer：

```
Plan-Id: 2026-08-01-current-time-grounding
Plan-File: .cursor/plans/2026-08-01-current-time-grounding.plan.md
Plan-Model: claude-opus-5
Impl-Model: <实际实施模型，由用户确认；本次预期为 cursor-grok-4.5-high-fast>
Made-with: Damon Li
```

4. main 验证通过后，再由 main 合并/同步进 `hc-0730`。
