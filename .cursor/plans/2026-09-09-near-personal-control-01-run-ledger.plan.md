# 子计划 01：统一委派运行账本

Planned-with: GPT-5.6 Sol
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast
Parent-Plan: `.cursor/plans/pending/2026-09-09-near-personal-agent-control-plane-master.plan.md`
Plan-Id: 2026-09-09-near-personal-control-01-run-ledger

> **For implementer:** 使用 executing-plans 逐任务实施。只改本计划列出的符号；先写失败测试。禁止重构 TeamManager、禁止改 Desktop 信息架构、禁止改 `agenticx/studio/server.py` 顶部 import 区。不要 commit，除非用户明确要求。

**Goal:** 让 spawn 与真实分身 delegate 的状态、activity、artifact 在重启前后都以 `SubAgentRunStore` 为唯一可信账本；内存对象只做实时 overlay，不再由 API 和 Meta 工具各自拼一套 fallback。

**Architecture:** 新增只读 resolver，先读 `SubAgentRunStore(owner_session_id)`，再合并同 owner session 的活跃内存状态；dispatch 接受 delegate 后立即 open run，cancel 同步写账本。`/api/subagents/status` 与 `query_subagent_status` 都调用 resolver。旧 scratchpad/chat-history 只保留标记为 legacy 的最后兜底，本计划不删除兼容数据。

**Tech Stack:** Python、dataclass/JSON/JSONL、pytest、FastAPI 现有 handler。

---

## In scope

- `SubAgentRunStore` 作为 spawn/delegate canonical run ledger。
- 新增 `agenticx/runtime/subagent_runs/resolver.py`。
- delegate dispatch 接受后立即创建 `kind=delegate` run，消除后台 task 启动前的可见性空窗。
- delegate cancel 把 canonical run 更新为 `cancelled`。
- `/api/subagents/status` 改为 store-first + live overlay。
- `query_subagent_status` 改为 resolver-first。
- 保持 owner session 严格隔离。
- 保持现有 `/api/subagent/run`、activity、artifact、cluster API 响应兼容。

## Out of scope

- Redis/远程/多副本 run store。
- 删除 `AgentTeamManager._agents`、`_archived_agents`、`_tasks`。
- 删除 `_delegation_info`、scratchpad 或 chat-history 兼容字段。
- delegate retry 语义。
- Observation Ledger、Personal Eval、User Constitution。
- Desktop 新页面或视觉重塑。
- `server.py` import 区、`electron/main.ts`、`enterprise/`。

---

## 根因与证据

当前至少有三份运行状态：

1. `SubAgentRunStore`：`~/.agenticx/sessions/<owner_session_id>/subagent_runs/`，持久化 run、activity、artifact。
2. spawn 内存：`AgentTeamManager._agents/_archived_agents/_tasks`。
3. delegate 内存：avatar managed session 的 `_delegation_info/_delegation_task/_delegation_cancel_event`。

`agenticx/studio/server.py::subagents_status` 会手工扫描 `manager._sessions` 的 `_delegation_info`；`agenticx/runtime/meta_tools.py::query_subagent_status` 依次尝试 TeamManager、global registry、avatar session、scratchpad、chat history，却不先查磁盘 run store。冷启动后可能出现详情 API 看得到 run、状态 API 看不到，或内存旧值覆盖持久化终态。

已有可复用基础：

- `agenticx/runtime/subagent_runs/store.py::SubAgentRunStore`
- `agenticx/studio/subagent_review.py::collect_memory_status_map`
- `agenticx/studio/subagent_review.py::merge_run_record_with_memory`
- `AgentTeamManager._run_store_open/_run_store_append/_run_store_close`
- delegate 运行函数已在启动后写 `kind=delegate` run

本计划只统一读写时序和解析入口，不更换存储格式。

---

## 数据与合并契约

### Canonical record

继续使用 `agenticx/runtime/subagent_runs/contracts.py::RunRecord`，不得新建重复 DTO。

关键字段：

```python
run_id: str
kind: str  # "spawn" | "delegate"
owner_session_id: str
status: str
updated_at: float
avatar_id: str | None
avatar_session_id: str | None
source_tool_call_id: str
detail_refs: dict[str, Any]
```

