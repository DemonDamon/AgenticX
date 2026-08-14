# SP1: Graph Runtime Core（WorkGraph + 四态 + DAG 调度接线）

Planned-with: Cursor Grok 4.5
Suggested-Impl-Model: Cursor Grok 4.5
Parent: `.cursor/plans/2026-07-30-near-graph-godview-master.plan.md`

**Goal:** 在 Studio 运行时落地可持久化的 WorkGraph 与 DAG 调度器，并把群聊 Workforce 执行从「线性 for」改为「按 depends_on 并行 ready 集」；Meta spawn/分解路径可挂到同一 GraphRun。

**Architecture:** 新建 `agenticx/runtime/graph/` 包：models + store + compiler + scheduler。`GroupChatRouter._run_team_turn` 在 assign 之后走 scheduler，而不是 `for subtask in subtasks`。单节点任务编译为单节点图（自环 loop 语义保留在 AgentRuntime 内）。

**Tech Stack:** Python 3.11+、asyncio、既有 AgentRuntime / Workforce 规划层、json 文件持久化。

---

## 根因与证据

1. `agenticx/runtime/group_router.py` `_run_team_turn` 约 L1673：`for subtask in subtasks:` **顺序**执行。
2. `agenticx/collaboration/workforce/workforce_pattern.py` `_execute_subtasks` 已有 ready+并行逻辑（约 L394–428），但群聊路径 **不调用** 它（ADR 0002：禁止走 AgentExecutor 执行栈）。
3. `agenticx/runtime/task_decomposer.py` 提供 `depends_on` / ready 思想，**全仓库主路径零消费**。

---

## In Scope / Out of Scope

### In Scope

- `agenticx/runtime/graph/` 核心模型与调度
- 接线 `_run_team_turn` 使用 scheduler
- Meta 路径：可选——当 `TaskDecomposer.evaluate` 决定分解时创建 GraphRun（最小：暴露 API 供后续；若本 PR 时间紧，至少群聊 team 路径完整）
- 冒烟测试：DAG 两路并行、依赖阻塞、单节点退化

### Out of Scope

- intervene API（SP2）
- Desktop UI（SP3）
- 直接调用 `WorkforcePattern.execute()`
- 改 `collaboration/patterns.py` 大框架
- Memory 向量检索改造

---

## 数据模型（精确）

### 文件：`agenticx/runtime/graph/models.py`（新建）

```python
#!/usr/bin/env python3
"""WorkGraph models for Near Graph Runtime.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class NodeKind(str, Enum):
    AGENT = "agent"          # avatar / meta
    SPAWN = "spawn"          # sa-*
    TASK = "task"            # workforce subtask
    HUMAN = "human"          # approval placeholder
    REVIEW = "review"


class NodeStatus(str, Enum):
    PENDING = "pending"
    READY = "ready"
    RUNNING = "running"
    BLOCKED = "blocked"      # confirm / clarify
    PAUSED = "paused"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"
    SKIPPED = "skipped"


class EdgeKind(str, Enum):
    DEPENDS = "depends"      # work DAG
    MESSAGE = "message"      # A2A chat
    ARTIFACT = "artifact"    # produced→consumed
    DELEGATE = "delegate"


@dataclass
class GraphNode:
    id: str
    kind: NodeKind
    label: str
    status: NodeStatus = NodeStatus.PENDING
    agent_id: Optional[str] = None       # avatar_id / __meta__ / sa-*
    task_text: str = ""
    directives: List[str] = field(default_factory=list)  # I1/I2 append/retract log
    retry_count: int = 0
    meta: Dict[str, Any] = field(default_factory=dict)


@dataclass
class GraphEdge:
    id: str
    kind: EdgeKind
    source: str
    target: str
    label: str = ""
    meta: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RunState:
    current_nodes: List[str] = field(default_factory=list)
    branch: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ArtifactRef:
    id: str
    node_id: str
    kind: str          # spec|diff|report|note|other
    path_or_uri: str
    summary: str = ""


@dataclass
class EvidenceRef:
    id: str
    node_id: str
    kind: str          # source|trace|log|approval
    payload: Dict[str, Any] = field(default_factory=dict)


@dataclass
class MemoryPointer:
    namespace: str
    key: str
    # Do NOT inline long-term blobs into RunState


@dataclass
class GraphRun:
    run_id: str
    session_id: str
    group_id: Optional[str]
    nodes: Dict[str, GraphNode]
    edges: List[GraphEdge]
    run_state: RunState = field(default_factory=RunState)
    artifacts: List[ArtifactRef] = field(default_factory=list)
    evidence: List[EvidenceRef] = field(default_factory=list)
    memory_pointers: List[MemoryPointer] = field(default_factory=list)
    status: str = "open"  # open|paused|closed
    version: int = 1
```

持久化目录：`~/.agenticx/graph_runs/<run_id>/run.json`（原子写：tmp+replace）。

---

## Compiler

### 文件：`agenticx/runtime/graph/compiler.py`（新建）

**职责：** 把 Workforce 分解结果编译为 `GraphRun`。

**输入（来自 `_run_team_turn`）：**

- `session_id`, `group_id`
- `subtasks: List[{id, description, dependencies?}]`
- `assignment_map: Dict[subtask_id, agent_id]`

**规则：**

1. 每个 subtask → `GraphNode(kind=TASK, agent_id=assignee)`
2. 每个 dependency → `GraphEdge(kind=DEPENDS, source=dep, target=task)`
3. 无依赖节点初始 `status=READY`，有依赖为 `PENDING`
4. 若 subtasks 的 `dependencies` 全空：仍建图，全部 READY（可并行）——**这是相对今日线性 for 的行为变化，AC 要求**
5. Workforce XML/对象若 `dependencies` 常为空：compiler 必须尝试从 `task_decomposer` 或 planner 输出读取；若仍空，可在 compiler 内用轻量启发式（仅当描述出现「然后/之后/基于上一步」时串边）——**启发式可选，默认信任 planner 字段；若字段缺失则全并行（比错误串行更符合 Graph 精神）**

