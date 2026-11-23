# agent-runtime

企业托管智能体的**执行面与会话宿主**（FastAPI）。它把核心仓 `agenticx.managed` 的会话状态机、工具执行和远程 Worker 协议接到企业 PostgreSQL、admin-console 控制面与企业模型网关，并按开关承载定时任务、Webhook、飞书渠道、评测和记忆梦境等后台执行器。

## Responsibility

**负责（代码已实现）：**

- 通过 `ma_agent_runtime/app.py` 的 `build_app` 装配托管会话宿主：PAT 鉴权、Agent/版本/环境解析、企业网关 LLM、PG 事件存储，以及 `/ma/v1` 会话接口。
- 通过 `PgEventStore` 持久化会话与有序事件；同一批事件在事务内分配连续 `seq`，并把每个 `span.model_request_end` 幂等写入 `ma_session_usage`。
- 隔离托管执行环境：强制 `HOME == MA_RUNTIME_HOME`、覆盖运行时配置为 `workspace-write`，并在启动时探测 OS 命令沙箱。
- 按需接入企业 Vault 与记忆挂载；Vault、记忆数据仍由 admin-console 拥有，本服务只在回合执行时解析、挂载和回写。
- 可选承载桌面 Worker 工作面：PG 工作队列、领取资格过滤、租约/心跳/完成状态、过期租约清理，以及桌面 PAT 的会话归属隔离。
- 可选执行 cron 定时任务：从控制面读取快照、规划唯一运行槽、创建托管会话、投递模板消息、跟踪终态和超时。
- 可选生成并投递签名 Webhook：订阅会话、线程、定时运行、资源变化和凭证到期事件，持久化 outbox，执行重试、地址策略和自动停用。
- 可选托管飞书长连接：每渠道一个子进程，入站消息去重，私聊/群聊映射到托管会话，再将最终答案回传飞书。
- 可选执行离线评测与迭代：为数据集条目创建隔离的 eval 会话，运行规则/模型裁判，汇总结果，并从失败样本生成候选 manifest。
- 可选执行记忆梦境：读取记忆库和指定会话消息，经模型合并后写入新的输出记忆库，并持久化任务心跳、取消、报告和终态。
- 可选执行「用户 × 智能体」token 配额：按本地时区计算日/周/月窗口，在回合准入和模型调用前拦截超限请求。

**明确不拥有：**

- Agent、版本、环境、PAT、Vault、记忆库、渠道、Webhook 和定时任务的控制面 CRUD；`AdminConsoleClient` / `DreamControlPlaneClient` 只调用 admin-console 内部接口。
- 模型供应商路由与上游鉴权；`GatewayLLMFactory` 只把模型调用发往 `MA_RUNTIME_GATEWAY_URL`。
- 生产数据库建表与迁移；`ma_agent_runtime/tables.py` 明确由 Drizzle migration 创建生产表，`metadata.create_all` 只供测试。
- 每会话独立容器、远程 sandbox backend 或任意多副本会话协调；`AdminConsoleAgentRegistry.get_environment` 明确拒绝 `sandbox_backend="remote"`，会话 actor 与部分唤醒状态仍在本进程。
- IM 人工确认流程；`ChannelRouter.wait_for_idle` 遇到 `requires_action` 会中断会话并回复不支持确认。
- admin-console 内记忆实体的最终写入规则与评测候选的发布；本服务只产出 dream 结果或 candidate 状态，不替控制面发布 Agent 版本。

## Entry points and public interfaces

| 入口 | 路径 / 符号 | 角色 |
|------|-------------|------|
| Uvicorn 工厂 | `ma_agent_runtime/app.py` — `create_app` | `Settings.from_env()` 后调用 `build_app`；容器监听 8092 |
| 应用装配 | `ma_agent_runtime/app.py` — `build_app` | 创建企业存储、控制面客户端、鉴权器、LLM factory、可选后台执行器 |
| 探活 / 就绪 | `GET /healthz`、`GET /readyz` | 前者仅返回进程存活；后者执行数据库 `SELECT 1`，失败返回 503 |
| 托管会话面 | `build_app` 调用 `agenticx.managed.host.app.create_ma_app` | `/ma/v1/sessions`、会话事件、SSE、archive；测试还覆盖 Worker poll/ack/heartbeat/complete/ingest/inbox |
| 代表用户调用 | `OnBehalfOfMiddleware` | 读取 `X-AgenticX-On-Behalf-Of`；仅 `ma:sessions:on_behalf` 或 `ma:admin` PAT 可生效 |
| 桌面 Worker 面 | `worker_wiring.py` — `wire_worker_plane` | 注册 `RemoteWorkerExecutor`、核心 Worker router 与 `GET /ma/v1/work/environments` |
| 记忆梦境公共面 | `memory_dreams.py` — `build_public_router` | `/ma/v1/memory_dreams` 的创建、列表、读取、取消；分别检查记忆与会话 scopes |
| 内部评测面 | `evals.py` — `build_internal_router` | `/internal/ma/eval-runs`、取消、迭代、candidate 决策；Bearer 为 `MA_INTERNAL_TOKEN` |
| 内部记忆梦境面 | `memory_dreams.py` — `build_internal_router` | `/internal/ma/memory-dreams` 创建和取消 |
| 内部 Webhook 面 | `webhook_events_routes.py` — `build_internal_router` | `POST /internal/ma/webhook-events` 与投递记录查询 |
| 飞书子进程入口 | `channels/feishu_child.py` — `main` | stdin 接一次凭证配置，stdout 输出 JSONL 事件，日志仅走 stderr |