### 状态优先级

`resolve_run`/`list_resolved_runs` 必须遵守：

1. 磁盘 record 提供身份、归属、历史、终态与冷启动结果。
2. 仅当 live row 的 `status` 属于 `running|pending|awaiting_confirm|awaiting_input`，或 `live.updated_at >= record.updated_at` 时，才允许 overlay。
3. 磁盘为 `completed|failed|cancelled|paused` 且时间更新时，旧内存不得改回 running。
4. `owner_session_id` 不匹配直接不可见，不允许 cross-session fallback。
5. scratchpad/chat-history 只在 store 与 live 都无记录时返回，并加 `source="legacy_fallback"`。

### API 兼容

`GET /api/subagents/status` 继续返回：

```json
{
  "ok": true,
  "subagents": [],
  "count": 0
}
```

每行保留现有字段；允许新增：

```json
{
  "source": "ledger",
  "delegation": true
}
```

禁止删除前端当前读取的 `agent_id/name/role/task/status/result_summary/error_text/output_files/avatar_id/avatar_session_id`。

---

## 现状锚点

| 路径 | 符号/锚点 | 本计划动作 |
|---|---|---|
| `agenticx/runtime/subagent_runs/store.py` | `SubAgentRunStore` L27 起 | 复用，除非 resolver 需要一个纯读取 helper；禁止改文件格式 |
| `agenticx/runtime/subagent_runs/contracts.py` | `RunRecord` | 复用 `to_dict/from_dict` |
| `agenticx/studio/subagent_review.py` | `collect_memory_status_map`、`merge_run_record_with_memory` | 提取/复用 overlay 规则，不复制第三份 |
| `agenticx/runtime/team_manager.py` | `_run_store_open/_append/_close` 约 L1196–1258 | 保持 spawn 写链 |
| `agenticx/runtime/meta_tools.py` | `_run_delegation_in_avatar_session` L2000 起 | 保持运行期 activity/close |
| 同上 | `delegate_to_avatar` 分支约 L3449–3628 | 后台 task 前同步 open delegate run |
| 同上 | `cancel_subagent` 分支约 L2846–2878 | delegate cancel 后更新 store |
| 同上 | `query_subagent_status` 分支约 L2890–3017 | 改 resolver-first，legacy last |
| `agenticx/studio/server.py` | `cancel_subagent` handler 约 L4625–4666 | 只改 handler body（若 Meta dispatch 已覆盖则不重复写） |
| 同上 | `subagents_status` handler 约 L4668–4758 | 调 resolver；移除 handler 内重复 merge |
| 同上 | `subagent_run_detail` 约 L4881–4905 | 保持响应兼容 |

---

## FR-01-1：新增统一 resolver

**Files:**

- Create: `agenticx/runtime/subagent_runs/resolver.py`
- Modify: `agenticx/runtime/subagent_runs/__init__.py`
- Create: `tests/test_subagent_run_resolver.py`

### 接口写死

```python
def list_resolved_runs(
    owner_session_id: str,
    *,
    session_manager: Any | None = None,
    team_manager: Any | None = None,
    include_legacy: bool = False,
) -> list[dict[str, Any]]:
    ...


def resolve_run(
    owner_session_id: str,
    run_id: str,
    *,
    session_manager: Any | None = None,
    team_manager: Any | None = None,
    include_legacy: bool = False,
) -> dict[str, Any] | None:
    ...
```

实现要求：

- 先 `SubAgentRunStore(owner_session_id).list_runs()/get_run()`。
- 用现有 memory status 合并规则；若需支持 delegate overlay，把扫描 `_delegation_info` 封装在 resolver 内，不留在 API handler。
- 去重键唯一为 `run_id`。
- 返回排序 `(created_at, run_id)`。
- 空 `owner_session_id` 返回空列表/None，不扩大到全局目录。
- 不在 resolver 中写盘。

### TDD / AC

`tests/test_subagent_run_resolver.py` 先写：

- `test_list_resolved_runs_reads_cold_start_delegate_from_disk`
- `test_list_resolved_runs_merges_live_spawn_overlay`
- `test_resolve_run_keeps_newer_terminal_ledger_status`
- `test_resolver_deduplicates_store_and_delegate_memory`
- `test_resolver_never_leaks_other_owner_session`
- `test_empty_owner_session_does_not_read_global_store`

