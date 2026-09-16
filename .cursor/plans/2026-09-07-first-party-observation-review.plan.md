# S2.1：FirstParty 合并观察文件 + 会话体检只读工具

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Composer 2.5
Parent-Plan: `.cursor/plans/pending/2026-09-06-agenticops-platform-master.plan.md`
Depends-on: S2 `2026-09-06-telemetry-query-and-default-box` 已合入
Plan-Id: 2026-09-07-first-party-observation-review
Wave: 1（数据质量补洞）

> **For implementer:** 不看对话也能落地。不要 commit，除非用户明确要求。实施前把本文件移到 `.cursor/plans/` 根目录。

**Goal:** 调查工具按 `session_id` 取证时，不再因为 `messages.json` 没有 tool 行就断言「没有工具失败」；问体检分数时能读到与 UI 同一套五维评分。

**Architecture:** 不改 `TelemetryQuery` Protocol，不改 SigNoz。`FirstPartyProvider.get_trace` / `get_logs` 在现有 `messages.json` 结果上**并入**同会话 `tool_call_observations.json`。新增第四个只读工具 `get_session_review`，直接调用已有 `review_session()`（只计算、不写盘）。禁止把聊天正文塞进 span。

**Tech Stack:** 现有 `agenticx/ops/` + `agenticx/learning/loop_review.py` + pytest。

---

## 根因与证据链（必须写进 plan，实施者勿依赖对话）

现场复盘 `56d890f4-1446-4729-84ca-c1e9abb578c8`（本机 `~/.agenticx/sessions/<id>/`，实施时用 fixture 复现，勿写客户路径进 commit）：

1. `messages.json` 只有 4 user + 4 assistant，**零条** `role=tool`。`get_trace` 因此只返回 4 个 `assistant.reply` / `ok`。
2. 同目录 `tool_call_observations.json` 有 10 条，全部 `success: false`（`file_read` / `bash_exec` / `list_files`，`result_summary` 含 `path escapes workspace`）。
3. 会话体检 UI（`LoopReviewCard`）读的是 `review_session()`，输入正是 observations + messages。对该目录重算 **overall=55**：`controlled_execution=20`（错误率 100%）、`reliable_delivery=30`（成功率 0%）。
4. 模型只调了 `get_trace`，结论写成「低分不是工具失败」——证据残缺导致结论反了。
5. `get_logs` 在无 tool 行时 `reason=no_logs`，观察里的 ERROR 摘要完全进不了工具表。

另：`c6fc94ce-…` 的 `messages.json` **有** tool 行（含 `bash_exec` error），`get_trace` 能看见；模型仍可能复述更早的自查结果。本 plan **不修模型幻觉**，只把证据补全 + 用工具描述约束「问失败必须同时 get_logs；问分数必须 get_session_review」。

截断落盘（最后一条助手回复写到半句）**本 plan 不做启发式检测**（中文标点不可靠）。Out of scope。

---

## In scope

- `FirstPartyProvider` 合并 `tool_call_observations.json` 到 `get_trace` / `get_logs`
- 去重：messages 已有同名且时间差 ≤2s 的 tool span / log，不再从 observation 重复加
- 新工具 `get_session_review`（只读，算分，不写 `loop_review.json`）
- 工具 description 写清：无正文、观察文件、体检走 review
- 设置文案补上第四个工具名
- 冒烟测试（新 fixture + 旧失败会话仍绿）

## Out of scope

- 按 session_id 拉聊天正文（不是本轮产品）
- 改 `TelemetryQuery` Protocol / SigNoz / Composite 回落规则
- 改体检评分公式、`loop_review.py` 五维算法
- Desktop 聊天气泡 / 群聊 / 分身 / Focus Mode / `meta_agent.py`
- `server.py` 顶部 import 区
- 截断回复检测、自动续写
- 改 `session_search` 语义
- 客户名、对标竞品文案

---

## 现状锚点

