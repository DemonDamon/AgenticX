# Sub-Plan A：后端 Sub-Agent Run Store（结构化落盘 + 生命周期钩子记录）

Planned-with: Claude Opus 4.8
Plan-Id: 2026-07-05-subagent-run-store-backend
Plan-File: .cursor/plans/2026-07-05-subagent-run-store-backend.plan.md
父规划: `.cursor/plans/2026-07-05-subagent-cluster-persistence.plan.md`
Suggested-Impl-Model: Codex 5.3 (Medium)（代码专精中档；旁路接线两条链路属高回归风险，需精准改动 + 冒烟测试，不宜降档）

## 1. 需求

### FR（功能需求）

- **FR-1**：新增 `SubAgentRunStore`，为每个派生的子智能体（`spawn_subagent` 与 `delegate_to_avatar` 两条链路统一）持久化一条 **run record**，落盘到 `~/.agenticx/sessions/<owner_session_id>/subagent_runs/`，与 session 生命周期绑定。
- **FR-2**：run record 字段（冻结契约，B/E 消费）：
  - 身份：`run_id`（`spawn` 用 `agent_id=sa-*`；`delegate` 用 `delegation_id=dlg-*`）、`kind`（`"spawn" | "delegate"`）、`owner_session_id`、`avatar_id`、`avatar_session_id`（delegate 才有）。
  - 工牌：`name`、`role`（角色/职责描述）、`persona`（座右铭/人设一句话，来自 avatar `SOUL`/persona_prompt 摘要，可空）、`provider`、`model`、`badge_seq`（该集群内序号 `01/02/…`）、`cluster_id`。
  - 任务：`task`（派生指令原文）、`created_at`、`updated_at`、`started_at`、`completed_at`。
  - 状态：`status`（`pending|running|paused|completed|failed|cancelled`）、`status_history[]`（`{status, ts}` 时间线，用于回看「何时开始/暂停/完成」）、`error_text`、`result_summary`。
  - 活动日志：`activity_log[]`（有界追加，每条 `{seq, ts, type, title, detail?}`，`type ∈ tool_call|tool_result|checkpoint|confirm|clarify|note`，对齐图5 左侧时间线）。
  - 产物：`artifacts[]`（`{path, kind, bytes?, preview?}`）、`result_file`（spawn 的 `subagent_results/<id>.md`）、`output_files[]`。
  - 明细指针（避免大对象冗余）：`detail_refs`（`{avatar_messages_path?, result_md_path?, scratchpad_key?}`）。
- **FR-3**：新增 `cluster` 概念：Meta 在**一次工具轮**内派生的多个子智能体归为一个 `cluster_id`，run record 携带 `cluster_id + badge_seq`，供前端聚合成一张集群卡片。`cluster_id` 由「owner_session_id + 触发工具轮 tool_call 批次」派生（同一 assistant tool 轮内的多次 spawn/delegate 视为同一 cluster）。
- **FR-4**：在两条链路的生命周期关键点**旁路记录**（不改主流程语义）：
  - 创建时：`SubAgentRunStore.open_run(...)` 写入 pending/running + 工牌元数据 + cluster 归组。
  - 运行中：复用既有 `recent_events` / SSE 事件回调，节流（≥3s 或每 N 条）`append_activity(...)` 与 `update_status(...)`。
  - 结束时：`close_run(...)` 落最终 status、result_summary、artifacts、detail_refs。
- **FR-5**：与既有落盘源打通（作为明细真相源）：`detail_refs.result_md_path` 指向 `subagent_results/<id>.md`；delegate 的 `detail_refs.avatar_messages_path` 指向 `~/.agenticx/sessions/<avatar_session_id>/messages.json`；`scratchpad_key` 指向 meta scratchpad 的 `delegation_result::` / `subagent_result::`。
- **FR-6**：提供按 session 查询接口（供 Sub-Plan B）：`list_runs(owner_session_id) -> list[RunRecord]`、`get_run(owner_session_id, run_id) -> RunRecord|None`、`list_clusters(owner_session_id) -> list[{cluster_id, run_ids, title, created_at}]`。
- **FR-7**：冷启动/重启后可从磁盘完整恢复（`SubAgentRunStore` 无内存依赖，纯落盘读写；`AgentTeamManager` 内存清空不影响历史 run 查询）。

### NFR（非功能需求）

