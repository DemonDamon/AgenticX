# 04 · 上下文复位循环工具 `fresh_round_loop`（opt-in）

Planned-with: Opus 5 (Cursor)
Suggested-Impl-Model: 中档代码专精实施 + 强推理档收口工具契约
Parent-Plan: `.cursor/plans/pending/2026-08-14-longrun-runtime-hardening.plan.md`
Gap: G-004（P1）
Depends-on: 子规划 01、03（需要稳定的 overflow 与落盘基线；handoff 落盘复用 `_persist_or_abort`）

## 1. 根因与证据链（不依赖对话记忆）

超长任务在 AgenticX 现有三条路径上都不解决「同一会话窗口无限膨胀」：

1. `AgentRuntime._run_turn_inner` 的轮次上限 `self.max_tool_rounds`（`agenticx/runtime/agent_runtime.py` L3377 的 `range(...)`）到顶即停。
2. `agenticx/runtime/team_manager.py` L469 `spawn_subagent()` 的子智能体默认会带上父会话上下文摘要（见 L396-397 的 provider/model 继承与父上下文注入逻辑），所以「再开一个子智能体」并不等于上下文复位。
3. `agenticx/longrun/orchestrator.py` 的 `LongRunOrchestrator` 是**任务源轮询 + 工作区隔离**，`agenticx/project_state/` 是**特性状态机**；两者管跨任务编排，不管「同一目标的对话窗口复位」。

上游 `packages/workflow/tool-ralph` 的做法：固定脚本驱动每一轮启动**不继承父上下文**的子智能体，只传目标 + 上一轮的有界结构化 report，工作区作为 single source of truth，循环结构由部署方拥有、模型改不了（研究证据 E-016 / E-019）。

## 2. In scope / Out of scope

In scope
- 新增一个 opt-in meta 工具 `fresh_round_loop`（产品中性命名，禁止使用上游工具品牌名）。
- 内部复用现有 `AgentTeamManager.spawn_subagent`，但**不注入**父对话历史。
- 有界 JSON handoff 契约与循环终止条件。
- 单测（假子智能体，不起真实进程）。
- 一份使用文档（`docs/guides/` 下，中文）。

Out of scope
- 不引入 worker thread / 插件工作流引擎。
- 不改 `spawn_subagent` 既有签名的默认行为（只按需传参）。
- 不把该工具当默认长任务路径：普通长任务仍走 `longrun` / `project_state`。
- 不在 git commit / PR 文案里出现第三方品牌或「对标 X」表述。
- 不做 Desktop UI 定制（沿用现有子智能体面板与工具卡展示）。

## 3. FR

### FR-1 工具 schema

在 `agenticx/runtime/meta_tools.py` 的工具 schema 列表中（与 L214-260 的 `spawn_subagent` 定义同级，紧随其后）追加：

```python
{
    "type": "function",
    "function": {
        "name": "fresh_round_loop",
        "description": (
            "为一个明确目标启动『上下文复位循环』：每轮用一个全新的子智能体执行，"
            "不继承本会话对话历史，只传目标、工作目录与上一轮的结构化交接报告。"
            "适用于会把单个会话窗口撑爆的超长任务（大规模重构、批量审计）。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "objective": {"type": "string", "description": "稳定不变的最终目标，必须自包含、可独立理解。"},
                "workspace_dir": {"type": "string", "description": "作为唯一事实来源的工作目录绝对路径。"},
                "max_rounds": {"type": "integer", "description": "轮次上限，默认 16，硬上限 32。"},
                "round_timeout_seconds": {"type": "integer", "description": "单轮子智能体墙钟上限，默认 1200。"},
            },
            "required": ["objective", "workspace_dir"],
            "additionalProperties": False,
        },
    },
}
```

同时在 `agenticx/runtime/meta_tools.py::dispatch_meta_tool_async`（L2568）中追加 `if name == "fresh_round_loop":` 分支（与 L2575 的 `spawn_subagent` 分支同级）。

注册与门禁：
- `agenticx/cli/agent_tools.py` 的 meta 工具名单（`spawn_subagent` 在 L2425 附近）追加 `"fresh_round_loop"`。
- `agenticx/studio/server.py` L5271 那张 `{"spawn_subagent": "meta", ...}` 映射追加 `"fresh_round_loop": "meta"`。**只在该 dict 内加一个键**，禁止改动该文件其它内容与 import 区。
- `fresh_round_loop_enabled()`（见子规划 01 FR-0，默认 **False**）为假时，该工具不注入工具表；若被强行调用则返回 `{"ok": false, "error": "disabled"}`。