运行：

```bash
pytest tests/test_subagent_run_resolver.py -q
```

首次预期：FAIL，无法 import resolver。实现后全绿。

---

## FR-01-2：delegate 接受即开账本

**Files:**

- Modify: `agenticx/runtime/meta_tools.py` 的 `delegate_to_avatar` dispatch 分支
- Modify: `tests/test_smoke_subagent_run_store.py`

### Before

当前 run 主要在 `_run_delegation_in_avatar_session` 已进入后台运行后创建，dispatch 返回与后台 task 真正启动之间存在空窗。

### After

在已经得到：

- `delegation_id`
- `owner_session_id/from_session`
- `avatar_config`
- `avatar_managed.session_id`
- `source_tool_call_id`

且创建 background task **之前**：

```python
SubAgentRunStore(owner_session_id).open_run(
    run_id=delegation_id,
    kind="delegate",
    name=avatar_name,
    role=avatar_role or "delegated avatar",
    task=task,
    status="pending",
    provider=provider_name,
    model=model_name,
    persona=avatar_system_prompt,
    avatar_id=avatar_id,
    avatar_session_id=avatar_managed.session_id,
    source_tool_call_id=source_tool_call_id,
    detail_refs={
        "avatar_messages_path": str(...),
        "scratchpad_key": f"delegation_result::{delegation_id}",
    },
)
```

后台 `_run_delegation_in_avatar_session` 再次 `open_run(status="running")` 必须保留原 `created_at/status_history`；现有 store 已支持 overwrite with history，禁止另造 upsert。

### AC

扩展 `tests/test_smoke_subagent_run_store.py`：

- `test_delegate_dispatch_opens_pending_run_before_background_execution`
- 断言 dispatch 返回后无需等待 runtime，owner store 已有 `kind=="delegate"`、`status=="pending"`。
- 后台进入后 status history 顺序为 pending → running。
- `avatar_session_id` 与 managed session 一致。

运行：

```bash
pytest tests/test_smoke_subagent_run_store.py -q
```

---

## FR-01-3：取消 delegate 必须写 canonical ledger

**Files:**

- Modify: `agenticx/runtime/meta_tools.py::cancel_subagent`
- Modify: `tests/test_meta_tools.py`

实现要求：

- 取消 `_delegation_cancel_event` / `_delegation_task` 后，以 owner session 创建 store。
- 调 `update_status(run_id, status="cancelled", completed_at=time.time())`。
- 若 run 不存在，兼容旧会话：先根据 `_delegation_info` 补 `open_run`，再更新 cancelled；不得抛 500。
- 重复 cancel 返回幂等结果，磁盘只保留一个最终 cancelled 状态；`status_history` 不重复追加相邻同状态。
- spawn 取消继续走 TeamManager 现有路径。

### AC

- `test_cancel_delegation_updates_run_store`
- `test_cancel_delegation_is_idempotent`
- `test_cancel_spawn_still_uses_team_manager`
- `test_cancel_unknown_run_keeps_existing_not_found_contract`

运行：

```bash
pytest tests/test_meta_tools.py -k "cancel and subagent" -q
```

---

## FR-01-4：状态 API 统一为 ledger-first

**Files:**

- Modify: `agenticx/studio/server.py::subagents_status`，仅 handler body
- Modify: `tests/test_smoke_subagent_review_api.py`

实现要求：

- handler 内 local import resolver，禁止编辑顶部 import 段。
- `owner_session_id` 只能取已校验的请求 session。
- `rows = list_resolved_runs(owner_session_id, session_manager=manager, team_manager=managed.team_manager, include_legacy=False)`。
- 删除/停止使用 handler 内 L4727–4757 手工 `_delegation_info` 扫描，避免重复。
- count 必须等于去重后的 rows 长度。
- run store 读取异常返回已有错误契约，不可默默扩大为全局 fallback。

### AC

- `test_subagents_status_includes_cold_start_delegate_from_ledger`
- `test_subagents_status_deduplicates_live_delegate`
- `test_subagents_status_keeps_owner_session_isolation`
- `test_subagents_status_count_matches_unique_rows`