- **NFR-1**：写入必须是**旁路容错**——Run Store 任一写失败只 `logger.warning`，绝不冒泡打断 `spawn_subagent` / `delegate_to_avatar` 主流程（对齐既有「子智能体持久化失败不拖垮委派」原则）。
- **NFR-2**：`activity_log` 有界（默认每 run ≤ 500 条，超出保留首 50 + 末 400 + 一条「已省略 N 条」占位），防止长任务撑爆单文件。
- **NFR-3**：写入节流，避免与既有 ≈5s `session_manager.persist` 叠加造成 IO 抖动；活动日志采用**追加写**（append-only JSONL 或增量 patch），不每次全量重写大文件。
- **NFR-4**：不落凭证明文（provider/model 名可存，API key 严禁）。
- **NFR-5**：落盘格式版本化（record 带 `schema_version`），为后续演进留位。

### AC（验收标准）

- **AC-1**：一次派生 3 个子智能体后，`~/.agenticx/sessions/<sid>/subagent_runs/` 下出现 3 条 run record，且共享同一 `cluster_id`、`badge_seq` 为 `01/02/03`。
- **AC-2**：子智能体完成后，其 run record 的 `status=completed`、`status_history` 含 `running→completed` 两个及以上节点、`activity_log` 非空、`result_file`/`output_files` 与既有 `subagent_results/*.md` / avatar 产物一致。
- **AC-3**：`agx serve` 冷重启后，`list_runs(sid)` 仍返回完整历史 run（证明无内存依赖）。
- **AC-4**：故意让 `SubAgentRunStore.append_activity` 抛异常，`spawn_subagent` 仍正常返回、子智能体正常执行完成（旁路容错）。
- **AC-5**：delegate 链路的 run record `detail_refs.avatar_messages_path` 指向真实存在的 avatar `messages.json`。
- **AC-6**：`activity_log` 超过 500 条时按 NFR-2 截断且带省略占位。

## 2. 技术方案

### 2.1 目录结构（新增）

```
agenticx/runtime/subagent_runs/
├── __init__.py            # 导出 SubAgentRunStore, RunRecord, ActivityEntry
├── contracts.py           # RunRecord / ActivityEntry / ClusterInfo dataclass + schema_version
├── store.py               # SubAgentRunStore：open_run / update_status / append_activity / close_run / list_runs / get_run / list_clusters
└── cluster.py             # cluster_id 归组逻辑（按 owner_session + tool 轮批次）
```

落盘布局：

```
~/.agenticx/sessions/<owner_session_id>/subagent_runs/
├── index.json                 # {cluster_id: {run_ids, title, created_at}} + run_id → 元数据摘要
├── <run_id>.json              # RunRecord（不含 activity_log 大数组的正文，只含摘要 + 计数）
└── <run_id>.activity.jsonl    # append-only 活动日志（每行一条 ActivityEntry）
```

> 拆 `<run_id>.json`（元数据，小、频繁读）与 `<run_id>.activity.jsonl`（日志，大、append-only）是为了满足 NFR-3：状态更新只改小 json，日志只追加，互不影响。

### 2.2 contracts.py（核心类型）

```python
#!/usr/bin/env python3
"""Sub-agent run persistence contracts.

Author: Damon Li
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

SCHEMA_VERSION = 1


@dataclass
class ActivityEntry:
    seq: int
    ts: float
    type: str            # tool_call | tool_result | checkpoint | confirm | clarify | note
    title: str
    detail: Optional[str] = None


@dataclass
class RunRecord:
    run_id: str
    kind: str            # "spawn" | "delegate"
    owner_session_id: str
    cluster_id: str
    badge_seq: str       # "01" ...
    name: str
    role: str
    task: str
    status: str
    created_at: float
    updated_at: float
    persona: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    avatar_id: Optional[str] = None
    avatar_session_id: Optional[str] = None
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    status_history: List[Dict[str, Any]] = field(default_factory=list)
    result_summary: Optional[str] = None
    error_text: Optional[str] = None
    result_file: Optional[str] = None
    output_files: List[str] = field(default_factory=list)
    artifacts: List[Dict[str, Any]] = field(default_factory=list)
    detail_refs: Dict[str, Any] = field(default_factory=dict)
    activity_count: int = 0
    schema_version: int = SCHEMA_VERSION
```

### 2.3 接线点（生命周期钩子，旁路）