PAT 由 `PatIntrospectionAuthenticator.authenticate` 调 admin-console 内省并按 token SHA-256 短缓存；非 `agx-pat-` 令牌直接拒绝。Agent/环境解析由 `AdminConsoleAgentRegistry` 完成：effective 版本走 TTL 缓存，固定版本走有界永久缓存，隐式 `local` 环境可由配置关闭。

## Core execution path

**API 会话回合**

1. `build_app` 用 `HookedPgEventStore`、`AdminConsoleAgentRegistry`、`PatIntrospectionAuthenticator` 和 `GatewayLLMFactory` 调用 `create_ma_app`。
2. 调用方 PAT 经 admin-console 内省为 `Principal`；如带合法代表用户 Header，`OnBehalfOfMiddleware` 通过 context variable 替换本请求的 `user_id`。
3. 创建会话时，Registry 从控制面解析 Agent effective/固定版本与环境；cloud 环境的 `remote` backend 被拒绝。
4. 用户事件进入核心宿主状态机；`PgEventStore.append_events` 锁定会话行、推进 `last_seq`，在同一事务写入事件和模型用量行。
5. cloud LLM 调用经 `GatewayLLMFactory` 发往企业网关；启用配额时，`BudgetGuardedLLMFactory` 在模型请求前复查额度并记录尚未落库的 token。
6. Vault broker 与 memory mount extension 在回合边界解析凭证、实施出站约束、挂载/回写记忆；命令工具运行在该会话工作目录和已探测的 OS sandbox 中。
7. 事件提交后，`HookedPgEventStore` 异步通知定时任务和 Webhook listener；listener 不阻塞会话 actor，关闭前由 `drain` 收口。

**桌面 Worker**

1. `wire_worker_plane` 为 `desktop_worker` 注册 `RemoteWorkerExecutor`，并挂载 Worker 协议路由。
2. `DesktopAccessMiddleware` 从控制面获取 `Eligibility`，按环境、Agent `worker_keys`、会话创建者过滤 poll/claim 与会话访问。
3. `PgWorkQueue.claim_next` 使用 `FOR UPDATE SKIP LOCKED` 和 compare-and-swap 领取最早任务，并记录设备、桌面用户与租约。
4. ack/heartbeat 续租，complete 保证消费游标不回退；启动时遗留租约标记为 `stopped`，后台 sweeper 处理过期工作。

**定时任务**

1. `ScheduleTicker.tick` 拉取 `AdminConsoleClient.list_runtime_schedules` 快照。
2. `parse_cron` / `next_fire` 计算下一 UTC 槽；`ma_schedule_runs` 的 `(schedule_id, trigger, scheduled_for)` 唯一约束去重，多实例通过 CAS 竞争 `scheduled → firing`。
3. 过期、重叠、禁用、删除或 revision 变化的槽被标记 `skipped`，不会补跑 missed 槽。
4. 到期任务以 `run_as_user_id` 创建 `source="schedule"` 会话，`render_template` 注入时间、任务名和 run id，再投递 `user.message`。
5. `ScheduleTicker.on_terminal` 将 `end_turn` / `max_tool_rounds` 记为成功；`requires_action`、其他终止原因或运行超时记为失败并尝试中断会话。

**Webhook**

1. `WebhookOutbox` 监听提交后的会话/线程终态，也接收定时运行事件、内部资源事件和凭证到期扫描结果。
2. 订阅按 tenant、event type、Agent 与 session source 过滤；`(webhook_id, event_key)` 唯一约束保证 outbox 幂等。
3. `WebhookDeliverer` 批量 claim due row，发送前重新解析地址策略，以 `webhook-id.timestamp.body` 计算 `whsec_` HMAC-SHA256 签名。
4. 2xx 成功；重定向、TLS、普通 4xx 为终态失败；网络错误、408/425/429/5xx 按抖动退避重试。投递超过 24 小时会 abandoned，410 或连续失败可请求控制面自动停用。

