# 子计划 04：Personal Eval OS 最小闭环

Planned-with: GPT-5.6 Sol
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast
Parent-Plan: `.cursor/plans/pending/2026-09-09-near-personal-agent-control-plane-master.plan.md`
Depends-on: `2026-09-09-near-personal-control-02-meta-acl`
Plan-Id: 2026-09-09-near-personal-control-04-personal-eval

> **For implementer:** 使用 executing-plans。先做 CLI/headless MVP；禁止在本计划接 Skill approval、Desktop 或生产自动晋级。

**Goal:** 从用户真实历史人工选取 20–50 个任务，用同一安全策略对 baseline/candidate 成对 replay，并联合评估质量、轨迹、token、延迟和写副作用。

**Architecture:** 复用 `EvalSet`、`TrajectoryMatcher`、`LLMJudge`，新增 SessionCaseMiner、ReplayRunner、EvalRun 与 compare；Replay 通过临时 workspace、READ_ONLY command sandbox 和 eval policy 拦截写工具。必须明确这不是完整网络沙箱。

**Tech Stack:** Pydantic、AgentRuntime headless、ToolPolicyStack、SQLite/JSON、Typer/现有 CLI、pytest。

## In scope

- 人工从 `messages.json` 选择 case。
- validation + 手工 held_out 标签。
- baseline/candidate 双跑和 JSON report。
- deterministic/LLM judge/cost/latency/safety 联合门禁。
- CLI：mine/add-case/run/report。

## Out of scope

- 自动 mining/聚类、防泄漏自动划分。
- 完整网络沙箱、生产 canary、自动 promote。
- Skill proposal、ChangeSet、Avatar Portfolio、Desktop。

## 现有断链

- `agenticx/evaluation/runner.py` 期望不存在的 `agent_executor.execute_async()`，Studio 实际走 `AgentRuntime.run_turn()`。
- `LLMJudge`、`SpanEvaluator` 未接 `EvalRunner._run_case`。
- `TraceToEvalSetConverter` 不读取 session `messages.json`。
- 无 EvalRun baseline/candidate 模型和 CLI。
- `ObservationHook` 不存 tool args，expected tools 应从 messages tool_calls 读取。

## FR-04-1：扩展 schema

**Files:**
- Modify: `agenticx/evaluation/evalset.py`
- Create: `agenticx/evaluation/run.py`
- Modify: `agenticx/evaluation/__init__.py`
- Test: `tests/test_smoke_eval_run_schema.py`

`EvalCase` 新增可选 `split/source/thresholds/rubric/deterministic_checks`；旧 JSON 缺字段必须可读。

`EvalRunConfig` 固定：
- `replay_mode="read_only_replay"`
- `max_concurrent=1`
- `timeout_s=120`
- gates 默认 trajectory 1.0、judge 0.7、token delta 25%、latency delta 30%、zero writes=true。

`EvalResult` 新增 `run_id/variant/passed/gates/judge_results`，保持旧字段兼容。

落盘：
- `~/.agenticx/eval/personal/<user_id>/evalsets/<name>.json`
- `~/.agenticx/eval/runs/<run_id>/{manifest,summary}.json`
- variant results 分目录。

## FR-04-2：SessionCaseMiner

**Files:**
- Create: `agenticx/evaluation/session_case_miner.py`
- Create: `tests/test_smoke_eval_session_miner.py`

规则：
- query=选中 user message 文本，移除附件展示占位但保留 `context_files/taskspaces` 指针。
- reference=纠偏链最终被接受的 assistant 回复。
- expected_tool_use 从 assistant `tool_calls` 解析，默认 name-only。
- correction 标识复用 `CORRECTION_RE`，只高亮，必须人工 `add-case` 才入库。
- source 带 session_id/message_id/turn_index/miner_version。

**AC:** 普通、重试、纠偏、附件四类 fixture；不存在 message_id 明确报错；不修改原 session。

## FR-04-3：Eval replay policy

**Files:**
- Create: `agenticx/evaluation/policy.py`
- Modify: `agenticx/tools/policy.py`（只增加可组合 Layer，若无需则不改）
- Test: `tests/test_eval_replay_policy.py`

要求：
- deny `WRITE_TOOLS`、`skill_manage`、调度/委派/审批/外部消息发送与 MCP mutator。
- `bash_exec` 只允许 `command_sandbox.READ_ONLY`。
- 临时 workspace：`~/.agenticx/eval/workspaces/<run_id>/<variant>/<case_id>`。
- 可选 disable network；默认 report 明示 `network_isolation=false`。
- 被拒工具计入 safety，不能静默伪装成功。

## FR-04-4：ReplayRunner

**Files:**
- Create: `agenticx/evaluation/replay_runner.py`
- Create: `tests/test_smoke_eval_replay_runner.py`

接口：

```python
async def run_variant(evalset, *, run, variant, variant_config, case_ids=None) -> list[EvalResult]: ...
```

要求：
- headless 构造临时 session，调用 `AgentRuntime.run_turn(..., persist_user_message=False)`。
- 消费 FINAL/tool/usage events，收集 response、tool trajectory、usage、elapsed。
- 不写用户 session、memory、skill、automation。
- timeout 后结果 failed 且保留报告。
- tests 使用 mock LLM/tool，不出网。

## FR-04-5：成对 compare

**Files:**
- Create: `agenticx/evaluation/assertions.py`
- Create: `agenticx/evaluation/compare.py`
- Create: `tests/test_smoke_eval_run_compare.py`

`promotion_allowed` 必须同时满足：
- validation candidate 不低于 baseline，paired win rate 达配置值（默认 0.8）。
- deterministic、judge、cost、latency、safety gates 全部通过。
- held_out MVP 仅报告 warning，不自动 block；字段保留。

**AC:** candidate 轨迹退化、token +30%、latency +31%、写尝试、judge 低分均分别阻断；baseline 为零的 delta 不除零。

## FR-04-6：CLI

**Files:**
- Create: `agenticx/cli/eval_commands.py`
- Modify: 现有 CLI 注册文件（按当前命令组织定位）
- Test: `tests/test_eval_cli.py`

命令：

```bash
agx eval mine --session-id <sid> --list-corrections
agx eval add-case --evalset <name> --from-session <sid> --message-id <mid>
agx eval run --evalset <name> --baseline <label> --candidate <label>
agx eval report --run-id <id>
```

run 默认要求用户确认网络隔离边界；CI 可用 `--yes`。

## 验证

```bash
pytest \
  tests/test_adk_enhancements.py::TestEvaluation \
  tests/test_smoke_pydantic_ai_evals.py \
  tests/test_smoke_veadk_trace_converter.py \
  tests/test_smoke_eval_run_schema.py \
  tests/test_smoke_eval_session_miner.py \
  tests/test_eval_replay_policy.py \
  tests/test_smoke_eval_replay_runner.py \
  tests/test_smoke_eval_run_compare.py \
  tests/test_eval_cli.py -q
```

## Grok 4.6 停止条件

- 若 AgentRuntime 不能无持久化运行，先补窄接口测试；禁止复制 Studio `/api/chat` 大段逻辑。
- 若某工具无法确定读写属性，默认 deny 并在 report 标注。
- 不得声称“完整沙箱”；验收文案必须写“文件只读 + 工具策略隔离，网络按配置限制”。