运行：

```bash
pytest tests/test_smoke_subagent_review_api.py -q
```

修改 `server.py` 后强制冷启动：

```bash
agx serve --host 127.0.0.1 --port 18769
```

另一个终端使用服务实际 token（若启用）验证：

```bash
curl --noproxy '*' -fsS http://127.0.0.1:18769/api/session
curl --noproxy '*' -fsS http://127.0.0.1:18769/api/avatars
curl --noproxy '*' -fsS http://127.0.0.1:18769/api/sessions
```

三者必须 HTTP 200；随后停止临时服务。

---

## FR-01-5：Meta 查询工具走同一 resolver

**Files:**

- Modify: `agenticx/runtime/meta_tools.py::dispatch_meta_tool_async` 的 `query_subagent_status` 分支
- Modify: `tests/test_meta_tools.py`

读取顺序：

1. `resolve_run(owner_session_id, requested_id, ...)` 或 `list_resolved_runs(...)`。
2. store 无数据时才保留现有 scratchpad/chat-history fallback。
3. legacy 返回显式 `source="legacy_fallback"`。

禁止：

- 默认调用 `allow_cross_session_fallback=True`。
- 因 resolver 返回空就扫描所有 `AgentTeamManager._registry`。
- 更改工具 schema/name。

### AC

- `test_query_subagent_status_prefers_ledger_over_stale_scratchpad`
- `test_query_subagent_status_lists_cold_start_runs`
- `test_query_subagent_status_marks_legacy_fallback`
- `test_query_subagent_status_never_crosses_owner_session`

运行：

```bash
pytest tests/test_meta_tools.py -k "query_subagent_status" -q
```

---

## FR-01-6：回归与兼容门禁

以下现有测试必须保持：

```bash
pytest \
  tests/test_subagent_run_resolver.py \
  tests/test_smoke_subagent_run_store.py \
  tests/test_smoke_subagent_review_api.py \
  tests/test_smoke_delegation_paused.py \
  tests/test_meta_tools.py \
  tests/test_team_manager.py \
  tests/test_smoke_trace_parity.py \
  -q
```

必须人工检查：

1. spawn 运行中：状态列表、Run Drawer activity 正常。
2. delegate 发送后立即可见 pending/running。
3. delegate 完成后刷新仍是 completed。
4. 完全重启后，历史 delegate 仍出现在对应 owner session，且不出现在其他 pane。
5. cancel 后聊天气泡、历史状态与 Run Drawer 都显示 cancelled，不出现一处 running、一处 cancelled。

---

## Grok 4.6 执行顺序

1. 只读确认所有锚点仍存在；若行号漂移按函数名定位，不扩大范围。
2. 写 `test_subagent_run_resolver.py`，确认红。
3. 实现 resolver 与 export，确认绿。
4. 写 delegate pending/cancel 红测，再改 `meta_tools.py`。
5. 改状态 API handler 与 API 测试。
6. 改 `query_subagent_status`，legacy fallback 放最后。
7. 跑完整回归。
8. 冷启动 `agx serve` 并验证三个核心 API。
9. 输出改动文件、测试结果、未完成项；没有新 diff 不得声称完成。

### 停止条件

- 若发现 `SubAgentRunStore` 无法表达现有某个状态，只允许向 `RunRecord` 加向后兼容的 optional 字段；先更新本计划/请示，禁止另建第二套 ledger。
- 若 status API 依赖未持久化字段，优先把该字段写进 `detail_refs` 或 `RunRecord`，不得恢复 handler 手工扫描作为主路径。
- 若冷启动核心 API 非 200，立即停止后续计划，先修复本计划引入的启动回归。

---

## 成本边界

- 预计规模：M（2 个核心 Python 模块 + 2 个接线点 + 4 类测试；不做 UI）。
- 单计划单分支、单 PR；不得与计划 02 权限边界一起实施。
- 本计划通过后才允许启动计划 02/03。
- 不需要更强模型；Grok 4.6 足够，但必须严格按上述 TDD 顺序，禁止一次性重写 `meta_tools.py` 大段代码。
