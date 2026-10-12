# OpenMuse-01 · Durable Job Lease

Planned-with: Auto (Composer)
Suggested-Impl-Model: Composer 2.5 或 Codex 中档（后端 SQLite + 状态机）
Plan-Id: 2026-10-01-openmuse-01-durable-job-lease
Plan-File: `.cursor/plans/2026-10-01-openmuse-01-durable-job-lease.plan.md`
Parent-Plan: `2026-10-01-openmuse-selective-adopt-master`
Source-SHA: `d0b3a6b` · OpenMuse `TaskWorker` / `Store.compareAndSwap`

> **For Claude:** Use executing-plans. TDD. Do not commit unless user asks. Do not touch Desktop Clarification UI, ActionProposal module, or near_browser SSRF logic.

**Goal:** 为 AgenticX 提供跨进程可恢复的 durable job 租约领取/心跳/取消，先服务 automation 与显式后台活，不替换会话内 `AgentRuntime`。

**Architecture:** 新建 `agenticx/runtime/durable_jobs/`：SQLite 表存标量状态 + `lease_id`/`lease_until`；CAS 用 **列相等**（禁止 JSON `@>` 数组语义）。`TaskScheduler` 内存调度器保留给进程内短任务；automation 执行入口在 claim 成功后跑 handler。

**Tech Stack:** Python sqlite3、pytest、可选接入既有 `~/.agenticx/` 目录。

---

## In scope

- `DurableJobStore`：create / claim / heartbeat / checkpoint / complete / fail / control(pause|resume|cancel|retry)
- 不变量：取消先改状态清 lease，再 abort 内存 handler；丢租约收尾 CAS 必须匹配原 `lease_id`+`running`，否则 no-op（对齐 OpenMuse Q-01）
- 单测：双 worker 只跑一次；cancel-wins；过期 lease 可被另一 worker 领取
- 与 `automation_tasks.json` 的**最小**桥：执行一次触发时写入/更新 durable job 行（可选字段 `automation_task_id`）；不重做 cron UI

## Out of scope

- 改 `AgentRuntime` 主循环、Desktop 审批 UI、ActionProposal、choice panels、near_browser
- 重写 `_automation_tasks_io` 存储后端切换逻辑
- 照搬 OpenMuse 整表 `records(jsonb)`

---

## 根因与证据

| 证据 | 内容 |
|---|---|
| OpenMuse | `apps/server/src/engine/worker.ts:116-248` 租约 CAS；cancel 后旧 worker 不能 requeue |
| AgenticX | `agenticx/runtime/task_scheduler.py:43-111` 仅内存 `asyncio.Task`，进程死即丢 |
| AgenticX | `desktop/electron/main.ts:1257` `AutomationScheduler` 每 30s tick，无跨进程 lease |
| AgenticX | `agenticx/runtime/_automation_tasks_io.py` JSON 列表，无 claim 语义 |

---

## FR / AC

| ID | 需求 | AC |
|---|---|---|
| FR-1 | 可 create job（queued） | `tests/test_durable_jobs_lease.py::test_create_queued` |
| FR-2 | claim 用 CAS：仅 queued/scheduled/过期 running | `test_claim_exclusive`：两线程 claim 同一 id，仅一成功 |
| FR-3 | heartbeat 延长 `lease_until`，lease 不匹配则失败并触发 abort 回调 | `test_heartbeat_lost_aborts` |
| FR-4 | control(cancel)：成功后 in-flight handler 的「改回 queued」CAS 失败 | `test_cancel_wins_over_teardown` |
| FR-5 | retry 仅 failed；若将来挂 proposal 且非 succeeded 则拒绝（可先留 hook） | `test_retry_only_failed` |
| NFR-1 | DB 路径默认 `~/.agenticx/durable_jobs.sqlite`，可测时注入 | 单测用 tmp_path |
| NFR-2 | 不修改 `server.py` import 区（本 plan 无需新 HTTP，除非用户后续要求） | diff 不含 `server.py` |

---

## 落点与 before/after

### 新建

- `agenticx/runtime/durable_jobs/__init__.py`
- `agenticx/runtime/durable_jobs/store.py` — `DurableJobStore`
- `agenticx/runtime/durable_jobs/worker.py` — `DurableJobWorker`（poll + 内存 active map）
- `agenticx/runtime/durable_jobs/models.py` — 状态枚举与 dataclass
- `tests/test_durable_jobs_lease.py`

### 最小接线（可选但推荐）

- Modify: `agenticx/runtime/_automation_tasks_io.py` — 仅增加注释或 helper `attach_durable_job_id`，**不要**改 JSON schema 破坏 Desktop 读取；若加字段必须可选。

### Schema 意图（伪代码）

```sql
CREATE TABLE durable_jobs (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  lease_id TEXT,
  lease_until REAL,
  attempts INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  error TEXT,
  updated_at REAL NOT NULL
);
-- claim:
UPDATE durable_jobs SET status='running', lease_id=?, lease_until=?, attempts=attempts+1
WHERE id=? AND status IN ('queued','scheduled')
   OR (status='running' AND lease_until < ?);
```

**禁止**用「整段 JSON 包含」做数组乐观锁。

### Worker 收尾意图

```python
# on LostLease or abort:
store.compare_swap(id, expect={"status":"running","lease_id": mine}, patch={"status":"queued","lease_id": None})
# if control(cancel) already set status=cancelled and lease_id=None → rows=0 → OK no-op
```

---

## 实施步骤（TDD）

1. 写 `test_claim_exclusive` / `test_cancel_wins_over_teardown`（先红）
2. 实现 `store.py` + 内存假 clock
3. 实现 `worker.py` tick（最多 N 并发，默认 3）
4. 绿测；补充 heartbeat / retry 测
5. 若接线 automation：只加可选字段文档字符串，不改 Electron 除非必要

---

## 风险

- 与 reliability `CallLedger` 混淆：本模块管 **job 生命周期**，不管 tool-call 身份。
- Desktop 与 Python 双写 automation JSON：本 plan 不解决双写，只加 lease 层。
