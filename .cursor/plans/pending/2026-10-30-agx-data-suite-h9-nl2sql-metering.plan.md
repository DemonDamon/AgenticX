# AGX Data Suite H9 — NL2SQL LLM 闭环 + metering + MA schedules UI

> **Parent:** `.cursor/plans/pending/2026-10-30-data-suite-p3-harden.plan.md` §H9  
> **Branch:** `feat/agx-data-suite-h9-nl2sql-metering`  
> **Depends on:** H10 on local main (`6009e2a3`, tree = remote squash #176 `af155587`).  
> **Main-repo gate:** 通用 LLM/护栏/计量积木；禁止自然语言取数业务话术 / 行业问答包 / `delivery_pack` / 客户 metering 进 `agenticx/`。

**Goal:** nl2sql 模板经 managed `LLMFactory` / ProviderResolver 层生成只读 SQL，经既有 write guards + `ReadOnlySqlExecutor` 执行；巡检 tick 写入平台 metering 抽象（Python in-memory/recorder，对齐 `UsageRecordInput` 形状）；MA schedules 管理 UI 入口以 vitest 证明 nav + 中文文案完整（页面已合入则不重做）。

**Architecture:**
- `Nl2SqlSession` / `run_nl2sql`：`LLMFactory.create` → `invoke` → 从 content 或 `data_suite_sql_query` tool_call 抽 SQL → `is_read_only_sql` / executor；禁写拒答。CI 用 `StaticLLMFactory` + `ScriptedLLM`，无 live 付费 LLM。
- `agenticx/managed/metering.py`：`UsageRecord` + `MeteringRecorder` protocol + `InMemoryMeteringStore`；`run_patrol_tick(..., metering=, metering_context=)` 成功后 `record` 一条 `route=patrol` 事件。
- Admin：既有 `/admin/agent-schedules` + zh「定时任务」；补 focused vitest 对齐 en/zh key tree + nav href。

**Tech Stack:** Python 3.10+、`agenticx.managed.llm` / `testing.ScriptedLLM`、pytest；admin vitest + next-intl messages。

## Global Constraints

- 假数据 / Fake LLM only；不调付费 API。
- 不引入 delivery_pack / HC customer metering / 行业问答包。
- 不 merge；不启动 H9 之后任何项；不动 FinnewsHunter。
- Mac HTTPS github.com:443 不可用；优先 SSH push，失败则本地提交 + 报告 box relay。

## Inventory（H9 前 @ `6009e2a3`）

| 面 | 状态 |
|----|------|
| `nl2sql.py` ReadOnlySqlExecutor + `is_read_only_sql` + manifest stub | 已有；**无 LLM 闭环** |
| `write_guards.py` + `test_nl2sql.py` SELECT ok / INSERT deny | 已有 |
| `managed/llm.py` LocalConfigLLMFactory → ProviderResolver | 已有 |
| `managed/testing.py` ScriptedLLM / StaticLLMFactory | 已有（可复用） |
| `schedule_tick.run_patrol_tick` | 已有；**无 metering hook** |
| TS `MeteringService.recordUsage` / `/metering` UI | 已有；Python 侧 **无对齐 recorder** |
| Admin `agent-schedules.tsx` + nav + zh 文案 + ma-schedules API | **基本完成**；缺 focused vitest 证明入口/中文 |
| 行业问答 / NL 业务话术 | 非目标 |

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/managed/templates/data_suite/nl2sql.py` | + `extract_sql_from_llm` / `Nl2SqlResult` / `Nl2SqlSession` / `run_nl2sql` |
| `agenticx/managed/templates/data_suite/__init__.py` | 导出新符号 |
| `agenticx/managed/metering.py` | `UsageRecord` / `MeteringRecorder` / `InMemoryMeteringStore` / `record_patrol_usage` |
| `agenticx/managed/templates/data_suite/schedule_tick.py` | optional metering 接线 |
| `tests/managed/templates/test_nl2sql.py` 或 `test_nl2sql_llm.py` | Fake LLM 闭环 + 禁写拒答 |
| `tests/managed/test_metering.py` + extend `test_patrol_schedule.py` | metering 记录断言 |
| `enterprise/.../_sections/__tests__/agent-schedules-messages.test.ts` | en/zh 对齐 + 入口文案 |
| `.cursor/plans/pending/2026-10-30-agx-data-suite-h9-nl2sql-metering.plan.md` | 本 plan |

## Interfaces

```python
# agenticx.managed.templates.data_suite.nl2sql

@dataclass
class Nl2SqlResult:
    sql: str
    rows: list[dict]
    refused: bool = False
    reason: str | None = None

def extract_sql_from_llm(response: Any) -> str:
    """Prefer data_suite_sql_query tool_call arguments.sql; else fenced/plain SELECT from content."""

class Nl2SqlSession:
    def __init__(
        self,
        *,
        llm_factory: LLMFactory,
        channel: _QueryChannel,
        context: LLMCallContext,
        provider: str = "fake",
        model: str = "fake-nl2sql",
        write_guard: WriteGuardPolicy | None = None,
    ) -> None: ...
    def ask(self, question: str, *, limit: int = 100) -> Nl2SqlResult: ...

def run_nl2sql(
    question: str,
    *,
    llm_factory: LLMFactory,
    channel: _QueryChannel,
    context: LLMCallContext,
    provider: str = "fake",
    model: str = "fake-nl2sql",
    limit: int = 100,
) -> Nl2SqlResult: ...

# agenticx.managed.metering

@dataclass
class UsageRecord:
    tenant_id: str
    provider: str
    model: str
    time_bucket: str
    cost_usd: float = 0.0
    route: str = "chat"
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    id: str | None = None
    # + optional dept_id / user_id / agent_id / metadata

class MeteringRecorder(Protocol):
    def record(self, record: UsageRecord) -> UsageRecord: ...

class InMemoryMeteringStore:
    records: list[UsageRecord]
    def record(self, record: UsageRecord) -> UsageRecord: ...

def record_patrol_usage(
    store: MeteringRecorder,
    *,
    tenant_id: str,
    tick_id: str,
    agent_id: str = "data_suite_patrol",
    ...
) -> UsageRecord: ...
```

## Tasks

### Task 1 — Plan + NL2SQL LLM closed loop

- [x] 本 plan 落盘
- [x] `Nl2SqlSession` / `run_nl2sql` + SQL 抽取；保留 write guards
- [x] `test_nl2sql_llm.py`：ScriptedLLM SELECT 成功；INSERT/写语句 refused；既有 `test_nl2sql.py` 仍绿

### Task 2 — Patrol metering

- [x] `agenticx/managed/metering.py` InMemory store + protocol（形状对齐 TS UsageRecordInput）
- [x] `run_patrol_tick` 可选 `metering` / `metering_context`；成功 tick 记一条 `route=patrol`
- [x] `tests/managed/test_metering.py` + patrol 扩展断言

### Task 3 — MA schedules UI entry proof

- [x] vitest：`pages.admin.agentSchedules` en/zh key tree 对齐；zh title「定时任务」；nav `/admin/agent-schedules` 存在
- [x] 不重做整页；缺 route/nav/i18n 才修

### Task 4 — Commit + PR（不 merge）

- [x] Commit(s) 清晰 message
- [x] Mark plan Done；push（SSH 优先）；`gh pr create` 含 gates；**不 merge**

## Done when

1. Fake LLM → SQL → ReadOnlySqlExecutor 闭环可测；非只读 SQL 拒答
2. 巡检 tick 写入 InMemoryMeteringStore，tests 可断言
3. MA schedules 入口 vitest 绿（中文文案）
4. `tests/managed/` 相关 pytest 绿；既有 nl2sql/patrol 回归绿
5. 无行业包、无 delivery_pack、无 FinnewsHunter、无 merge

## Gate after H9

本 PR 合入后 Harden backlog 本串完成；不自动开新 H。