| 符号 | 路径 | 约行 / 锚点 |
|------|------|-------------|
| `FirstPartyProvider.get_trace` | `agenticx/ops/first_party.py` | L110–121；span 构建 `_spans_from_messages` L155 |
| `get_logs` | 同文件 | L123–142；`_logs_from_messages` L228 |
| `_load_messages` | 同文件 | L98–108 |
| `TraceSpan` / `LogRecord` | `agenticx/ops/query.py` | L29–47 |
| `OPS_TOOLS` / `dispatch_ops_tool` | `agenticx/ops/tools.py` | L29–57、L132–153 |
| Studio dispatch 白名单 | `agenticx/cli/agent_tools.py` | L9326 `if name in {"get_trace", "get_logs", "get_recent_changes"}` |
| `load_session_observations` | `agenticx/learning/analyzer.py` | L63–74 |
| `review_session` | `agenticx/learning/loop_review.py` | L172；返回 `LoopReview`（`overall` + `dimensions` + `findings`） |
| 观察字段 | 落盘 JSON 对象 | `tool_name` / `result_summary` / `success` / `timestamp` / `turn_index` / `elapsed_ms` |
| 设置文案 | `desktop/src/components/automation/RuntimeConfigSection.tsx` | L50 三工具名 |
| 旧 fixture | `tests/test_smoke_telemetry_query.py` | `FAILED_SESSION` / `STUDIO_SHAPED_SESSION` |
| 工具门闩测试 | `tests/test_smoke_ops_tools.py` | 默认三工具名断言 |

---

## FR / AC

### FR-1：trace / logs 并入观察文件

**Before（`get_trace` 在无 tool 行时）：** 只从 assistant 内容生成 `assistant.reply`。

**After：** 先走现有 `_spans_from_messages`；再读 `load_session_observations(session_dir)`；每条合法观察生成 span：

```
name = tool_name 或 "tool"
status = "error" if success is False else "ok"
start_ts = 解析 timestamp（复用 _parse_ts）
span_id = f"obs-{turn_index}-{name}"（turn_index 缺省用序号）
attributes = {
  "agenticx.session.id": session_id,
  "agenticx.evidence.source": "observations",
}
source = "first_party"
```

去重：若 messages 派生的 span 中已有 **同名** 且 `start_ts` 均非空、绝对差 ≤ 2 秒，则跳过该观察 span。messages 没有任何 tool span 时，观察全部并入（`56d890f4` 形态）。

`get_logs`：现有 `_logs_from_messages` + 审计 JSONL 之后，对未去重的观察追加 `LogRecord`：

```
level = "error" if success is False or result_summary 以 ERROR/Error 开头 else "info"
message = _truncate_4kib(result_summary)
```

无 messages tool 行、但有观察日志时，`reason` 必须是 `""`，不得再返回 `no_logs`。

仍禁止编造 W3C 32-hex；`trace_id` 继续用现有 `_synthetic_trace_id`（`session:<id>`）。

**AC-1：** 新测试 `tests/test_smoke_telemetry_query.py::test_first_party_merges_observations_when_messages_have_no_tools`

Fixture（写在测试里，路径用 `tmp_path`）：

- `sessions/sess-obs/messages.json`：2 user + 2 assistant，无 tool 行
- `sessions/sess-obs/tool_call_observations.json`：2 条，`file_read` / `bash_exec`，`success: false`，`result_summary` 含 `path escapes workspace`

断言：

- `get_trace` items 含 `file_read` 与 `bash_exec`，status 均为 `error`
- 至少一条 span 的 `attributes["agenticx.evidence.source"] == "observations"`
- `get_logs` items 非空，`reason == ""`，拼接 message 含 `path escapes workspace`
- 不得出现虚构的 32-hex `trace_id`（仍为 `session:sess-obs`）

**AC-2：** 旧测试 `test_first_party_trace_and_logs_from_failed_session` 与 Studio 形态测试仍绿（有 tool 行时不因观察缺失而失败；无观察文件行为与现在一致）。

**AC-3：** 同 fixture 再写一条「messages 已有同秒 `bash_exec` tool 行 + 一条同名同秒观察」：`get_trace` 里 `bash_exec` **恰好 1 条**（去重），不得 2 条。

### FR-2：`get_session_review`

不进 `TelemetryQuery`。在 `agenticx/ops/tools.py` 增加工具并在 `dispatch_ops_tool` 分支调用：

```python
from agenticx.learning.loop_review import review_session
# session_dir = FirstPartyProvider._session_dir(session_id)
# 目录不存在或 session_id 空 → {"source":"loop_review","reason":"no_session"|"invalid_scope","items":[]}
# 否则 review = review_session(session_dir)
# items = [asdict(review)]  # dimensions/findings 用 dataclass asdict；datetime 已是 ISO 字符串
```

`review_session` **禁止**再调用 `write_review`。

工具 schema：

```python
{
  "name": "get_session_review",
  "description": (
      "Read-only. Compute the session health review (overall 0-100 and five "
      "dimensions) for a session_id. Same scoring as the Desktop health card. "
      "Does not write files. Never invent scores."
  ),
  "parameters": {
    "type": "object",
    "properties": {"session_id": {"type": "string"}, "limit": {"type": "integer"}},
    "additionalProperties": False,
  },
}
```

