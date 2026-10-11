# OpenMuse-02 · Turn Abort vs Durable Handles

Planned-with: Auto (Composer)
Suggested-Impl-Model: Codex 中档（跨 Studio/runtime 收口）
Plan-Id: 2026-10-01-openmuse-02-turn-abort-vs-durable
Plan-File: `.cursor/plans/2026-10-01-openmuse-02-turn-abort-vs-durable.plan.md`（Wave B：01 完成后再移到 `.cursor/plans/` 根目录）
Parent-Plan: `2026-10-01-openmuse-selective-adopt-master`
Depends-on: `2026-10-01-openmuse-01-durable-job-lease`（API 稳定后开工）
Source-SHA: `d0b3a6b` · OpenMuse `ConversationAgent` browserAbort vs `delegate_task`

> **For Claude:** Use executing-plans. Do not start until 01 merged or its public API exists on the branch. Do not commit unless asked.

**Goal:** 用户停止当前聊天回合时，只取消 **turn-scoped** 工具（含进行中的 near_browser / MCP），不取消已创建的 **durable job**；提供显式 `cancel_durable_job` 才取消后台活。

**Architecture:** 在会话层维护 `turn_abort_event`（或等价 Cancel scope）；`create_durable_job` / `delegate_task` 类工具返回 `job_id` 后与 turn abort 解耦。Studio stop/cancel 端点只信号 turn scope；DurableJobWorker 仅响应 control API。

**Tech Stack:** asyncio.Event / CancelledError 边界、Studio SSE cancel、pytest。

---

## In scope

- 文档化并实现两套句柄：`turn_id` abort vs `durable_job_id` cancel
- Studio：停止生成 → abort 当前 run 工具；不断开已 queued durable jobs
- Meta/工具：新增或明确 `cancel_durable_job`（可映射 01 的 control）
- 测试：stop 后 job 仍在 store；显式 cancel 后 job=cancelled

## Out of scope

- 重做 Desktop 停止按钮视觉
- 改变群聊路由 / 分身委派业务语义（仅对齐「已入队耐久活不被 turn stop 杀掉」）
- ActionProposal UI

---

## 根因与证据

| 侧 | 事实 |
|---|---|
| OpenMuse | `conversation.ts`：`browserAbort.abort()` 只打聊天工具；`delegate_task`→`createTask` 后不受 unsubscribe 取消 |
| AgenticX | 会话取消常与 runtime cancel 绑在一起；automation/`schedule_task` 生命周期与聊天 stop 边界不清 |

---

## FR / AC

| ID | 需求 | AC |
|---|---|---|
| FR-1 | turn abort 取消进行中的同步工具等待 | 单测/集成：mock tool 收到 cancel |
| FR-2 | turn abort 不调用 `DurableJobStore.control(..., cancel)` | `test_turn_abort_leaves_durable_job` |
| FR-3 | 显式 cancel durable job 生效 | `test_explicit_cancel_durable_job` |
| FR-4 | 工具/文档字符串写明两套语义 | agent_tools 或 meta_tools 描述含 durable 不受 stop 影响 |

---

## 落点

- Modify: `agenticx/runtime/agent_runtime.py` — cancel 路径只清 turn；查找现有 cancel/abort 钩子精确改（实施前 `rg -n "cancel|abort|CancelledError" agent_runtime.py`）
- Modify: `agenticx/studio/server.py` — **仅精确增删目标行**；chat cancel 处理不触达 durable store.cancel；改后必须冷启动 smoke（`/api/session` 200）
- Modify: `agenticx/cli/agent_tools.py` 或 `meta_tools.py` — 暴露/澄清 durable cancel
- Test: `tests/test_turn_abort_vs_durable.py`

### before/after 意图

```text
before: stop chat ≈ cancel everything related to session vaguely
after:  stop chat → turn_abort.set()
        durable jobs continue until control(cancel) or terminal status
```

---

## 实施步骤

1. 确认 01 导出：`DurableJobStore.create` / `control`
2. 红测：create job → turn_abort → assert status still queued/running
3. 改 runtime/studio cancel 边界
4. 绿测 + server.py smoke（若改了 server）

---

## 风险

- 误把分身委派后台任务全部改成 durable（范围蔓延）→ 本 plan 只保证：**新 durable API 创建的 job** + automation 桥接 job；既有 `delegate_to_avatar` 行为默认不动，除非测试证明 stop 会误杀且用户确认要修。