**飞书渠道**

1. `ChannelSupervisor` 仅在拿到 PostgreSQL advisory lock 的副本运行，定期拉取渠道快照；revision 变化重启子进程，异常按 5–300 秒指数退避。
2. 渠道密钥经控制面解析后只从 stdin 传给 `feishu_child.main`；子进程环境会移除 secret-like 变量。
3. `ChannelRouter.handle_event` 用 `(channel_id, platform_message_id)` 去重；私聊按 sender `open_id`、群聊按 `chat_id` 串行化并映射会话。
4. follow-latest 版本变化、空闲超时、会话终止或用户发送 reset 命令都会换新会话；群聊消息加发送者短标识。
5. 等待 `session.status_idle` 时提取最后一条 `agent.message`；超时或 `requires_action` 会中断，`FeishuOpenApi.reply` 先发富文本，失败再降级纯文本。

**评测与记忆梦境**

- `EvalRunner` 使用 PG claim + heartbeat 驱动 eval run；每个 item 创建 `source="eval"` 会话，记忆资源强制 `read_only`，采集最终答案、工具名、stop reason 与 usage，再执行规则检查和可选 judge model。iterate run 读取已完成评测的失败项，生成 `ma_eval_candidates`，但不会直接发布版本。
- `DreamRunner` 使用相同的 claim/heartbeat/stale requeue 模式；从 admin-console 导出输入记忆，读取 `PgEventStore` 中指定会话的 user/agent 消息，经 `consolidate` 和企业网关模型生成结果，再回写新记忆库。取消、超时、缺失/空会话和拒绝项进入结构化报告。

## Data and configuration

生产单一持久化依赖为 `DATABASE_URL` 指向的 PostgreSQL。`db.py` 的 `split_database_url` 同时生成 asyncpg URL（事件、调度、Webhook）和 psycopg2 URL（工作队列、评测、梦境）；SQLite 仅在 `MA_RUNTIME_ALLOW_SQLITE=1` 时供测试。

`ma_agent_runtime/tables.py` 镜像以下生产表契约：

- 会话核心：`ma_sessions`、`ma_session_events`、`ma_session_usage`
- 桌面工作面：`ma_work_items`
- 自动化：`ma_schedule_runs`、`ma_webhook_deliveries`
- IM 渠道：`ma_channel_conversations`、`ma_channel_inbound`、`ma_channel_runtime_state`
- 评测：`ma_eval_runs`、`ma_eval_results`、`ma_eval_candidates`
- 记忆任务：`ma_memory_dreams`

本地文件只用于隔离执行面：`MA_RUNTIME_HOME/.agenticx/sessions/` 保存会话工作目录，`isolation.write_runtime_config` 每次启动覆盖 `.agenticx/config.yaml`。容器默认 `HOME=/data/home`，并关闭个人模式的 learning、session FTS 和 skill manage。

关键配置以 `Settings.from_env` 为准：

| 分组 | 变量 / 默认行为 |
|------|-----------------|
| 必填 | `DATABASE_URL`、`MA_INTERNAL_TOKEN`（支持 `_FILE`）、`MA_RUNTIME_GATEWAY_TOKEN`（须 `agx-pat-`，支持 `_FILE`）、绝对路径 `MA_RUNTIME_HOME`，且 `HOME` 必须相同 |
| 控制面 / 网关 | `MA_RUNTIME_ADMIN_URL=http://127.0.0.1:3001`；`MA_RUNTIME_GATEWAY_URL=http://127.0.0.1:8088/v1` 且必须以 `/v1` 结尾 |
| 隔离 | `MA_RUNTIME_COMMAND_SANDBOX=required`；可设 `best_effort`，但探测失败后命令无 OS 隔离 |
| 核心缓存 / 超时 | Registry 10s、PAT 30s、LLM 300s；DB pool 默认 10；interrupt grace 默认 3s |
| 扩展默认开关 | desktop worker、desktop PAT、scheduler、webhooks、channels、agent quota、tasks、threads、evals、dreams 均默认关闭 |
| 默认开启扩展 | credentials、memory、egress enforce、implicit local environment 默认开启，可分别显式设 `0` 关闭 |
| 调度 / Webhook | tick 15s、schedule timeout 3600s、Webhook 最多 6 次、配置缓存 30s；默认拒绝 loopback/link-local/metadata，RFC1918 与 HTTP 仅在 `MA_WEBHOOK_BLOCK_PRIVATE=1` 时额外拒绝 |
| 渠道 | 回复超时 300s、并发 8、reconcile 30s、poll 1s、入站去重保留 7 天 |
| 配额 | rule cache 30s、stale 600s、`MA_QUOTA_TIMEZONE=Asia/Shanghai`；非法 IANA 时区拒绝启动 |
| 评测 / 梦境 | item timeout 600s、run 并发 1；dream timeout 7200s、并发 1 |