### FR-2 循环语义（不变量）

1. 轮次 `n` 的子智能体 task 内容 = `objective` + `workspace_dir` + **仅上一轮的 handoff report**；不得包含父会话 `chat_history` / `agent_messages` 的任何片段。
2. 调用 `spawn_subagent` 时显式传 `workspace_dir`、`run_timeout_seconds`、`mode="run"`、`cleanup="keep"`、`parent_agent_id="meta"`，并传自定义 `system_prompt`（内含 handoff 契约说明）以避免默认父上下文注入路径。若实现中发现 `spawn_subagent` 仍会注入父上下文摘要，**在本子规划内新增一个显式关闭参数**（如 `inherit_parent_context: bool = True`，默认保持现状），不得修改其默认行为。
3. handoff report 契约（子智能体最后一条输出中必须包含的 JSON 块）：

```json
{"status": "continue|complete|blocked", "summary": "...", "evidence": ["..."], "next_steps": ["..."], "blocker": "..."}
```

4. 终止条件：`status == "complete"`（成功）/ `status == "blocked"`（带 blocker 返回）/ 轮次达 `max_rounds`（返回 `budget_limited`）/ 子智能体启动失败（返回其 error）。
5. handoff 超长（序列化后 > 8000 字符）→ **拒绝并要求该轮重发一次精简版**，最多重试 1 次，之后按 `blocked` 结束；不做静默截断。
6. 解析不出 JSON 块 → 同 5 的处理路径。
7. 每轮结束后调用 `_persist_or_abort`（子规划 03）或退化为现有 `incremental_persist`，把 handoff 写入会话，保证崩溃后可见已完成轮次。

### FR-3 返回值

```json
{"ok": true, "status": "complete|blocked|budget_limited", "rounds_started": 3, "report": {...}, "workspace_dir": "..."}
```

### FR-4 文档

新增 `docs/guides/fresh-round-loop.md`（中文）：适用场景、与 `longrun` / `project_state` 的分工（前者是同会话窗口复位，后两者是跨任务编排，互补不替代）、如何开启 flag、handoff 契约、成本提示（每轮一个子智能体，默认 16 轮）。

## 4. AC

新建 `tests/test_smoke_fresh_round_loop.py`（打桩 `AgentTeamManager.spawn_subagent`，不起真实子进程）：

- **AC-1**：假子智能体第一轮返回 `status=continue`、第二轮返回 `status=complete`。断言返回 `status == "complete"`、`rounds_started == 2`。
- **AC-2**：断言第二轮传给 `spawn_subagent` 的 `task` 字符串**不包含**第一轮的对话原文（用一个只出现在父会话 `agent_messages` 里的哨兵字符串断言 `not in`），且**包含**第一轮 handoff 的 `summary`。
- **AC-3**：所有轮次的 `spawn_subagent` 调用参数中，父上下文继承为关闭状态（若 FR-2.2 新增了参数，断言其为 `False`；否则断言 task/system_prompt 中不含父历史哨兵）。
- **AC-4**：handoff 序列化后 > 8000 字符 → 该轮被要求重发一次；仍超长则整体返回 `status == "blocked"`，且**不出现**静默截断（断言返回的 report 未被裁剪成 8000 字）。
- **AC-5**：假子智能体永远返回 `continue` → 轮次停在 `max_rounds`（传 3 时 `rounds_started == 3`），返回 `status == "budget_limited"`。
- **AC-6**：`max_rounds` 传 999 时被夹到硬上限 32。
- **AC-7**：`AGX_FRESH_ROUND_LOOP` 未设置（默认关闭）时，工具不出现在会话可用工具表里；显式调用返回 `error == "disabled"`。
- **AC-8**：既有 `tests/` 中与 meta 工具注册、`spawn_subagent` 相关的测试全绿。
- **AC-9**：改过 `agenticx/studio/server.py` → 冷启动 `agx serve` 验证（同子规划 03 FR-5）。

## 5. 风险

- **成本爆炸**：默认 `max_rounds = 16`、硬上限 32（远小于上游默认值），且工具默认关闭。
- **与现有编排职责重叠**：文档中显式划清边界；不把它接进 `longrun` 的默认路径。
- **命名合规**：工具名、日志、事件、commit 文案统一用 `fresh_round_loop` / 「上下文复位循环」，不得出现上游工具品牌名。
- 回滚：`AGX_FRESH_ROUND_LOOP` 保持关闭即完全不影响现有行为。
