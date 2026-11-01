## Summary
H9 — NL2SQL LLM 闭环 + patrol metering + MA schedules UI 入口证明（主仓通用积木）。

- **NL2SQL**: `Nl2SqlSession` / `run_nl2sql` 经 managed `LLMFactory`；`extract_sql_from_llm`；write guards 禁写拒答；CI 用 ScriptedLLM（无付费 LLM）。
- **Metering**: `agenticx/managed/metering.py`（`UsageRecord` / `InMemoryMeteringStore`，形状对齐 TS `UsageRecordInput`）；`run_patrol_tick(..., metering=)` 记 `route=patrol`。
- **MA schedules UI**: 页面/nav/中文已在 main；新增 vitest 证明 en/zh +「定时任务」+ `agent-schedules` platform section。

## Gates
| Gate | Status |
|------|--------|
| Fake LLM → SQL → ReadOnlySqlExecutor | ✅ |
| 非只读 SQL 拒答（INSERT/DROP） | ✅ |
| patrol tick → InMemoryMeteringStore | ✅ |
| schedules 中文入口 vitest | ✅ |
| 无 delivery_pack / 行业问答 / FinnewsHunter / merge | ✅ |

## Test plan
- [x] `python -m pytest tests/managed/templates/test_nl2sql.py tests/managed/templates/test_nl2sql_llm.py tests/managed/test_metering.py tests/managed/templates/test_patrol_schedule.py -q --no-cov` → **26 passed**
- [x] `pnpm exec vitest run src/app/admin/_sections/__tests__/agent-schedules-messages.test.ts` (admin-console) → **3 passed**

## Non-goals
自然语言取数业务话术 / 行业问答包；不 merge；不启动 H9 之后项。

Base tip note: local main `6009e2a3` same tree as remote squash #176 `af155587`.