`scrub_secret_env` 在依赖对象构造完成后删除匹配 token、secret、password、private key、API key 和 database URL 的环境变量；密钥值保留在已构造对象中，不继续暴露给工具子进程。

## Dependencies

**核心仓直接依赖：**

- `agenticx.managed.host.*`：`create_ma_app`、会话 service/actor、Worker 路由与远程执行器。
- `agenticx.managed.events.*` / `protocol`：状态机、`EventStore`、`SessionRecord`、事件与 usage 契约。
- `agenticx.managed.gateway_llm` / `budget`：企业网关 LLM factory 与模型调用配额 guard。
- `agenticx.managed.credentials` / `credential_extension` / `memory` / `memory_mount` / `redaction`：Vault、记忆挂载、出站约束和日志脱敏。
- `agenticx.managed.evaluation` / `eval_iterate` / `memory_dream`：评测、候选迭代和记忆合并算法。
- `agenticx.gateway.adapters.feishu` 与 `agenticx.gateway.feishu_longconn`：飞书事件解析和 Markdown 富文本转换。
- `agenticx.runtime.command_sandbox`：bubblewrap / sandbox-exec 等 OS 命令沙箱计划。

**外部运行依赖：**

- PostgreSQL：生产会话、事件、用量、队列及全部后台任务状态。
- admin-console：内部 token 鉴权后的 Agent/环境、PAT、Worker eligibility、定时任务、Webhook、渠道凭证、配额、Vault 与记忆接口。
- 企业 AI Gateway：所有托管会话、评测 judge/optimizer 与 dream 模型请求。
- 飞书 OpenAPI / 长连接：仅 `MA_RUNTIME_CHANNELS_ENABLED=1` 时需要。

**requirements.txt 显式依赖：** SQLAlchemy async、asyncpg、psycopg2、aiosqlite、httpx、tzdata、lark-oapi；Dockerfile 以仓库源码安装 AgenticX `[mcp]` extra，并安装 bubblewrap、git 和 build-essential。

## Tests and operations

- 全量测试位于 `enterprise/apps/agent-runtime/tests/`；标准命令为：
  ```bash
  python -m pytest -o addopts="" -o asyncio_mode=auto enterprise/apps/agent-runtime/tests -q
  ```
- `tests/test_app_e2e.py` 使用假 admin-console 与假 gateway 覆盖门户式建会话、完整回合、固定版本、工作目录、鉴权及 health/ready。
- `tests/test_pg_event_store_contract.py` / `test_pg_work_queue_contract.py` 覆盖连续序号、并发 append、事务原子性、租户隔离、usage 幂等、claim 排他、租约和消费游标；设置 `MA_TEST_DATABASE_URL` 可在 PostgreSQL 上运行同一契约。
- `tests/test_tables_parity.py` 将 SQLAlchemy 表定义与 enterprise Drizzle migrations 对照，防止字段、类型、非空性和唯一约束漂移。
- `tests/test_desktop_access.py` 覆盖桌面 PAT 开关、Agent/环境资格、会话归属、claim 用户绑定与缓存。
- `tests/test_scheduler.py` / `test_cron.py` 覆盖下一槽、双 ticker 去重、missed/overlap/revision、手动运行、终态与超时。
- `tests/test_webhooks.py` / `test_webhook_catalog.py` 覆盖事件目录、签名、订阅过滤、地址阻断、重试、自动停用、凭证到期和内部投递查询。
- `tests/test_channel_router.py` / `test_channel_supervisor.py` / `test_feishu_api.py` 覆盖会话复用与重置、消息去重、版本路由、超时/确认中断、子进程重启、密钥脱敏和富文本降级。
- `tests/test_evals.py` 与 `tests/test_memory_dreams.py` 覆盖端到端执行、stale requeue、取消、超时、只读记忆、候选生成及内部路由鉴权；Vault/记忆回合接线另由 `test_vault_wiring.py`、`test_memory_wiring.py` 验证。
- Docker 以 uid 10002 非 root 用户运行，端口 8092，HEALTHCHECK 调 `/healthz`。`MA_RUNTIME_COMMAND_SANDBOX=required` 时 sandbox 探测失败会直接拒绝启动；`/readyz` 可区分进程存活与数据库可用。
- 关闭扩展开关时，对应 router、listener 和后台 task 不挂载；测试通过 app routes、`app.state.ma.extras` 与 listener 数量验证这一边界。
