# acp-03 回合 Trace 上报企业

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: `.cursor/plans/2026-10-14-acp-master.plan.md`

## 目标

已登录企业的 Near，每完成一个回合，把这一回合的步骤摘要（模型轮次、工具调用、子智能体，含耗时、状态、token）写进企业 `agent_token_traces`，管理台「Agent Trace」页能按 trace 查看。只传元数据，不传消息正文与工具参数/结果。

## 根因与证据

- 回合事件已经落在本地 replay ledger：`ReplayLedgerRecorder`（`agenticx/runtime/replay_ledger/recorder.py`），结束时 `finish(status)`（约 564 行）写 `run_completed` 并 `store.close_run(...)`。事件类型见 `contracts.py` 的 `EVENT_TYPES`；读事件用 `ReplayLedgerStore.read_events(...)`、读运行用 `get_run(run_id)`（`store.py` 约 361、389 行）。
- 企业表 `agent_token_traces`（`enterprise/packages/db-schema/src/schema/agent-token-traces.ts`）：`trace_id`、`step_no`、`step_kind`、`status`、`model`、`provider`、`input/output/reasoning/total_tokens`、`cost_usd`、`duration_ms`、`error_message`、`metadata`，唯一键 `(tenant_id, trace_id, step_no)`。
- 现有写入口 `POST /api/agent-traces/ingest`（admin-console）要求 `metering:manage`，桌面 PAT 用不了；桌面侧也没有任何调用方。
- 桌面 PAT 鉴权：`resolveDesktopIdentity(request)`（`enterprise/apps/web-portal/src/lib/desktop-auth.ts`），返回 `userId`、`tenantId`、`scopes` 等。
- 企业配置键：`enterprise.enabled`、`enterprise.token`、`enterprise.base_url`（读法见 `agenticx/runtime/action_audit.py` 约 59–70 行）。

## 门户接收端

新建 `enterprise/apps/web-portal/src/app/api/desktop/agent-traces/route.ts`：

- `POST`，`resolveDesktopIdentity`，失败 401。
- body `{ spans: Span[] }`，1–200 条，否则 400。
- 每条 span：`trace_id` 必须匹配 `^near:[A-Za-z0-9._:-]{1,120}$`；`step_no` 正整数；`step_kind` ∈ `model|tool|subagent|run`；`status` ∈ `ok|error|cancelled`；数值字段非负整数；`model`/`provider` 可选字符串（≤128/64）；`error_message` ≤ 2000 字；`metadata` 可选对象。
- 服务端强制覆盖 `metadata.user_id = identity.userId`、`metadata.source = "near"`，`tenant_id = identity.tenantId`，`id` 用 `ulid()`。
- 写入：`on conflict (tenant_id, trace_id, step_no) do nothing`（MySQL 用 `INSERT IGNORE` 语义），保证重试幂等，并且别人的 trace 不会被覆盖。
- 写库辅助放 `enterprise/apps/web-portal/src/lib/desktop-agent-traces.ts`，方言分派照 `src/lib/capability-tables.ts` 的写法（PG 用 `@agenticx/db-schema` 的 `agentTokenTraces`，MySQL 用 `@agenticx/db-schema/mysql` 同名导出）。
- 响应 `{ code: "00000", data: { accepted: n } }`。

## Near 上报端（Python）

新模块 `agenticx/runtime/enterprise_trace.py`：

```python
OUTBOX_PATH = ~/.agenticx/enterprise_trace/outbox.jsonl   # 跟随 ConfigManager 的 home 解析
MAX_OUTBOX_LINES = 2000                                    # 超出丢最旧

def trace_upload_enabled() -> bool:
    # enterprise.enabled is True and enterprise.token 非空 and enterprise.base_url 非空
    # and ConfigManager.get_value("enterprise.trace_upload") is not False

def build_spans(run: ReplayRunRecord, events: list[RunEvent]) -> list[dict]:
    """纯函数：一个回合 → span 列表。"""

def enqueue_completed_run(store: ReplayLedgerStore, run_id: str) -> None:
    """读 run 与事件，build_spans，追加到 outbox，然后启动一次后台 flush。任何异常吞掉并记 debug 日志。"""

def flush_outbox(timeout_s: float = 10.0) -> int:
    """POST {base_url}/api/desktop/agent-traces，Authorization: Bearer <token>。
    成功或 4xx（除 401/429）后从 outbox 删除该批；401/429/5xx/网络错误保留待下次。返回上传条数。"""
```