`OPS_TOOL_NAMES` 与 `agenticx/cli/agent_tools.py` L9326 集合必须加上 `get_session_review`。只改这一行集合，禁止整段替换 import。

**AC-4：** `tests/test_smoke_ops_tools.py`

- 默认开启时 merge 结果含 `get_session_review`
- `STUDIO_TOOLS` 本体仍不含该名
- `dispatch_ops_tool("get_session_review", {"session_id": "sess-obs"})` 在 AC-1 fixture 下：`overall` 为 int，`controlled_execution` 的 score ≤ 30（错误率 100%），`reason == ""`
- `session_id` 空：`reason == "invalid_scope"`，`items == []`

### FR-3：工具描述（防再问错）

改 `OPS_TOOLS` 里现有三条 description（保持英文，与现网工具表一致）：

- `get_trace`：补一句 `Includes tool rows from messages.json and tool_call_observations.json. No chat text. For health score call get_session_review.`
- `get_logs`：补一句 `Includes observation result_summary when tool rows are missing. Call this when asking why a session failed.`
- `get_recent_changes`：保持只读变更事件，可补 `Not the health score.`

设置文案 `RuntimeConfigSection.tsx` L50 改为包含 `get_session_review`。不改开关逻辑、不改 IPC。

**AC-5：** `tests/test_smoke_ops_tools.py` 断言 `get_trace` description 含 `tool_call_observations` 与 `get_session_review`。

---

## 伪代码（FirstParty 合并）

锚点：`agenticx/ops/first_party.py` 的 `get_trace` / `get_logs`。只在这两处调用合并，不要改 `_spans_from_messages` 的 messages 语义。

```python
def _observation_records(self, session_id: str) -> list[dict]:
    from agenticx.learning.analyzer import load_session_observations
    return [o for o in load_session_observations(self._session_dir(session_id)) if isinstance(o, dict)]

def _near_ts(a, b) -> bool:
    if a is None or b is None:
        return False
    return abs((a - b).total_seconds()) <= 2.0

# get_trace 末尾，clamp 之前：
obs_spans = self._spans_from_observations(observations, scope)
existing_tool = [(s.name, s.start_ts) for s in spans if s.name != "assistant.reply"]
for span in obs_spans:
    if any(n == span.name and self._near_ts(ts, span.start_ts) for n, ts in existing_tool):
        continue
    spans.append(span)

# get_logs：messages 日志为空且观察有内容时 reason=""
```

`_spans_from_observations` / `_logs_from_observations` 新建为 `FirstPartyProvider` 方法，放在 `_logs_from_messages` 附近。

---

## 实施顺序（每步 2–5 分钟）

1. 在 `tests/test_smoke_telemetry_query.py` 写 AC-1 / AC-3 fixture + 测试（先红）。
2. 实现 `FirstPartyProvider` 观察合并；跑这两条 + 旧 first_party 测试至绿。
3. 在 `tests/test_smoke_ops_tools.py` 写 AC-4 / AC-5（先红）。
4. 改 `tools.py` schema / `OPS_TOOL_NAMES` / `dispatch_ops_tool`；`agent_tools.py` **只把** `get_session_review` 加进 L9326 那个 set。
5. 改 `RuntimeConfigSection.tsx` 一句文案。
6. 跑 `pytest tests/test_smoke_telemetry_query.py tests/test_smoke_ops_tools.py tests/test_smoke_loop_review_report.py -q` 全绿。
7. 未改 `server.py` 则不必冷启动三 API。改了 `agent_tools.py` 的 dispatch 集合即可，Desktop 需 ⌘Q 重启后工具表才带上新 description / 第四工具。

---

## 推荐实施模型

| 子任务 | 模型 | 理由 |
|--------|------|------|
| FR-1 观察合并 + 测试 | Composer 2.5 | 纯 Python 合并/去重，有现成 `_parse_ts` |
| FR-2 review 工具 | Composer 2.5 | 调已有 `review_session`，无新算法 |
| FR-3 文案 | Composer 2.5 | 一行 description + 一行 UI |

不要用顶配做这三件。

---

## 验收口述（对话里怎么验）

另开一场 Near，整句：

> 用 get_trace 和 get_logs，session_id 填 `<有观察失败、messages 无 tool 行的 id>`。再 get_session_review 同一个 id。根据这三份证据说明体检为什么低。不要编正文。

预期：trace 出现 error span；logs 出现 `path escapes workspace`；review `overall` 约 50 分段，执行维度很低。禁止再说「没有工具失败」。
