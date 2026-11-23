# Managed 模块结论

> 结论更新时间：2026-11-14（首次建档，基线覆盖至 `cebdabd5`）

## Responsibility
- `agenticx/managed` 是 AgenticX 的 **Managed Agents 协议、托管运行时与远程 Worker 执行层**：定义 `agx-ma/2026-11` 线协议和 `agx.agent/v1` manifest，负责会话、事件、工具确认、任务、成员线程、凭据、MCP、memory mount、用量与 Worker lease 的端到端协作。
- 模块同时提供两种执行面：`cloud` 环境在 Host 进程内以 `AgentRuntime` 执行，`desktop_worker` 环境把 work item 放入 SQLite 队列，由桌面 Worker 领取、心跳、回传事件并完成或失败结算。
- 模块包含可独立复用的受管能力：manifest 校验/编译、权限合并、预算保护、凭据解析与脱敏、出口网络策略、评测 rubric、memory store CAS 同步，以及 Data Suite 的只读 NL2SQL、质量巡检和字典漂移模板。
- Explicit non-responsibilities: 不提供企业控制台或最终用户 UI；不实现模型供应商 SDK、通用 `AgentRuntime`、企业策略规则本体、凭据底层存储或 MCP transport；生产级 agent/version/environment 控制面也不在本模块内，当前 Host 默认注册表 `StaticAgentRegistry` 从注入的 `HostConfig` 读取静态定义。

## Entry points and public interfaces
- `agenticx/managed/__init__.py` 是协议门面，导出 `PROTOCOL_VERSION`、`MANIFEST_SCHEMA`、`parse_client_events`、`parse_server_event`、`event_to_wire`、`export_json_schemas`、`validate_manifest`、`normalize_manifest`、`manifest_hash`、`AgentManifest` 与 `MAError`。
- `agenticx/managed/host/app.py:create_ma_app` 构建 FastAPI Host；`agenticx/managed/host/routes.py:build_session_router` 暴露 `/ma/v1/health`、session CRUD、事件列表/SSE、task、thread 与 archive 接口，全部通过 bearer token 和 `ma:sessions:*` scope 控制。
- `agenticx/managed/api_client.py:MAApiClient` 是 `agx ma` 使用的同步控制面/运行面客户端，覆盖 agent、version、environment、session 与可重连事件流；HTTP/传输失败统一为 `MAApiError`。
- `agenticx/managed/worker/__init__.py` 导出桌面 Worker SDK：`MAWorkerClient` 访问 poll/ack/heartbeat/complete/fail/ingest/inbox API，`WorkItemRunner` 执行单个 assignment，`MAWorker` 在多个环境上轮询运行。
- `agenticx/managed/manifest.py:validate_manifest` 与 `agenticx/managed/spec.py:compile_spec` 分别完成结构归一化/哈希和运行时语义编译；`AgentSpec` 是 Host 与 Worker 共用的不可变执行契约。
- 可扩展接口包括 `agenticx/managed/llm.py:LLMFactory`、`agenticx/managed/events/store.py:EventStore`、`agenticx/managed/host/registry.py:AgentRegistry`、`agenticx/managed/credentials.py:CredentialProvider`、`agenticx/managed/memory.py:MemoryStoreClient` 与 `agenticx/managed/extensions.py:SessionExtension`。
- 辅助能力的直接入口包括 `agenticx/managed/evaluation.py:validate_rubric` / `judge_item` / `summarize`、`agenticx/managed/memory_dream.py:consolidate`，以及 `agenticx/managed/templates/data_suite/__init__.py` 聚合导出的 NL2SQL、巡检、调度、webhook 和 write-gate API。