`build_spans` 映射规则（每个回合一个 trace，`trace_id = f"near:{run.session_id}:{run.run_id}"`，超长时对 session_id 截断保证 ≤ 125 字）：

| 来源 | step_kind | 说明 |
| --- | --- | --- |
| 每个 `round_started` 到下一个 `round_started`/结束之间的模型输出 | `model` | `model`/`provider` 取 run 记录；token 取该轮内 `context_stats` 或 `assistant_output_completed` payload 中的 usage 字段（实施前读 recorder 写入的 payload 确认字段名，取不到记 0）；`duration_ms` 用事件时间差 |
| 每对 `tool_call` / `tool_result`（按 `tool_call_id` 配对） | `tool` | `metadata.tool_name`；`status` 依据 tool_result payload 的错误标记；不放参数与结果 |
| `subagent_started` → `subagent_completed`/`subagent_error` | `subagent` | `metadata.subagent_name` |
| 最后一条 | `run` | 总时长、run 状态映射（completed→ok，failed→error，cancelled/interrupted→cancelled），`metadata.agent_id`、`metadata.event_count` |

`step_no` 从 1 按时间顺序递增。`error_message` 只取错误摘要前 500 字。

钩子：在 `ReplayLedgerRecorder.finish()` 成功 `close_run` 之后、`self._finished = True` 之前调用 `enqueue_completed_run(self.store, self.current_run_id)`，包在 `try/except Exception` 里，失败不影响 recorder。`import` 放模块顶部；如果出现循环依赖，改在 `enterprise_trace.py` 内部只依赖 `contracts` 与 `store`，不要反向 import recorder。

后台 flush：`enqueue_completed_run` 用一个模块级 `threading.Lock` + 守护线程执行 `flush_outbox`，同一时刻最多一个 flush 线程。HTTP 用 `httpx`，对 `127.0.0.1`/`localhost` 使用 `trust_env=False`（避开系统代理，见 AGENTS.md 飞书侧同类问题）。

不改 `agenticx/studio/server.py`。

## AC

1. `tests/test_enterprise_trace.py`：
   - `build_spans` 对一组构造事件（2 轮模型、1 次成功工具、1 次失败工具、1 个子智能体、completed）产出正确 step_kind 序列、step_no 连续、工具失败 status=error、无任何 `content`/`arguments`/`result` 字段。
   - `trace_upload_enabled` 在四个开关组合下的真值。
   - `flush_outbox` 用 `httpx.MockTransport`：200 清空；500 保留；400 清掉该批；401 保留。
   - outbox 超过上限丢最旧。
2. `enterprise/apps/web-portal/src/app/api/desktop/agent-traces/__tests__/route.test.ts`：无 token 401；非法 trace_id 400；超过 200 条 400；成功时写库函数收到的 metadata 含被覆盖的 `user_id` 与 `source`。
3. `pytest tests/test_enterprise_trace.py -q --no-cov`；`pnpm -C enterprise --filter @agenticx/app-web-portal typecheck` 与 `test` 通过；`pytest -q --no-cov -k replay` 不回归。
4. 端到端（主控执行）：本机已登录企业（`config.yaml` 有 enterprise 节）时，用 `agx serve` 跑一轮带工具调用的对话，随后 `select trace_id, step_no, step_kind, status from agent_token_traces where trace_id like 'near:%' order by created_at desc limit 20` 能看到该回合；管理台 `/metering/agent-traces` 页能打开该 trace。

## Out of scope

上传消息正文；OTel 导出；管理台页面改版；网关侧 trace。
