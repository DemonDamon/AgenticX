---
module_id: reliability
module_name: Reliability
roots:
  - agenticx/reliability
summary_schema: code-module-summaries/v1
---

# AgenticX Reliability 模块总结

> 结论生成时间：2026-09-18（首次创建，覆盖 `30e57496990b0e2acb18978091d9e623210eaba3`）

## 模块概述

Reliability 是与 Studio/CLI **解耦** 的工具调用身份、耐久账本与崩溃重放决策内核。包头明确禁止 `agenticx.studio` / `agenticx.cli` 导入。`ReActAgent`（`agents.react_agent_async`）通过可选 `run_store` / `call_ledger` 接入；Runtime 的 `replay_ledger` 与 `tools.base.BaseTool.effect_class` 复用同一套副作用分类与 veto。

Explicit non-responsibilities：不实现 Studio 会话恢复、不写 `messages.json`、不做 LLM 调用；`reliability_posture()` 只是对 `runtime.harden_flags.reliability_posture` 的再导出。

## 目录结构

```
agenticx/reliability/
├── __init__.py          # 公共导出 + reliability_posture()
├── call_identity.py     # 规范化参数 / canonical_key / stable_call_id
├── call_ledger.py       # 每会话 append-only 账本 + 对账 Verdict
├── errors.py            # ReliabilityError / LedgerCorruptError / ToolCallIdentityError
├── replay_policy.py     # decide_replay() 分层 veto
└── run_state.py         # RunState / RunStateStore（无 Studio 依赖）
```

## 核心组件

### 调用身份（call_identity.py）

- `canonical_payload(arguments)`：规范化 JSON；NaN/Inf 抛 `ValueError`，不支持的类型抛 `TypeError`。
- `canonical_call_key(tool_name, arguments)`：工具名 + 规范化参数的稳定键。
- `stable_call_id(...)`：可复现的调用 id。
- `diff_canonical_fields(old, new)`：对账时指出哪些字段变了。

### CallLedger（call_ledger.py）

每会话一份 append-only 账本（路径经 `agx_home()`，session_id 禁止 `..`/`/`）。

- `CallState`：`dispatched` / `completed` / `failed`。
- `Verdict`：`FRESH` / `REPLAY_SKIP` / `AMBIGUOUS` / `IDENTITY_CONFLICT`。
- `reconcile(call_id, tool_name, arguments)`：同 id 参数不一致 → `IDENTITY_CONFLICT`（`ToolCallIdentityError`）；已完成可跳过重跑 → `REPLAY_SKIP`。
- 写失败不吞掉；损坏文件抛 `LedgerCorruptError`。

### RunState / RunStateStore（run_state.py）

与 `runtime.checkpoint.AgentCheckpoint` 不同：无 Studio 依赖，写失败必抛。

- `RunState`：`run_id` / `session_id` / `query` / `messages` / `iteration` / `phase`（`before_llm` | `tools_dispatched` | `completed` | `interrupted`）/ `pending_calls`。
- `RUN_STATE_SCHEMA_VERSION = 1`。
- `RunStateStore`：按 session 原子写 JSON（`atomic_write_json`）。

### 重放策略（replay_policy.py）

`decide_replay(ReplayRequest) -> ReplayDecision`，先命中先返回：

| 条件 | action | veto |
|------|--------|------|
| ledger `IDENTITY_CONFLICT` | `abort` | `identity_conflict`（授权也忽略） |
| 输出已发给用户 | `mark_unknown` | `output_already_emitted` |
| 流式 + AMBIGUOUS | `mark_unknown` | `streaming_request` |
| `effect_class` 为 `external_write` / `unknown` / `local_write` | 软否决 | 对应 `*_side_effect` |
| `REPLAY_SKIP` | `skip_use_recorded` | — |
| 其余 FRESH | `replay` | — |

`approve_unsafe_replay=True` 不能覆盖 identity / 已输出否决。

## 依赖

- Upstream：`agents.react_agent_async.ReActAgent`（`aresume` / `_enforce_call_identity`）、`evaluation.reliability_runner`、`tools.base.resolve_effect_class`。
- Downstream：`agenticx.utils.agx_home` / `atomic_writer`；姿势查询回读 `runtime.harden_flags`。