## Core execution path
- **Host 初始化**：`create_ma_app` 组装 `SqliteEventStore` → `EventLog` / `EventBroadcaster` → `StaticAgentRegistry` → `ManagedAgentBuilder` → `SessionService`，安装凭据扩展；SQLite 存储可用时再注册 `SqliteWorkQueue`、`RemoteWorkerExecutor`、Worker routes 与 lease sweeper。
- **会话创建**：`SessionService.create_session` 校验 principal、agent/version/environment、vault 与 resources，创建 `SessionRecord`；`cloud` 使用 `LocalTurnExecutor`，`desktop_worker` 使用 `RemoteWorkerExecutor`。`SessionActor` 以每会话锁串行处理原子 client event batch，并把状态迁移交给 `SessionStateMachine`。
- **本机轮次**：`ManagedAgentBuilder.build` 从 `AgentSpec` 创建隔离 workdir、`StudioSession`、模型实例和限定工具集合；`LocalTurnExecutor` 注入权限、custom tool、MCP、credential/memory extensions、task 与 multi-agent thread 能力，再将 `AgentRuntime` 事件经 `RuntimeEventAdapter` 转成协议事件，由 `EventLog` 按“校验 → 持久化 → 广播”写入。
- **交互式工具**：`ManagedPermissionHook` 合并 manifest 与 `EnterpriseAgentPolicy`，未声明工具直接拒绝；`always_ask` 通过 `ActionBroker` 写入 `requires_action` 并等待 `user.tool_confirmation`。manifest custom tool 由 `CustomToolResolver` 暂停执行，等待调用方提交 `user.custom_tool_result`。
- **远程 Worker**：Host 的 `RemoteWorkerExecutor` 创建 work item；Worker 经 `MAWorkerClient.poll` 领取并 ack，`WorkItemRunner` 重建文本历史与受管 runtime，同时启动 heartbeat 和 inbox SSE。运行事件由 `IngestSink` 分批回传；lease 丢失立即停止，成功后以 `consumed_through_seq` complete，Host 再由 `ingest_worker_events` / `complete_work` 收口会话状态。
- **流与恢复**：session/thread SSE 先按 `seq` replay 持久事件，再订阅 `EventBroadcaster`；支持 `Last-Event-ID`、ping、缺口补读和有限的 message preview。Host 启动时恢复 unsettled session，终止旧 lease；`rehydrate_agent_messages` 只从历史 `user.message` / `agent.message` 恢复文本，不重建旧 tool round。
- **受管资源**：`CredentialBrokerExtension` 每轮解析 vault、创建私有 MCP pool、注入 `SessionEgressPolicy` 并注册 `SecretRedactor`；`MemoryMountExtension` 将 memory snapshot 物化到 session workdir，轮次后以版本条件写入同步，冲突时保留副本而不静默覆盖。

## Data and configuration
- `agenticx/managed/protocol.py` 使用 `extra="forbid"` 的 Pydantic discriminated unions 定义 client/server events、content blocks、`SessionRecord`、`EnvironmentRecord`、`WorkItemRecord`、PAT scopes 与 lease/SSE 常量；client batch 限 1–10 个事件并拒绝同批重复 resolution。
- `agenticx/managed/manifest.py` 约束 model、system、builtin/MCP/custom tools、skills、runtime limits、metadata 与 coordinator multi-agent members；归一化结果使用 canonical JSON 计算稳定 `manifest_hash`。`compile_spec` 进一步拒绝未知 builtin、保留名冲突和 agent 自引用。
- `agenticx/managed/host/config.py:HostConfig` 是开发 Host 配置中心：`data_dir` 派生 `ma.sqlite3` 与 `sessions/`，并承载 tokens、agents、environments、enterprise policy、task/thread 开关、运行限额和 vault。`load_agents_file` 从 YAML 加载静态定义；vault 只接受 `${cred:NAME}` 引用并拒绝明文 secret 与保留环境变量名。
- `agenticx/managed/events/sqlite_store.py:SqliteEventStore` 以 WAL SQLite 持久化 `ma_sessions` 与按 session 单调递增的 `ma_session_events`；同一连接还承载 `agenticx/managed/host/work_queue.py:SqliteWorkQueue` 的 work item lease 状态。
- `agenticx/managed/credentials.py` 支持本地 `CredentialStore` 与企业内部 HTTP vault；`agenticx/managed/memory.py` 同时提供企业 memory-store HTTP client 和 hermetic `InMemoryMemoryStoreClient`。凭据 secret 只保留在进程内，事件、流和日志写出前由 `agenticx/managed/redaction.py` 替换。
- `agenticx/managed/gateway_llm.py:GatewayLLMFactory` 在 LiteLLM 请求中注入 tenant/session/agent trace headers；`agenticx/managed/budget.py:BudgetGuardedLLMFactory` 在模型请求前累计 token usage，并以 `BudgetExceededError` 阻断超过 session budget 的后续调用。
- Data Suite 配置通过 YAML dataclass loader 进入 `DictDriftConfig`、`QualityPatrolConfig` 与 `PatrolScheduleConfig`；`run_scheduled` 的 `tick_id` 提供幂等键，cron 字符串仅作为配置元数据，不负责真正调度。