| 链路 | 位置（现有代码） | 新增旁路调用 |
|---|---|---|
| spawn 创建 | `team_manager.py` `spawn_subagent` L542–573（构建 context 后） | `run_store.open_run(kind="spawn", ...)` + cluster 归组 |
| spawn 运行中事件 | `team_manager.py` `_run_subagent` 内 `recent_events` 追加处 | 节流 `append_activity` + `update_status` |
| spawn 结束 | `team_manager.py` `_run_subagent` `finally`（`_archive_context` 前，L1361–1370） | `close_run(...)`（读 `result_file`/`output_files`/`result_summary`） |
| delegate 创建 | `meta_tools.py` `delegate_to_avatar` 设置 `_delegation_info` 处 L2780–2797 | `run_store.open_run(kind="delegate", ...)` |
| delegate 运行中 | `meta_tools.py` `_run_delegation_in_avatar_session` ≈5s persist 循环 L1782–1826 | 复用该循环节流 `append_activity`（从 avatar 最近 tool 行提炼）+ `update_status` |
| delegate 结束 | `meta_tools.py` 完成回写处 L1886–1929 | `close_run(...)`（`summary`/`output_files`/`detail_refs`） |

> 所有旁路调用包裹 `try/except Exception: logger.warning(...)`（NFR-1）。cluster_id 通过传入的触发 `tool_call_id` 批次或 owner session 上一个「未封口 cluster」推断（`cluster.py`）。

### 2.4 cluster 归组策略（cluster.py）

- Meta 每次进入一轮 assistant tool 调用（可能连发多个 `spawn_subagent`/`delegate_to_avatar`）时，用 `owner_session_id + assistant_turn_id`（若无稳定 turn_id，则用「同一 owner session 内、间隔 < 2s 且尚未封口的派生」聚合窗口）派生一个 `cluster_id`。
- `index.json` 记录 cluster → run_ids 映射与 `title`（title 取该轮 Meta 的意图摘要，可先用 run 的 role 拼接，如「股票分析 · 3 任务」）。
- Sub-Plan E 的锚点消息会引用该 `cluster_id`；若 E 尚未落地，B 的 API 也能按 cluster 聚合返回。

### 2.5 与既有 `_serialize_status` 对齐

`SubAgentRunStore` 的 run record 字段是 `team_manager._serialize_status`（L1064–1107）的**超集 + 持久化**版本：运行态前端仍读 `/api/subagents/status`（内存、实时），历史态读 Run Store（磁盘、持久）。B 会做字段对齐，保证前端一套卡片组件能同时消费两个来源（Sub-Plan C/E 的收敛逻辑）。

## 3. 验收标准与用例

- **用例 1（集群落盘）**：脚本触发 Meta 连发 3 个 `spawn_subagent` → 断言 `subagent_runs/index.json` 有 1 个 cluster、3 个 run_ids、badge_seq 连续。
- **用例 2（时间线）**：单个 spawn 跑一个多工具任务 → 断言 `<run_id>.activity.jsonl` 行数 > 0 且含 `tool_call`/`tool_result` 类型、`status_history` 有序。
- **用例 3（delegate 指针）**：delegate 一个分身任务 → 断言 run record `detail_refs.avatar_messages_path` 文件存在且可读到 tool 行。
- **用例 4（冷重启）**：跑完后重启 `agx serve`，调用 `list_runs(sid)` → 断言返回历史 run 完整。
- **用例 5（容错）**：monkeypatch `append_activity` 抛错 → 断言 spawn 主流程无异常、子智能体完成。
- **冒烟测试**：`tests/test_smoke_subagent_run_store.py`（覆盖用例 1/2/4/5，delegate 用例可 mock avatar session）。

## 4. 风险与资源排期

| 风险 | 等级 | 缓解 |
|---|---|---|
| 接线点侵入两条链路，易触发「严重倒退」 | 高 | 严格旁路：所有调用 try/except 包裹，不改任何既有返回值/控制流；先加钩子跑冒烟，确认主流程 0 回归再上明细 |
| `cluster_id` 归组不准（并行派生跨轮次） | 中 | 优先用稳定 turn_id；无则用时间窗聚合 + 允许 B/E 侧按 owner_session 兜底展示为「散列 run」 |
| activity 追加写与既有 persist IO 叠加抖动 | 中 | append-only JSONL + 节流 ≥3s；元数据与日志分文件 |
| 归档快照剥离大对象导致 close_run 拿不到内容 | 中 | close_run 在 `_archive_context` **之前**调用（L1361–1370 顺序），从原 context 读取 |
| delegate 完成瞬间 `_delegation_info` 内存态可能在最后 persist 前丢失 | 中 | close_run 从 `_delegation_info` + avatar session 双源读取，缺一由另一补 |

**排期**：2.5 人天（0.5 契约与落盘骨架 + 1 spawn 接线 + 0.5 delegate 接线 + 0.5 冒烟测试与回归验证）。**无并行前置**，必须最先完成。