**Before（群聊执行）：**

```python
for subtask in subtasks:
    async for reply in self._run_one_target_stream(...):
        yield reply
```

**After：**

```python
run = compile_workforce_run(...)
store.save(run)
async for reply in scheduler.execute_group_run(run, runner=self._run_one_target_stream, ...):
    yield reply  # still GroupReply / workforce events
```

---

## Scheduler

### 文件：`agenticx/runtime/graph/scheduler.py`（新建）

核心循环伪代码：

```python
async def execute_group_run(run, runner, on_event, max_parallel=4):
    while not run_finished(run):
        if run.status == "paused":
            await wait_resume()
            continue
        ready = [n for n in run.nodes.values()
                 if n.status in (READY, PENDING) and deps_satisfied(run, n)]
        for n in ready:
            n.status = READY
        batch = ready[:max_parallel]
        if not batch:
            if any(n.status == RUNNING for n in run.nodes.values()):
                await asyncio.sleep(0.05)
                continue
            break
        async def _one(node):
            node.status = RUNNING
            run.run_state.current_nodes.append(node.id)
            on_event("graph.node_updated", node)
            try:
                async for item in runner(node):
                    yield item
                node.status = DONE
            except Cancelled:
                node.status = CANCELLED
            except Exception:
                node.status = FAILED
            finally:
                on_event("graph.node_updated", node)
                store.save(run)
        # parallel
        async for item in merge_async_generators([_one(n) for n in batch]):
            yield item
```

**落点接线：** `agenticx/runtime/group_router.py` 方法 `_run_team_turn`（约 L1461–1750）：

1. 在 `assign_tasks` 之后、`for subtask in subtasks` 之前插入 compile+schedule。
2. **删除或绕过** 顺序 for（保留函数 `_run_one_target_stream` 作为 runner）。
3. 继续 emit 既有 `workforce.task_*` 事件（兼容 ChatPane），并 **额外** emit 最小 `graph.node_updated`（即便 SP2 再规范化，SP1 先用 dict event 挂到 GroupReply.metadata 或现有 event_type 扩展：`graph.node_updated`）。

**注意：** 群聊工具集仍禁用 `delegate_to_avatar`（现有 `_group_chat_tools` 不变）。

---

## Store

### 文件：`agenticx/runtime/graph/store.py`（新建）

- `GraphRunStore.root = Path.home() / ".agenticx" / "graph_runs"`
- `save(run)`, `load(run_id)`, `list_by_session(session_id)`
- 版本字段 `version` 每次 save +1，供 UI 乐观并发（SP2 用）

---

## Studio 暴露（最小）

### 修改：`agenticx/studio/server.py`

**只精确追加**路由（禁止整段替换 import）：

- `GET /api/graph/runs?session_id=` → 列表
- `GET /api/graph/runs/{run_id}` → 快照

实现委托 `graph.store`，鉴权与其它 `/api/*` 一致（desktop token）。

冷启动验收：`agx serve --host 127.0.0.1 --port <临时>` + curl `/api/session` `/api/graph/runs?session_id=...`。

---

## FR / AC

| ID | 要求 | AC |
|----|------|-----|
| FR-1 | WorkGraph 可持久化 | `tests/test_smoke_graph_runtime_store.py`：save/load 节点边一致 |
| FR-2 | depends_on 阻塞 | 单测：t2 depends t1 时 t2 在 t1 DONE 前不得 RUNNING |
| FR-3 | 无依赖并行 | 单测：两 READY 节点在 fake runner 中启动时间重叠（`asyncio` 事件顺序断言） |
| FR-4 | 群聊 team 走 scheduler | `tests/test_smoke_group_workforce_graph_schedule.py`：mock runner 记录调用序，无依赖时非严格串行门闩 |
| FR-5 | 小任务单节点 | 1 subtask → 1 node 图，status 流转 pending→running→done |
| FR-6 | server 不崩 | 冷启动 + GET runs 200 |

---

## 实施任务（给实施模型）

### Task 1: models + store + 单测

- Create: `agenticx/runtime/graph/__init__.py`, `models.py`, `store.py`
- Test: `tests/test_smoke_graph_runtime_store.py`

### Task 2: compiler + scheduler 单测（不接线 UI）

- Create: `compiler.py`, `scheduler.py`
- Test: `tests/test_smoke_graph_scheduler_dag.py`

### Task 3: 接线 `_run_team_turn`

- Modify: `agenticx/runtime/group_router.py` `_run_team_turn`
- Test: `tests/test_smoke_group_workforce_graph_schedule.py`（可基于现有 `tests/test_smoke_group_workforce_*.py` 模式）

### Task 4: GET API + server smoke

- Modify: `agenticx/studio/server.py`（精确追加）
- Manual: 冷启动 curl

### Task 5: 文档锚点

- Modify: `docs/adr/0002-group-chat-workforce-bridge.md` 追加一节「执行层升级为 Graph Scheduler（仍 Hybrid）」——仅文档，不改决策拒绝项。

---

## 风险

- Workforce planner 不产出 dependencies → 默认全并行可能打爆并发：scheduler 必须尊重 `max_parallel`（默认 2 或 4，可读 `group_chat` / config）。
- 流式 SSE 多路并行时前端消息交错：保持现有 `agent_id` 字段；UI 侧已能按成员分行 progress——不在本 SP 改前端排序。
