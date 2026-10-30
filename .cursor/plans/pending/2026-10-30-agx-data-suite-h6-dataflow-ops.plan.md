# AGX Data Suite H6 — DataFlow 调度运维面

> **Parent:** `.cursor/plans/pending/2026-10-30-data-suite-p3-harden.plan.md`  
> **Branch:** `feat/agx-data-suite-h6-dataflow-ops`  
> **Depends on:** H5 merged (`3497e266` / PR #172); **S2-7 巡检 Agent schedule + A8 webhook 已合入 — DO NOT redo。**  
> **Main-repo gate:** 通用平台 DataFlow 作业调度/运维；禁止客户作业内容 / delivery_pack 实体进 `agenticx/`。

**Goal:** 打通「作业绑定 schedule → tick 真实跑一次 → 历史可查 → 重跑/补数/快照回放 → 失败告警」：
1. DataFlow `JobSpec` 绑定 managed-style `schedule` / `schedule_run`（数据作业运维原语，非 MA Agent 会话调度）
2. tick 到期创建 `schedule_run`、调用既有 `run_job`、落历史（status / snapshot_id / error）
3. Admin 专用「数据作业」运维页：作业列表、运行历史、重跑/补数、快照回放入口、失败告警
4. 失败告警复用 A8 `HttpWebhookSink` / `FakeWebhookSink`（不重做巡检）
5. golden-path：schedule 触发 → 跑通一次 → 历史可见 → 重跑成功（pytest + Playwright）

**Inventory（H6 前）**

| 面 | 状态 |
|----|------|
| `jobs/{dsl,runner,scheduler,lineage}.py` | 已有；`DataJobScheduler` 仅本地 cron matcher，**未**绑定 schedule_run / 历史 |
| `tests/data_suite/test_jobs_*.py` + `test_golden_path_job.py` | 已有 runner/DSL/cron；无 ops/历史/重跑 |
| A8 webhook `managed/templates/data_suite/webhook.py` | 已有 Fake/Http；巡检用 |
| S2-7 `schedule_tick.py` / `PatrolScheduleConfig` | **巡检 Agent**；不重做、不混用 UI |
| Admin `agent-schedules` | **Meta-Agent** 会话调度；**不是** DataFlow 作业运维 |
| Admin data-suite jobs ops API/UI | **缺口** |
| `agenticx/managed/` 通用 schedule_run 库 | **无**独立 DataFlow 绑定层（MA 表在 enterprise runtime） |

**Out of scope:** 巡检 Agent 调度；作业 SLA/计费；A9 compute；H7 ID-Mapping；FinnewsHunter；合并本 PR。

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/jobs/ops.py` | `DataJobSchedule` / `DataJobScheduleRun` / `DataJobOpsService`：bind、tick、rerun、backfill、replay、失败 webhook |
| `agenticx/data_suite/jobs/__init__.py` | 导出 ops 符号 |
| `examples/data_suite/golden_path/ops_stage.py` | golden-path 调度运维阶段（绑 schedule → tick → rerun） |
| `tests/data_suite/test_jobs_ops.py` | bind/tick/history/rerun/fail-alert |
| `tests/data_suite/test_golden_path_ops.py` | golden-path schedule→run→history→rerun |
| `enterprise/.../lib/data-jobs-store.ts` | Admin 持久化 jobs/schedules/runs（runtime JSON） |
| `enterprise/.../lib/__tests__/data-jobs-store.test.ts` | store tick/rerun/replay |
| `enterprise/.../api/admin/data-suite/jobs/route.ts` | GET 作业+调度；POST bind/ensure sample |
| `enterprise/.../api/admin/data-suite/jobs/runs/route.ts` | GET 历史；POST tick / rerun / backfill / replay |
| `enterprise/.../api/admin/data-suite/jobs/**/__tests__/` | 路由级 vitest |
| `enterprise/.../_sections/data-jobs.tsx` | 「数据作业」中文运维 UI |
| `enterprise/scripts/e2e-data-jobs.ts` | Playwright：tick→历史→重跑 |
| `messages/zh.json` (+ en 镜像键) | 导航 + 页文案，UI 无中英混排 |
| AppShell / platform-sections / [section]/page | 注册 `data-jobs` |

## Interfaces

```python
# agenticx.data_suite.jobs.ops
@dataclass
class DataJobSchedule:
    id: str
    job_id: str          # JobSpec.name
    cron: str
    enabled: bool = True
    webhook_url: str | None = None

@dataclass
class DataJobScheduleRun:
    id: str
    schedule_id: str
    job_id: str
    trigger: Literal["schedule", "manual", "backfill", "replay"]
    status: Literal["running", "succeeded", "failed"]
    snapshot_id: str | None = None
    error: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    scheduled_for: datetime | None = None
    replay_of_snapshot_id: str | None = None

class DataJobOpsService:
    def register_job(self, spec: JobSpec) -> None: ...
    def bind_schedule(self, job_id: str, *, cron: str, schedule_id: str | None = None,
                      webhook_url: str | None = None, enabled: bool = True) -> DataJobSchedule: ...
    async def tick(self, now: datetime, *, channels, idmaps=None) -> list[DataJobScheduleRun]: ...
    async def rerun(self, job_id: str, *, channels, idmaps=None) -> DataJobScheduleRun: ...
    async def backfill(self, job_id: str, *, scheduled_for: datetime, channels, idmaps=None) -> DataJobScheduleRun: ...
    async def replay_snapshot(self, job_id: str, *, snapshot_id: str, channels, idmaps=None) -> DataJobScheduleRun: ...
    def list_jobs / list_schedules / list_runs(...)
```

```ts
// GET  /api/admin/data-suite/jobs          → { jobs, schedules }
// GET  /api/admin/data-suite/jobs/runs     → { runs }
// POST /api/admin/data-suite/jobs/runs     body: { action: "tick"|"rerun"|"backfill"|"replay", job_id?, snapshot_id?, force_fail? }
// 401 未登录；200 { run } / { runs }
```

失败 webhook kind：`data_job.run_failed`（payload: job_id, run_id, schedule_id, error, snapshot_id）。

## Tasks

### Task 1 — Plan + Python ops + pytest + golden stage
- [x] 本 plan 落盘
- [x] `jobs/ops.py` + `__init__` 导出
- [x] `test_jobs_ops.py`；`ops_stage.py` + `test_golden_path_ops.py`
- [x] Commit: `feat(data-suite): DataFlow job schedule_run ops + golden tick/rerun`

### Task 2 — Admin store/API + vitest + UI
- [x] `data-jobs-store.ts` + jobs/runs routes + tests
- [x] `data-jobs.tsx` 中文运维页 + nav/messages/platform-sections
- [x] Commit: `feat(admin): data-suite jobs ops API + 运维页`

### Task 3 — e2e + PR
- [x] `e2e-data-jobs.ts`（source `enterprise/.env.local`）
- [x] Gates 绿；Mark plan Done；push；`gh pr create`；**不 merge；不启动 H7**

## Done when
1. schedule tick 真实调用 `run_job` 一次并写入 `DataJobScheduleRun` 历史
2. admin 可见作业/运行历史，重跑与补数、快照回放入口可用
3. 作业失败 → FakeWebhookSink 收到 `data_job.run_failed`
4. pytest ops + golden ops 绿；admin vitest 绿
5. e2e（admin 可起时）tick→历史→重跑；否则 store+route 测试绿 + 脚本就绪
6. 无巡检重做、无 MA agent-schedules 混用、无 FinnewsHunter / delivery_pack

## Gate before H7
Merge this PR（或用户 stack）后再开 H7 ID-Mapping 管理台。