## Dependencies
- Upstream: `pydantic` 提供协议/manifest 严格模型，`FastAPI` 提供 Host 路由与 SSE 响应，`httpx` 用于 API、Worker、vault、memory 与 webhook 客户端，`PyYAML` 加载开发配置；SQLite、asyncio 与 subprocess 承担本地持久化、广播、任务和 lease。
- Runtime integration: `ManagedAgentBuilder` 依赖 `agenticx.runtime.agent_runtime.AgentRuntime`、hooks、confirm gate 与 session workdir；工具 schema 来自 `agenticx.cli.agent_tools.STUDIO_TOOLS`，执行回退依赖 `agenticx.tools.fallback_chain`，MCP 会话依赖 `agenticx.tools.remote_v2.MCPClientV2`。
- Policy and model integration: 权限层依赖 `agenticx.runtime.enterprise_agent_policy`；默认模型工厂走本地 provider 配置，Gateway 变体依赖 `agenticx.llms.litellm_provider.LiteLLMProvider`。
- Downstream: CLI 可通过 `MAApiClient` 操作 Host；桌面执行端通过 `agenticx.managed.worker` 运行远程 assignment；企业 Host 可替换 registry、event store、authenticator、LLM、credential 和 memory client，而不改变协议模型。

## Tests and operations
- `tests/managed/` 对协议、manifest/spec、state machine、SQLite store、broadcast/SSE、Host API/config、权限、预算、凭据/出口/脱敏、MCP、memory、tasks、threads、work queue 与 Worker SDK/路由均有专门测试；端到端门禁覆盖 `test_w1_gate_e2e.py`、`test_w1_gate_worker_e2e.py`、`test_w4_memory_gate.py`、`test_w4_vault_gate.py`。
- `tests/managed/templates/` 覆盖 Data Suite 的 NL2SQL 闭环、CLI bridge、质量巡检、字典漂移、schedule tick 与模板 E2E；协议/manifest/rubric 的跨实现样本位于 `tests/fixtures/managed_agents/`，由 `test_fixture_parity.py` 校验。
- Host 的最小运行依赖一个 agents YAML、bearer token 与可写 `data_dir`；默认环境是 `local` subprocess 和 `worker` desktop-worker。task/thread 功能默认关闭，必须通过 `HostConfig.tasks_enabled` / `threads_enabled` 显式开启。
- 运维上需关注 SQLite 文件与 session workdir 的同盘持久化、SSE subscriber overflow 后重连、Worker 15 秒心跳/120 秒 lease、Host 重启对旧 lease 和活跃 thread 的终止语义，以及 task 日志目录 `.ma/tasks` 的生命周期。
- 凭据与 memory 扩展均有关闭/flush 路径；Host shutdown 按逆序执行扩展 hook 后关闭 executor/store。修改事件模型、manifest 或 Worker 协议时，应同步运行 Host 与 Worker gate，避免一端可解析而另一端拒绝。
