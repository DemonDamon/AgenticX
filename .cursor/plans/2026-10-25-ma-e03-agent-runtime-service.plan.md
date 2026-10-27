# MA-E03 托管运行时服务 `enterprise/apps/agent-runtime`

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W2 · MA-E03）
Depends-on:
- MA-00 `.cursor/plans/2026-10-25-ma-00-protocol-freeze.plan.md`（已实现：`agenticx/managed/{protocol,manifest,errors}.py`）
- MA-A01 `.cursor/plans/2026-10-25-ma-a01-agent-spec-builder.plan.md`（`LLMFactory` / `LLMCallContext` / `ManagedAgentBuilder`）
- MA-A02 `.cursor/plans/2026-10-25-ma-a02-event-store-state-machine.plan.md`（`EventStore` 抽象、`StoredEvent`、`ENVELOPE_KEYS`、`ALLOWED_SESSION_UPDATE_KEYS`、`MAX_LIST_LIMIT`、`agenticx.managed.ids`）
- MA-A03 `.cursor/plans/pending/2026-10-25-ma-a03-tool-permission-engine.plan.md`（`ManagedConfirmGate` 语义，本子规划不改它）
- MA-A04 `.cursor/plans/pending/2026-10-25-ma-a04-managed-host.plan.md`（`create_ma_app` / `HostConfig` / `Principal` / `AgentRegistry` / `TokenAuthenticator` / `MAHostState`）
- MA-A05 `.cursor/plans/pending/2026-10-25-ma-a05-worker-sdk.plan.md`（`WorkItemRow` / `RemoteWorkerExecutor` / `build_worker_router` / `stop_expired_work` / `SqliteWorkQueue` 的语义）
- MA-E01 `.cursor/plans/2026-10-25-ma-e01-schema.plan.md`（PG/MySQL DDL：`ma_sessions` / `ma_session_events` / `ma_work_items` / `ma_session_usage`，已落地 `0061_ma_control_plane.sql`）
- MA-E02 `.cursor/plans/pending/2026-10-25-ma-e02-agent-versioning-admin.plan.md`（`/api/internal/ma/agent-versions/:agentId/:version`、`/api/internal/ma/environments/:envId`、`/api/internal/ma/pat-introspect`，Bearer `MA_INTERNAL_TOKEN`）

> 风险等级：高（新服务进程、执行任意 bash、持有网关凭证）。合入前建议强推理档只读审查。
>
> **上游未实现声明**：MA-A01–A05、MA-E02 在本子规划写作时尚未全部合入。下文引用它们的类名、函数签名、文件路径一律按各自 plan 的规定书写，**以实际实现为准，实施前逐一核对**（`rg "def create_ma_app|class HostConfig|class WorkItemRow|def build_worker_router|def stop_expired_work|class RemoteWorkerExecutor" agenticx/managed`）。若签名与本文不一致，按实际签名调整调用代码，**不得**为迁就本文去修改 `agenticx/managed/**` 已有文件。

---

## 0. 一句话目标

新建 Python FastAPI 服务 `enterprise/apps/agent-runtime`（默认端口 **8092**），把 MA-A04 的 `create_ma_app` 装配成企业版：会话事件落 PG（E01 表）、Agent 与环境从 admin-console 内部接口拉取并缓存、调用方 PAT 经 admin-console 内省（30 秒缓存）、所有模型调用经企业 Go 网关（服务 PAT + 会话 / Agent / Trace 头）、云端环境的工具在「每会话私有工作目录 + 操作系统命令沙箱」里执行；并接入本地 `start-dev.sh`、docker-compose 与 nginx `/ma/v1` 分流。

---

## 1. 根因 / 动机与证据链

### 1.1 来自 master 的约束（不得改）

| master 节 | 约束 | 本子规划落点 |
|---|---|---|
| §4 决策 1 | 托管运行时是 Python，复用框架；新建 `enterprise/apps/agent-runtime`，端口 8092，参照 `apps/context-service` | §4 目录骨架；`create_ma_app` 注入四个可替换件 |
| §4 决策 3 | 模型调用一律经企业网关；agent-runtime 用服务 PAT；请求头带 `X-AgenticX-Trace-Id` 与会话 / Agent 主体 | §5.6 `GatewayLLMFactory` |
| §4 决策 4 | 对外 `/ma/v1/*` 一个前缀两个后端：控制面 → admin-console `/api/ma/v1/*`；会话面 → agent-runtime；PAT 内省本地缓存 30 秒 | §5.10 nginx；§5.5 `PatIntrospectionAuthenticator` |
| §2.3 | `ma_sessions` / `ma_session_events` / `ma_work_items` / `ma_session_usage` 唯一写入方是 agent-runtime；Python 用 SQLAlchemy Core 手写映射 + parity 测试比对列名 | §5.2 `tables.py`；§7 `test_tables_parity.py` |
| §2.3 | 控制面资源由 agent-runtime 调 `/api/internal/ma/*`（Bearer `MA_INTERNAL_TOKEN`） | §5.4 `AdminConsoleClient` |
| §4 决策 7 | Session 创建时锁定版本；渠道 / 分发「跟随最新」或「固定版本」 | §5.4：`agent_version` 缺省时取 `effective`（admin-console 按路由解析） |
| §1.4 | 隔离第一档 = 每 Session 一个工作目录 + 可选每 Session 一个容器 | §2 决策 D3 |
| §12 变更记录 | 托管内置工具白名单 14 个、`ManagedConfirmGate`、`max_tool_rounds` 软上限 | 本子规划不改，沿用 |

### 1.2 现状代码证据（2026-10-25 核对，实施前重新核对行号）

| 文件 | 行 | 事实 | 对本子规划的影响 |
|---|---|---|---|
| `enterprise/apps/context-service/Dockerfile` | 1–38 | Python 服务先例：`python:3.12-slim`、构建上下文为仓库根、`useradd --uid 10001`、`HEALTHCHECK` 打 `/healthz`、`CMD uvicorn ...:create_app --factory` | 本服务 Dockerfile 结构照抄；但不做「只拷子包」，见 D7 |
| `enterprise/apps/context-service/context_service/config.py` | 14–19、49–69 | `_read_secret(name)` 先读 `NAME_FILE` 再读 `NAME`；缺 token 抛 `RuntimeError` 拒绝启动 | `Settings.from_env` 同样写法、同样 fail-closed |
| `enterprise/apps/context-service/tests/conftest.py` | 1–10 | 测试把服务根加入 `sys.path`；运行命令 `python3 -m pytest -o addopts="" enterprise/apps/context-service/tests -q` | 同样约定 |
| `enterprise/apps/gateway/internal/server/server.go` | 676 | `r.Post("/v1/chat/completions", s.handleChatCompletions)` | 网关入口 |
| 同上 | 700–715 | 先 `identityFromRequest`，再要求 `workspace:chat` scope（`hasEffectiveScope`），缺则 403 | 服务 PAT 必须含 `workspace:chat` |
| 同上 | 1537–1559 | Bearer 以 `agx-pat-` 开头 → PAT 校验，**tenant / user / dept 一律取自 PAT 本身**；随后 `enrichTraceFromRequest` | **网关不接受用请求头覆盖 tenant / user**；模型调用在网关审计里的 user 是服务 PAT 的属主（见 D4） |
| `enterprise/apps/gateway/internal/server/trace_context.go` | 12–19、34–47 | 网关读取的关联头恰为：`X-AgenticX-Trace-Id`、`X-AgenticX-Trace-Step`（正整数）、`X-AgenticX-Trace-Stage`（`[a-z0-9._-]`，≤64）、`X-AgenticX-Session-Id`（PAT 身份无 session 时生效）、`X-AgenticX-Deployment-Id`（≤128）、`X-Agenticx-Agent-Id`（≤128） | `GatewayLLMFactory` 只发这 6 个头 + provider 头，不发网关不认的头 |
| `enterprise/apps/gateway/internal/routing/decision.go` | 11–14、52–56 | `x-agenticx-provider` 头配合 `model` 名命中 admin 配置的 provider | 请求体 `model` = manifest model 去掉 `<provider>/` 前缀，头 `x-agenticx-provider: <provider>` |
| `enterprise/apps/web-portal/src/lib/collab-room/agent-reply.ts` | 196–211 | 门户现有云端调用：`model.split("/")` 后 body 用 `modelName`，头 `x-agenticx-provider: providerId`、`x-agenticx-trace-*`、`x-agenticx-agent-id` | 与 §5.6 头集合一致（门户另发的 `x-tenant-id` 等网关并不读取） |
| `enterprise/apps/gateway/internal/server/server.go` | 1398–1407 | 策略拦截 `writePolicyError`：`{"error":{"code":"90001","message":"请求触发合规拦截",...}}` | 模型请求被拦截时，W2 映射为 `retries_exhausted`（已知限制 §10.3） |
| `agenticx/llms/litellm_provider.py` | 147–167、196–235、323–375、433–497 | `LiteLLMProvider`（pydantic）有 `invoke` / `ainvoke` / `stream` / `stream_with_tools` / `_astream_generator`，全部把 `**kwargs` 透传给 `litellm.completion`；私网 base_url 时注入不走代理的 OpenAI client（`_build_no_proxy_openai_client` 109–129） | `GatewayLiteLLMProvider` 子类只需在每个入口往 kwargs 里合并 `extra_headers` |
| `agenticx/llms/litellm_provider.py` | 62–80 | 自定义 OpenAI 兼容网关应把模型名写成 `openai/<name>` | 本服务一律 `model=f"openai/{spec.model}"`、`base_url=<gateway>/v1` |
| `agenticx/runtime/session_boundary.py` | 13–14、24–30、33–53 | `sessions_root() = Path.home()/".agenticx"/"sessions"`；`ensure_session_workdir` 建 `<root>/<sid>/work`；`foreign_session_denial` **以 `sessions_root()` 为基准**拒绝访问别的会话目录 | 把进程 `HOME` 设成隔离目录，并让 A04 的 `workdir_root` 恰好等于 `sessions_root()`，跨会话拒绝即自动生效（D3） |
| `agenticx/cli/agent_tools.py` | 5269–5277 | 文件类工具 `_raise_if_path_denied` 调 `foreign_session_denial(path, session_id)` | 同上 |
| `agenticx/cli/agent_tools.py` | 150–159、6050–6121 | `bash_exec` 经 `_apply_command_sandbox` 包一层 OS 沙箱；权限读 `session.command_permissions` 或配置 `permissions.command_permissions`；沙箱不可用时走 `_confirm(...)` | 托管模式下 `ManagedConfirmGate` 对已授权工具一律放行（MA-A03 §4.5）→ **沙箱不可用 = 无隔离执行**，所以启动时必须探测（D3） |
| `agenticx/runtime/command_sandbox.py` | 136–146、187–232、326–360 | 缺省权限 `workspace-write`；Linux 需要 `bwrap`（bubblewrap），macOS 用 `sandbox-exec` | 镜像装 `bubblewrap`；启动探测 `build_command_sandbox_plan(["/bin/true"], ...)` |
| `agenticx/runtime/command_sandbox.py` | 211–216；`_bubblewrap_argv`（`--unshare-pid` `--proc` `--new-session`） | 子进程继承 `os.environ`（只剔除 `AGX_DESKTOP_TOKEN` / `AGX_CC_BRIDGE_TOKEN`）；bwrap 新 PID 命名空间 + 新 `/proc` | **必须在服务启动后从 `os.environ` 擦除全部密钥变量**（D8）；bwrap 下子进程看不到父进程 `/proc/<pid>/environ` |
| `enterprise/packages/db-schema/drizzle/0061_ma_control_plane.sql` | `ma_sessions` / `ma_session_events` / `ma_work_items` / `ma_session_usage` 段 | E01 DDL（列名见 §4.2 表） | SQLAlchemy 映射逐列对齐 |
| 同上 `ma_work_items` | — | **没有** `inbox_after_seq` / `consumed_through_seq`，而 MA-A05 `WorkItemRow` 需要这两列（A05 §4.1） | 本子规划追加迁移 `0062_ma_work_inbox.sql` / MySQL `0036_ma_work_inbox.sql`（§5.3） |
| `enterprise/packages/db-schema/src/__tests__/migration-inventory.test.ts` | 16–49 | 断言 PG journal 61 条、磁盘 63 个 `.sql`、末 3 tag | 需同步改为 62 / 64 |
| `enterprise/packages/db-schema/src/__tests__/schema-parity.test.ts` | 116–155、171–208 | MySQL 文件清单与 journal 逐条列到 `0035_ma_control_plane` | 追加 `0036_ma_work_inbox` |
| `enterprise/packages/db-schema/src/__tests__/ma-schema.test.ts` | 30–120 | `MA_COLUMNS.ma_work_items` 冻结列集合 | 追加两列 |
| `enterprise/packages/db-schema/src/schema/ma-sessions.ts` | 56–78 | `maWorkItems` drizzle 定义 | 追加两列（PG + MySQL 两份） |
| `enterprise/apps/admin-console/src/app/api/internal/pat-revocation-snapshot/route.ts` | 1–18 | 吊销快照接口用 `GATEWAY_INTERNAL_TOKEN` 鉴权 | 本服务**不持有**网关内部 token（E02 D7 分开轮换），所以不接吊销快照；吊销生效上限 = 30 秒缓存 TTL（D5） |
| `enterprise/packages/iam-core/src/pat-service.ts` | 37–45、94–136、186–205 | `createPat({tenantId,userId,deptId,name,createdBy,scopes,expireDays})` 返回 `{record, token}`；`verifyPat` | 本地开发 PAT 预置脚本直接调用（§5.12） |
| `enterprise/packages/iam-core/src/repos/users.ts` | 96–113 | `loadAuthUserByEmail(tenantId, email)` | 预置脚本按邮箱找开发管理员 |
| `enterprise/scripts/migrate-runtime-legacy.ts` | 1–76 | TS CLI 样板：`loadEnvLocal`、`finally` 里 `__resetDatabaseForTests()` | 预置脚本照抄结构 |
| `enterprise/scripts/start-dev.sh` | 52–62、130–143、161–181、248–311 | 参数解析 `case "$arg"`；从 `*_FILE` 读 token 并 export；本地自动迁移块；先起 Next 再起 gateway；`wait_for_http` 带 `--noproxy '*'` | 新增 `--with-agent-runtime` 开关与启动块（§5.11） |
| `enterprise/scripts/start-dev-with-infra.sh` | 22、44–51、189 | `APP_ARGS` 透传白名单 `--all|--ui=*|--webpack` | 白名单追加 `--with-agent-runtime` |
| `enterprise/scripts/bootstrap.sh` | 270–293、344–397 | local 模式在 `.local-secrets/` 生成 `gateway_internal.token`；`cat > "$ENV_FILE" <<EOF` **整体重写** `.env.local` | 同样生成 `ma_internal.token`，heredoc 追加 MA 行 |
| `enterprise/deploy/nginx/gateway.conf` | 16–28、30–91 | upstream 静态主机名；`/v1/` → 网关；`/api/chat/` 是 SSE 先例（`proxy_buffering off`）；`/admin/` 剥前缀转 admin-console；`location /` → web-portal | 新增 `/ma/v1` 三段 location（§5.10） |
| `enterprise/deploy/docker-compose/test.yml` | 4–19 | 也挂载同一份 `gateway.conf`，但**没有** agent-runtime 容器 | nginx 不能用静态 upstream 指向 agent-runtime（启动即 `host not found`），改用 `resolver` + 变量 |
| `enterprise/deploy/docker-compose/prod.yml` | 1–178 | 服务清单（nginx / gateway-a/b / web-portal / admin-console / PG / redis） | 新增 `agent-runtime` 服务（profile `managed-agents`） |
| `pyproject.toml` | 32–74、180–184 | 核心依赖不含 SQLAlchemy / PG 驱动；`database` extra 有 `psycopg2-binary`、`SQLAlchemy` | 服务 `requirements.txt` 显式列出 `SQLAlchemy[asyncio]`、`asyncpg`、`psycopg2-binary`、`aiosqlite` |

---

## 2. 关键设计决策（本子规划内定）

| # | 决策 | 理由 |
|---|---|---|
| D1 | **只装配不重写**：服务代码只做「配置 → 构造四个注入件 → `create_ma_app(config, llm_factory=, store=, registry=, authenticator=)` → 加中间件与健康检查 → 可选接线 Worker 面」。不复制、不改 MA-A04/A05 的路由与执行器 | master §4 决策 1；单一事实来源 |
| D2 | **PG 存储用 SQLAlchemy Core，方言无关地写**：事件库走 async 引擎（`postgresql+asyncpg`），Work Queue 走 sync 引擎（`postgresql+psycopg2`，因为 MA-A05 的 `RemoteWorkerExecutor` / `ingest.py` / `worker_routes.py` **同步**调用 Work Queue 方法）。同一套代码在测试里跑 `sqlite+aiosqlite` / `sqlite`，所以 CI 无 PG 也有契约测试；另有 `MA_TEST_DATABASE_URL` 门控的真 PG 测试 | 不改 A05 的同步接口；sync 调用每次只做 1–2 条短 SQL，阻塞事件循环毫秒级，已写入风险 |
| D3 | **云端环境执行边界（诚实范围）**：<br>① 每会话私有工作目录：进程 `HOME` 必须是隔离目录 `MA_RUNTIME_HOME`，`HostConfig.data_dir = $HOME/.agenticx`，于是 A04 的 `workdir_root = $HOME/.agenticx/sessions` 恰等于 `session_boundary.sessions_root()`，文件工具的跨会话拒绝（`foreign_session_denial`）自动生效；<br>② `bash_exec` 复用框架现有 OS 命令沙箱（Linux=bubblewrap，macOS=sandbox-exec），权限固定 `workspace-write`：可写根 = 本会话工作目录 + 私有临时目录，Linux 下读也被限制；<br>③ 启动时探测沙箱，`MA_RUNTIME_COMMAND_SANDBOX=required`（容器默认）探测失败即**拒绝启动**；`best_effort`（仅本机开发）探测失败只告警，bash 将无 OS 隔离执行；<br>④ **不做**「每会话一个容器」：`agenticx/sandbox` 的 docker / remote 后端未接进 `dispatch_tool_async`，接入需改 `agent_tools.py`，超出本子规划。环境配置 `sandbox_backend` 取值 `subprocess` / `docker` 都按「运行时容器内 + OS 命令沙箱」执行；`remote` 在建会话时 400 拒绝；<br>⑤ **不做**出站域名白名单（`egress_allow_domains` 只记录不执行），归 MA-A06 | 与 master §1.4「隔离第一档」一致；把做不到的写清楚，不在 W2 门里冒充「docker 沙箱」（见 §10 问题 Q1） |
| D4 | **网关鉴权 = 服务 PAT**：`MA_RUNTIME_GATEWAY_TOKEN` 是一个 scope 至少含 `workspace:chat` 的 iam-core PAT。网关按 PAT 属主记 tenant / user，**不接受**用户覆盖头；终端用户归属靠 `X-AgenticX-Session-Id` 关联到 `ma_sessions.created_by_user_id`。用户级网关配额 / 用户级模型可见性**不在网关层对托管会话生效**（门户侧 MA-E04 做模型可见性前置校验；配额归 MA-E10） | 网关代码 `server.go:1537-1559` 的真实行为；不改 Go |
| D5 | **调用方 PAT 内省**：`POST {admin}/api/internal/ma/pat-introspect`，按 `sha256(token)` 缓存 30 秒（含 `active:false` 结果）；不接 `pat-revocation-snapshot`（它要 `GATEWAY_INTERNAL_TOKEN`）。吊销最长 30 秒后生效 | master §4 决策 4 的缓存要求；E02 D7 token 分离 |
| D6 | **代表用户创建会话（on-behalf-of）**：门户用一个服务 PAT 调本服务，但会话归属须是真实用户。请求头 `X-AgenticX-On-Behalf-Of: <user ULID>`，**仅当**内省出的 scopes 含 `ma:sessions:on_behalf` 或 `ma:admin` 时生效，`Principal.user_id` 替换为该值；两者都不含却带该头 → 403 `forbidden_scope`。用纯 ASGI 中间件把头写进 `contextvars`，鉴权器读取 | A04 `create_session` 用 `principal.user_id` 写 `created_by_user_id`；不改 A04 也能归属到真实用户；E05 按用户筛选依赖它 |
| D7 | **镜像整包安装 agenticx**：Dockerfile 拷 `pyproject.toml` / `README.md` / `LICENSE` / `agenticx/` 后 `pip install "/src[mcp]"`，再装本服务 `requirements.txt`。不沿用 context-service 的「只拷子包」 | `agenticx.managed.builder` → `agenticx.cli.agent_tools`（1.3 万行）→ 大量子包，窄拷贝无法保证导入闭包；以镜像内导入 smoke 为门槛 |
| D8 | **密钥擦除**：读完 `Settings` 后，从 `os.environ` 删除所有名字匹配 `^(.*_)?(TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|DATABASE_URL)(_FILE)?$` 的变量（含 start-dev 从 `.env.local` 带进来的 JWT 私钥、admin 口令等）。网关 PAT 只存在于 `GatewayLLMFactory` 对象内存里 | 命令沙箱子进程继承 `os.environ`（`command_sandbox.py:211-216`） |
| D9 | **隐式默认云环境**：Agent 没有 `default_environment_id` 时，A04 会用 `"local"`。本服务 registry 对 `environment_id == "local"` 直接返回合成的 cloud 环境（`MA_RUNTIME_IMPLICIT_LOCAL_ENV=1` 默认开）；`runtime == "desktop_worker"` 且无默认环境的 Agent，registry 把 `default_environment_id` 替换为 `"unset"`，于是建会话得到 404 `environment_not_found`，不会被静默跑到云端 | E01 回填后所有存量 Agent 都没有默认环境；W2 门不应要求管理员先建环境 |
| D10 | **单副本**：会话 actor、SSE 广播、Work Queue 唤醒都在进程内（A04/A05 设计）。W2 部署固定 1 个副本；compose 不加 `deploy.replicas`；nginx 只指向一个实例。多副本需会话亲和路由，列入后续 | 避免两进程各持一个状态机 |
| D11 | **Worker 面默认关闭**：`MA_RUNTIME_DESKTOP_WORKER_ENABLED=0` 时不接线 `desktop_worker` 执行器与 `work/*` 路由 → `desktop_worker` 环境建会话 400（A04 `supports_environment`）。`worker_keys` 领取授权由 MA-D01 实现后再打开 | A05 明确 W1 不校验 `worker_keys`；fail-closed |
| D12 | **只支持 PostgreSQL**：`DATABASE_DIALECT=mysql` 或 `mysql://` URL → 拒绝启动并提示。MySQL 版存储列入后续 | 控制工作量；E01 的 MySQL DDL 已就绪，后续只需加驱动与 `ON DUPLICATE KEY` 分支 |
| D13 | `GatewayLLMFactory` 放在框架 `agenticx/managed/gateway_llm.py`（新文件），不放 app 内 | MA-D01（桌面 Worker 用设备 PAT 经网关）要复用同一实现 |

---

## 3. In scope / Out of scope

### 3.1 In scope（只能创建或修改这些文件）

框架（Python，只新增）：
- 新建 `agenticx/managed/gateway_llm.py`
- 新建 `tests/managed/test_gateway_llm.py`

服务（Python，全部新建，路径相对 `enterprise/apps/agent-runtime/`）：
- `README.md`
- `Dockerfile`
- `requirements.txt`
- `ma_agent_runtime/__init__.py`
- `ma_agent_runtime/config.py`
- `ma_agent_runtime/db.py`
- `ma_agent_runtime/tables.py`
- `ma_agent_runtime/pg_event_store.py`
- `ma_agent_runtime/pg_work_queue.py`
- `ma_agent_runtime/control_plane.py`
- `ma_agent_runtime/isolation.py`
- `ma_agent_runtime/worker_wiring.py`
- `ma_agent_runtime/app.py`
- `tests/conftest.py`
- `tests/fakes.py`
- `tests/test_config.py`
- `tests/test_db_url.py`
- `tests/test_tables_parity.py`
- `tests/test_pg_event_store_contract.py`
- `tests/test_pg_work_queue_contract.py`
- `tests/test_control_plane.py`
- `tests/test_isolation.py`
- `tests/test_app_e2e.py`

db-schema（TS，追加迁移）：
- 新建 `enterprise/packages/db-schema/drizzle/0062_ma_work_inbox.sql`
- 新建 `enterprise/packages/db-schema/drizzle-mysql/0036_ma_work_inbox.sql`
- 修改 `enterprise/packages/db-schema/drizzle/meta/_journal.json`（追加 1 条）
- 修改 `enterprise/packages/db-schema/drizzle-mysql/meta/_journal.json`（追加 1 条）
- 修改 `enterprise/packages/db-schema/src/schema/ma-sessions.ts`（`maWorkItems` 加 2 列）
- 修改 `enterprise/packages/db-schema/src/mysql-schema/ma-sessions.ts`（同上）
- 修改 `enterprise/packages/db-schema/src/__tests__/migration-inventory.test.ts`
- 修改 `enterprise/packages/db-schema/src/__tests__/schema-parity.test.ts`
- 修改 `enterprise/packages/db-schema/src/__tests__/ma-schema.test.ts`

脚本与部署：
- 新建 `enterprise/scripts/ma-provision-dev-tokens.ts`
- 修改 `enterprise/package.json`（scripts 加 1 行）
- 修改 `enterprise/scripts/start-dev.sh`
- 修改 `enterprise/scripts/start-dev-with-infra.sh`（白名单 1 处）
- 修改 `enterprise/scripts/bootstrap.sh`
- 修改 `enterprise/.env.local.example`（追加说明行）
- 修改 `enterprise/deploy/nginx/gateway.conf`
- 修改 `enterprise/deploy/docker-compose/prod.yml`

### 3.2 Out of scope（不得修改）

- `agenticx/managed/**` 已有文件（MA-00 / A01–A05 的产物）、`agenticx/runtime/**`、`agenticx/cli/**`、`agenticx/studio/**`（含 `server.py`）、`agenticx/sandbox/**`、`agenticx/llms/**`。
- `enterprise/apps/gateway/**`（Go 一行不改）、`enterprise/apps/admin-console/**`、`enterprise/apps/web-portal/**`（门户切换属 MA-E04）、`enterprise/packages/iam-core/**`。
- `deploy/docker-compose/{test,prod.aliyun,prod.ecloud,dev}.yml`（镜像覆盖层的 agent-runtime 镜像名后续补）、K8s 清单。
- 每会话容器、出站域名白名单、Vault 凭证注入、MCP 连接、Memory Store、MySQL 存储、多副本、`worker_keys` 授权、`policy_blocked` 停止原因映射。

---

## 4. 目录与模块骨架

### 4.1 目录

```text
enterprise/apps/agent-runtime/
├── Dockerfile
├── README.md
├── requirements.txt
├── ma_agent_runtime/
│   ├── __init__.py
│   ├── app.py            # create_app() / build_app(settings, ...)
│   ├── config.py         # Settings.from_env, scrub_secret_env, apply_runtime_env_defaults
│   ├── control_plane.py  # AdminConsoleClient, AdminConsoleAgentRegistry, PatIntrospectionAuthenticator, OnBehalfOfMiddleware
│   ├── db.py             # build_engines, split_database_url
│   ├── isolation.py      # ensure_isolated_home, write_runtime_config, probe_command_sandbox
│   ├── pg_event_store.py # PgEventStore(EventStore)
│   ├── pg_work_queue.py  # PgWorkQueue (same sync surface as A05 SqliteWorkQueue)
│   ├── tables.py         # SQLAlchemy Core tables mirroring E01 DDL
│   └── worker_wiring.py  # wire_worker_plane(app, work_queue)
└── tests/ ...
```

所有 Python 文件头：

```python
#!/usr/bin/env python3
"""<English one-line description>.

Author: Damon Li
"""
```

英文注释与 docstring、绝对 import、import 置顶（仓库规则）。服务包名用 `ma_agent_runtime`，避免与 `agenticx.runtime.agent_runtime` 混淆。

### 4.2 E01 列对照（SQLAlchemy 映射必须逐列一致）

| 表 | 列（顺序同 DDL） |
|---|---|
| `ma_sessions` | `id` varchar(26) PK · `tenant_id` varchar(26) NN · `agent_id` varchar(26) NN · `agent_version` integer NN · `environment_id` varchar(26) · `created_by_user_id` varchar(26) · `source` varchar(16) NN · `status` varchar(16) NN default `idle` · `stop_reason` jsonb · `title` varchar(255) · `vault_ids` jsonb NN default `[]` · `resources` jsonb NN default `[]` · `usage_totals` jsonb NN default `{}` · `last_seq` bigint NN default 0 · `metadata` jsonb NN default `{}` · `archived_at` timestamptz · `created_at` timestamptz NN · `updated_at` timestamptz NN |
| `ma_session_events` | `id` varchar(26) PK · `tenant_id` varchar(26) NN · `session_id` varchar(26) NN · `seq` bigint NN · `thread_id` varchar(26) · `type` varchar(64) NN · `payload` jsonb NN · `created_at` timestamptz NN · `processed_at` timestamptz |
| `ma_work_items` | `id` varchar(26) PK · `tenant_id` varchar(26) NN · `session_id` varchar(26) NN · `environment_id` varchar(26) NN · `status` varchar(16) NN default `queued` · `claimed_by_user_id` varchar(26) · `claimed_by_device` varchar(64) · `claimed_at` timestamptz · `lease_expires_at` timestamptz · `last_heartbeat_at` timestamptz · `attempts` integer NN default 0 · `completed_at` timestamptz · `error` text · `created_at` timestamptz NN · `updated_at` timestamptz NN · **`inbox_after_seq` bigint NN default 0（0062 新增）** · **`consumed_through_seq` bigint（0062 新增）** |
| `ma_session_usage` | `id` varchar(26) PK · `tenant_id` varchar(26) NN · `session_id` varchar(26) NN · `agent_id` varchar(26) NN · `agent_version` integer NN · `user_id` varchar(26) · `model` varchar(160) NN · `input_tokens` bigint NN · `output_tokens` bigint NN · `cache_read_input_tokens` bigint NN · `tool_calls` integer NN · `runtime_ms` bigint NN · `is_error` boolean NN · `event_seq` bigint · `created_at` timestamptz NN |

注意 `environment_id` 是 varchar(26)：隐式环境 id `"local"`（5 字符）与 `"unset"` 都放得下。

---

## 5. 精确落点

### 5.1 `ma_agent_runtime/config.py`

```python
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Mapping, MutableMapping

DEFAULT_ADMIN_URL = "http://127.0.0.1:3001"
DEFAULT_GATEWAY_URL = "http://127.0.0.1:8088/v1"
SECRET_ENV_RE = re.compile(r"^(?:.*_)?(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|DATABASE_URL)(?:_FILE)?$")
RUNTIME_ENV_DEFAULTS: Mapping[str, str] = {
    "AGX_LEARNING_ENABLED": "0",
    "AGX_SESSION_FTS": "0",
    "AGX_SKILL_MANAGE": "0",
}
CommandSandboxMode = Literal["required", "best_effort"]


def read_secret(environ: Mapping[str, str], name: str) -> str:
    """NAME_FILE wins over NAME (same convention as context-service). Strips whitespace."""


@dataclass(frozen=True)
class Settings:
    database_url: str                 # as given (postgresql://... or, tests only, sqlite:///...)
    internal_token: str
    admin_url: str                    # no trailing slash
    gateway_url: str                  # no trailing slash, must end with /v1
    gateway_token: str
    home: Path                        # resolved
    registry_cache_seconds: float = 10.0
    pat_cache_seconds: float = 30.0
    llm_timeout_seconds: float = 300.0
    command_sandbox: CommandSandboxMode = "required"
    desktop_worker_enabled: bool = False
    implicit_local_env: bool = True
    interrupt_grace_seconds: float = 3.0
    db_pool_size: int = 10
    allow_sqlite: bool = False

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "Settings": ...


def apply_runtime_env_defaults(environ: MutableMapping[str, str] | None = None) -> None:
    """setdefault each RUNTIME_ENV_DEFAULTS entry."""


def scrub_secret_env(environ: MutableMapping[str, str] | None = None) -> list[str]:
    """Delete every key matching SECRET_ENV_RE; return the sorted list of removed key names (never values)."""
```

**环境变量全表（`from_env` 逐条实现；错误一律 `RuntimeError(f"{NAME}: {reason}")`）：**

| 变量 | 必填 | 默认 | 校验 / 说明 |
|---|---|---|---|
| `DATABASE_URL` | 是 | — | 须以 `postgresql://` 或 `postgres://` 开头；`MA_RUNTIME_ALLOW_SQLITE=1` 时另允许 `sqlite:///`；`mysql://` → `"DATABASE_URL: agent-runtime supports PostgreSQL only in this version"` |
| `DATABASE_DIALECT` | 否 | — | 若设置且不是 `postgresql` → 同上错误 |
| `MA_INTERNAL_TOKEN` / `MA_INTERNAL_TOKEN_FILE` | 是 | — | 空 → `"MA_INTERNAL_TOKEN: (or _FILE) is required; refusing to start"` |
| `MA_RUNTIME_ADMIN_URL` | 否 | `http://127.0.0.1:3001` | 须 `http://` 或 `https://` 开头；去尾 `/` |
| `MA_RUNTIME_GATEWAY_URL` | 否 | `http://127.0.0.1:8088/v1` | 去尾 `/` 后须以 `/v1` 结尾 |
| `MA_RUNTIME_GATEWAY_TOKEN` / `MA_RUNTIME_GATEWAY_TOKEN_FILE` | 是 | — | 须以 `agx-pat-` 开头 → 否则 `"MA_RUNTIME_GATEWAY_TOKEN: must be an agx-pat- token"` |
| `MA_RUNTIME_HOME` | 是 | — | 绝对路径；见 §5.7 `ensure_isolated_home` |
| `MA_RUNTIME_REGISTRY_CACHE_SECONDS` | 否 | `10` | 浮点 ≥0；非法回退默认 |
| `MA_RUNTIME_PAT_CACHE_SECONDS` | 否 | `30` | 浮点 0–300；非法回退默认 |
| `MA_RUNTIME_LLM_TIMEOUT_SECONDS` | 否 | `300` | 浮点 >0 |
| `MA_RUNTIME_COMMAND_SANDBOX` | 否 | `required` | 只接受 `required` / `best_effort`，其他值 → 错误 |
| `MA_RUNTIME_DESKTOP_WORKER_ENABLED` | 否 | `0` | 仅 `"1"` 为真 |
| `MA_RUNTIME_IMPLICIT_LOCAL_ENV` | 否 | `1` | 仅 `"0"` 为假 |
| `MA_RUNTIME_INTERRUPT_GRACE_SECONDS` | 否 | `3` | 浮点 0.5–30 |
| `MA_RUNTIME_DB_POOL_SIZE` | 否 | `10` | 整数 1–50 |
| `MA_RUNTIME_ALLOW_SQLITE` | 否 | `0` | 仅测试用；`"1"` 为真 |
| `HOME` | 是（由启动方设置） | — | 必须与 `MA_RUNTIME_HOME` 指向同一目录（§5.7） |
| `AGX_LEARNING_ENABLED` / `AGX_SESSION_FTS` / `AGX_SKILL_MANAGE` | 否 | `0` | 由 `apply_runtime_env_defaults` setdefault，关闭个人模式学习 / FTS / 技能自建 |

`uvicorn` 的 host / port 不进 `Settings`（Dockerfile CMD 与 start-dev 传参）。

### 5.2 `ma_agent_runtime/db.py` 与 `tables.py`

`db.py`：

```python
@dataclass(frozen=True)
class DatabaseUrls:
    async_url: str
    sync_url: str
    async_connect_args: dict[str, Any]
    sync_connect_args: dict[str, Any]
    dialect: Literal["postgresql", "sqlite"]

def split_database_url(url: str, *, search_path: str | None = None) -> DatabaseUrls: ...
def build_engines(urls: DatabaseUrls, *, pool_size: int) -> tuple[AsyncEngine, Engine]: ...
```

规则：
- `postgresql://` / `postgres://` → `async_url = "postgresql+asyncpg://" + rest`，`sync_url = "postgresql+psycopg2://" + rest`。
- 从 async URL 的 query 中移除 `sslmode`；若原值 ∈ `disable/allow/prefer/require/verify-ca/verify-full`，`async_connect_args["ssl"] = <原值>`（asyncpg 接受这些字符串）；sync URL 保留 `sslmode`。
- `search_path`（仅测试）：async `connect_args["server_settings"] = {"search_path": sp}`；sync `connect_args["options"] = f"-csearch_path={sp}"`。
- `sqlite:///<path>` → async `sqlite+aiosqlite:///<path>`（`connect_args={"timeout": 30}`），sync `sqlite:///<path>`（`connect_args={"timeout": 30, "check_same_thread": False}`）。
- 其他 → `ValueError("unsupported database url")`。
- `build_engines`：PG 用 `create_async_engine(async_url, pool_size=pool_size, max_overflow=pool_size, pool_pre_ping=True, connect_args=...)` 与 `create_engine(sync_url, pool_size=max(2, pool_size // 2), max_overflow=2, pool_pre_ping=True, connect_args=...)`；sqlite 不传 pool 参数。

`tables.py`：

```python
from sqlalchemy import JSON, BigInteger, Boolean, Column, DateTime, Integer, MetaData, String, Table, Text
from sqlalchemy.dialects.postgresql import JSONB

metadata = MetaData()
JSONType = JSON().with_variant(JSONB(), "postgresql")
TS = DateTime(timezone=True)

ma_sessions = Table("ma_sessions", metadata, Column("id", String(26), primary_key=True), ...)
ma_session_events = Table("ma_session_events", metadata, ...)
ma_work_items = Table("ma_work_items", metadata, ...)
ma_session_usage = Table("ma_session_usage", metadata, ...)
MANAGED_TABLES = (ma_sessions, ma_session_events, ma_work_items, ma_session_usage)
```

逐列按 §4.2：varchar(n) → `String(n)`；text → `Text`；integer → `Integer`；bigint → `BigInteger`；boolean → `Boolean`；jsonb → `JSONType`；timestamptz → `TS`；`NOT NULL` → `nullable=False`；有 DDL 默认值的列加 `server_default`（`text("'idle'")` 等，仅供测试 `create_all` 使用）。**不声明外键**（生产表由 drizzle 迁移创建，外键在库里；测试 `create_all` 时不需要 `enterprise_agents`）。唯一约束：`ma_session_events` 加 `UniqueConstraint("session_id", "seq", name="ma_session_events_session_seq_uq")`；`ma_session_usage` 加 `UniqueConstraint("session_id", "event_seq", name="ma_session_usage_session_event_uq")`。

**生产环境本服务从不 `create_all`、从不 DDL。** `create_all` 只出现在测试里。

### 5.3 db-schema 追加迁移（TS）

`enterprise/packages/db-schema/drizzle/0062_ma_work_inbox.sql`（逐字）：

```sql
-- ma_work_items 增加 Worker inbox 游标，供托管运行时的 Work Queue 使用。
-- inbox_after_seq：本工作项从哪个 seq 之后投递用户事件；consumed_through_seq：结束时已处理到的 seq。
ALTER TABLE "ma_work_items" ADD COLUMN IF NOT EXISTS "inbox_after_seq" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "ma_work_items" ADD COLUMN IF NOT EXISTS "consumed_through_seq" bigint;
```

`enterprise/packages/db-schema/drizzle-mysql/0036_ma_work_inbox.sql`（逐字；2 条语句、1 个 breakpoint）：

```sql
-- ma_work_items 增加 Worker inbox 游标（MySQL）
ALTER TABLE `ma_work_items` ADD COLUMN `inbox_after_seq` bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `ma_work_items` ADD COLUMN `consumed_through_seq` bigint NULL;
```

Journal 追加：PG `{"idx": 61, "version": "7", "when": 1788000000000, "tag": "0062_ma_work_inbox", "breakpoints": true}`；MySQL `{"idx": 36, "version": "5", "when": 1788000000001, "tag": "0036_ma_work_inbox", "breakpoints": true}`。

drizzle schema（两份）：在 `maWorkItems` 的 `error` 与 `...auditColumns` 之间插入

```ts
    /** Worker inbox 起点：本工作项投递 seq 大于该值的用户事件。 */
    inboxAfterSeq: bigint("inbox_after_seq", { mode: "number" }).notNull().default(0),
    /** 工作项结束时已处理到的 seq；未结束为 null。 */
    consumedThroughSeq: bigint("consumed_through_seq", { mode: "number" }),
```

（MySQL 版同名同写法，`bigint` 从 `drizzle-orm/mysql-core` 导入，文件里若已导入则复用。）

测试同步：
- `migration-inventory.test.ts`：用例名与断言 `61` → `62`、`[...Array(61).keys()]` → `[...Array(62).keys()]`、末 3 tag → `["0060_enterprise_feature_usage", "0061_ma_control_plane", "0062_ma_work_inbox"]`；`disk has 63 SQL files` → `64`（用例名同步改）。
- `schema-parity.test.ts`：MySQL 文件清单末尾追加 `"0036_ma_work_inbox.sql",`；journal `toEqual([...])` 末尾追加 `expect.objectContaining({ idx: 36, tag: "0036_ma_work_inbox" }),`。PG 表数 `79` 不变。
- `ma-schema.test.ts`：`MA_COLUMNS.ma_work_items` 数组追加 `"inbox_after_seq"`、`"consumed_through_seq"`。

### 5.4 `ma_agent_runtime/control_plane.py`

```python
from __future__ import annotations

import asyncio
import contextvars
import hashlib
import logging
import time
from dataclasses import dataclass
from typing import Any, Callable, Literal, Mapping

import httpx

from agenticx.managed.errors import FORBIDDEN_SCOPE, INTERNAL, INVALID_REQUEST, MAError
from agenticx.managed.host.config import Principal
from agenticx.managed.ids import is_ulid
from agenticx.managed.protocol import AgentRecord, AgentVersionRecord, EnvironmentRecord

IMPLICIT_LOCAL_ENVIRONMENT_ID = "local"
UNSET_ENVIRONMENT_ID = "unset"
ON_BEHALF_OF_HEADER = "x-agenticx-on-behalf-of"
PAT_PREFIX = "agx-pat-"
PAT_CACHE_MAX_ENTRIES = 10000
VersionSelector = int | Literal["effective", "latest"]

on_behalf_of_user: contextvars.ContextVar[str | None] = contextvars.ContextVar("ma_on_behalf_of_user", default=None)


class TTLCache:
    """Tiny monotonic TTL cache. clock() returns seconds. Evicts the oldest insertion when full."""
    def __init__(self, ttl_seconds: float, *, max_entries: int = 1024, clock: Callable[[], float] = time.monotonic) -> None: ...
    def get(self, key: str) -> tuple[bool, Any]: ...     # (hit, value)
    def put(self, key: str, value: Any) -> None: ...


class AdminConsoleClient:
    def __init__(self, base_url: str, internal_token: str, *, transport: httpx.AsyncBaseTransport | None = None,
                 timeout: float = 10.0) -> None: ...
    async def get_agent_version(self, tenant_id: str, agent_id: str, version: VersionSelector) -> dict[str, Any] | None: ...
    async def get_environment(self, tenant_id: str, environment_id: str) -> dict[str, Any] | None: ...
    async def introspect(self, token: str) -> dict[str, Any]: ...
    async def aclose(self) -> None: ...


class AdminConsoleAgentRegistry:          # structurally implements agenticx.managed.host.registry.AgentRegistry
    def __init__(self, client: AdminConsoleClient, *, cache_seconds: float, implicit_local_env: bool,
                 clock: Callable[[], float] = time.monotonic) -> None: ...
    async def get_agent(self, tenant_id: str, agent_id: str) -> AgentRecord | None: ...
    async def get_version(self, tenant_id: str, agent_id: str, version: int | None) -> AgentVersionRecord | None: ...
    async def get_environment(self, tenant_id: str, environment_id: str) -> EnvironmentRecord | None: ...


class PatIntrospectionAuthenticator:      # structurally implements agenticx.managed.host.auth.TokenAuthenticator
    def __init__(self, client: AdminConsoleClient, *, cache_seconds: float,
                 clock: Callable[[], float] = time.monotonic) -> None: ...
    async def authenticate(self, token: str) -> Principal | None: ...


class OnBehalfOfMiddleware:
    """Pure ASGI middleware: copies a valid ULID from the X-AgenticX-On-Behalf-Of header into on_behalf_of_user."""
    def __init__(self, app: Any) -> None: ...
    async def __call__(self, scope, receive, send) -> None: ...
```

**`AdminConsoleClient` HTTP 细节**（以 MA-E02 §5.4 实际实现为准，实施前用 E02 的 `internal-routes.test.ts` 核对响应形状）：
- 共用一个 `httpx.AsyncClient(base_url=base_url, timeout=timeout, trust_env=False, transport=transport, headers={"Authorization": f"Bearer {internal_token}"})`。`trust_env=False` 避免本机代理拦截 127.0.0.1。
- `get_agent_version`：`GET /api/internal/ma/agent-versions/{agent_id}/{version}?tenant_id={tenant_id}`（`version` 为 `effective` / `latest` / 正整数）。200 → 返回 JSON（`{"agent": {...12 键}, "routing": {...}, "runtime": "cloud"|"desktop_worker", "version": {...7 键}}`）；404 → `None`；其他见下。
- `get_environment`：`GET /api/internal/ma/environments/{environment_id}?tenant_id=...`。200 → JSON `{"environment": {...6 键}}`；404 → `None`。
- `introspect`：`POST /api/internal/ma/pat-introspect`，body `{"token": token}`。200 → JSON（`{"active": false}` 或 `{"active": true, "tenant_id", "user_id", "dept_id", "scopes", "token_id"}`）。
- 401 → `logger.error("admin-console rejected the internal token")` 后 `raise MAError(INTERNAL, "control plane rejected the runtime credential")`；网络错误 / 超时 / 5xx / 非 JSON → `raise MAError(INTERNAL, "control plane unavailable")`。**日志与异常里不得出现 token。**

**`AdminConsoleAgentRegistry` 规则：**
- `get_agent(tenant, agent_id)`：`agent_id` 非 ULID → `None`（不发请求）。缓存键 `f"{tenant}|{agent_id}|effective"`（TTL = `cache_seconds`）。拿到 JSON 后：`record = AgentRecord.model_validate(body["agent"])`；若 `record.default_environment_id is None`：`runtime == "desktop_worker"` → `record = record.model_copy(update={"default_environment_id": UNSET_ENVIRONMENT_ID})`；否则保持 None（A04 会回落 `"local"`）。同一响应里的 `version` 同时写进版本缓存（见下），并把 `effective` 版本号记入 `f"{tenant}|{agent_id}|effective_version"`。
- `get_version(tenant, agent_id, version)`：`version is None` → 选择器 `"effective"`（**与 A04 docstring 的「None → latest」不同：企业版按路由解析，固定版本时新会话用固定版本**，满足 master W2 门）。整数版本按 `f"{tenant}|{agent_id}|v{n}"` 永久缓存（版本不可变；LRU 上限 512 条）；`effective` 按 TTL 缓存。返回 `AgentVersionRecord.model_validate(body["version"])`；404 → `None`。
- `get_environment(tenant, env_id)`：
  - `env_id == "local"` 且 `implicit_local_env` → 返回 `EnvironmentRecord(id="local", tenant_id=tenant, name="默认云端环境", type="cloud", config={"type": "cloud", "sandbox_backend": "docker", "image": None, "egress_allow_domains": [], "idle_ttl_seconds": 3600}, status="active")`（不发请求）。
  - `env_id == "unset"` 或非 ULID → `None`。
  - 否则请求（TTL 缓存），`EnvironmentRecord.model_validate(body["environment"])`。
  - 结果为 cloud 且 `config.sandbox_backend == "remote"` → `raise MAError(INVALID_REQUEST, 'sandbox backend "remote" is not available on this runtime')`（A04 `create_session` 会把它原样返回 400）。
- 缓存只存成功结果；`MAError` 不缓存。

**`PatIntrospectionAuthenticator.authenticate(token)`：**

```text
if not token.startswith("agx-pat-"): return None
key = sha256(token).hexdigest()
hit, cached = cache.get(key)
if not hit:
    body = await client.introspect(token)            # MAError(INTERNAL) propagates -> 500
    cached = None
    if body.get("active") is True and str(body.get("tenant_id") or "") and str(body.get("user_id") or ""):
        cached = Principal(tenant_id=..., user_id=..., scopes=frozenset(str(s) for s in body.get("scopes") or []))
    cache.put(key, cached)
if cached is None: return None
obo = on_behalf_of_user.get()
if obo is None: return cached
if "ma:sessions:on_behalf" not in cached.scopes and "ma:admin" not in cached.scopes:
    raise MAError(FORBIDDEN_SCOPE, "on-behalf-of requires ma:sessions:on_behalf", details={"scope": "ma:sessions:on_behalf"})
return Principal(tenant_id=cached.tenant_id, user_id=obo, scopes=cached.scopes)
```

（若 A04 路由的鉴权依赖不让 `MAError` 透传到异常处理器，以实际实现为准改为在依赖里捕获——实施前读 `agenticx/managed/host/routes.py` 的 principal 依赖。）

**`OnBehalfOfMiddleware`**：`scope["type"] != "http"` 直接透传；从 `scope["headers"]` 找 `x-agenticx-on-behalf-of`（bytes，latin-1 解码，strip）；`is_ulid(value)` 才 `token = on_behalf_of_user.set(value)`，否则（包括空）不设置；`try: await self.app(scope, receive, send) finally: if token: on_behalf_of_user.reset(token)`。非 ULID 的头被忽略且记一条 `logger.warning("ignored malformed on-behalf-of header")`。

### 5.5 `agenticx/managed/gateway_llm.py`（框架新文件）

```python
from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Dict, Generator, List, Optional, Union

from pydantic import Field, PrivateAttr

from agenticx.llms.litellm_provider import LiteLLMProvider
from agenticx.managed.llm import LLMCallContext

TRACE_STAGE = "ma.session"


def gateway_headers(*, provider: str, context: LLMCallContext) -> dict[str, str]:
    """Static correlation headers the enterprise gateway reads (trace_context.go)."""
    return {
        "x-agenticx-provider": provider,
        "X-AgenticX-Trace-Id": context.session_id.lower(),
        "X-AgenticX-Trace-Stage": TRACE_STAGE,
        "X-AgenticX-Session-Id": context.session_id,
        "X-Agenticx-Agent-Id": context.agent_id,
        "X-AgenticX-Deployment-Id": f"ma-{context.agent_id}-v{context.agent_version}",
    }


class GatewayLiteLLMProvider(LiteLLMProvider):
    """LiteLLMProvider that adds gateway headers (and a per-request trace step) to every call."""

    gateway_headers: Dict[str, str] = Field(default_factory=dict)
    _step: int = PrivateAttr(default=0)
    _step_lock: Any = PrivateAttr(default_factory=threading.Lock)

    def _inject(self, kwargs: Dict[str, Any]) -> None:
        with self._step_lock:
            self._step += 1
            step = self._step
        merged = dict(self.gateway_headers)
        merged["X-AgenticX-Trace-Step"] = str(step)
        extra = kwargs.get("extra_headers")
        if isinstance(extra, dict):
            merged.update(extra)
        kwargs["extra_headers"] = merged

    def invoke(self, prompt, tools=None, **kwargs): self._inject(kwargs); return super().invoke(prompt, tools=tools, **kwargs)
    async def ainvoke(self, prompt, tools=None, **kwargs): self._inject(kwargs); return await super().ainvoke(prompt, tools=tools, **kwargs)
    def stream(self, prompt, **kwargs): self._inject(kwargs); return super().stream(prompt, **kwargs)
    def stream_with_tools(self, prompt, tools=None, **kwargs): self._inject(kwargs); return super().stream_with_tools(prompt, tools=tools, **kwargs)
    async def _astream_generator(self, prompt, **kwargs):
        self._inject(kwargs)
        async for item in super()._astream_generator(prompt, **kwargs):
            yield item


@dataclass(frozen=True)
class GatewayLLMFactory:
    """agenticx.managed.llm.LLMFactory implementation that routes every call through the enterprise gateway."""

    base_url: str          # e.g. http://127.0.0.1:8088/v1
    token: str             # agx-pat-... with workspace:chat
    timeout_seconds: float = 300.0

    def create(self, *, provider: str, model: str, context: LLMCallContext) -> GatewayLiteLLMProvider:
        return GatewayLiteLLMProvider(
            model=f"openai/{model}",
            api_key=self.token,
            base_url=self.base_url,
            timeout=self.timeout_seconds,
            max_retries=0,
            drop_params=True,
            gateway_headers=gateway_headers(provider=provider, context=context),
        )

    def __repr__(self) -> str:   # never print the token
        return f"GatewayLLMFactory(base_url={self.base_url!r})"
```

说明：
- 方法签名以 `agenticx/llms/litellm_provider.py` 实际签名为准（若某方法不存在或签名不同，只覆盖存在的方法，保持 `super()` 调用）。
- `stream` / `stream_with_tools` 返回生成器：`_inject` 在调用时执行一次（每个模型请求一次 step），符合预期。
- 鉴权头由 OpenAI client 用 `api_key` 生成 `Authorization: Bearer <PAT>`；**不要**再在 `extra_headers` 里放 Authorization。
- `max_retries=0`：重试交给网关 relay（`relay/executor.go` 双层重试）与 AgentRuntime，避免同一请求被重复审计。
- `__repr__` 覆盖保证日志 / 异常中不出现 token；`GatewayLiteLLMProvider` 的 `api_key` 字段是 pydantic 字段，**不得**在任何日志里 dump 该对象。

### 5.6 `ma_agent_runtime/pg_event_store.py`

```python
class PgEventStore(EventStore):
    def __init__(self, engine: AsyncEngine, *, clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> None: ...
```

实现 MA-A02 §4.2 `EventStore` 全部抽象方法，**语义与 A02 方法表逐条一致**（A02 是契约，`SqliteEventStore` 是参考实现）。差异点与 SQL 细节：

- **方言无关**：全部用 SQLAlchemy Core 表达式，不写原生 SQL 字符串。`engine.dialect.name == "sqlite"` 时，写操作额外用一个进程内 `asyncio.Lock` 串行化（`self._sqlite_write_lock`），PG 不用。
- **时间**：写入用 `self._clock()` 得到的 aware datetime；读出时 `dt.tzinfo is None` → `replace(tzinfo=timezone.utc)`；对外字符串一律 `agenticx.managed.ids.utc_now_iso(dt)`。
- **列名映射**：`SessionRecord.usage` ↔ 列 `usage_totals`；其余同名。`stop_reason` 读出为 None 或 `StopReason.model_validate(...)`，`usage_totals` 缺键按 0（`Usage.model_validate({k: row.get(k, 0) ...})`）。`metadata` 列本服务不读不写（默认 `{}`）。
- `create_session(record)`：先 `SELECT 1 WHERE id=:id`，存在 → `ValueError("session already exists")`；否则 INSERT（`last_seq=0`，`created_at` / `updated_at` 取 `parse_iso(record.created_at)` / `parse_iso(record.updated_at)`），返回 `record`。
- `update_session(tenant, sid, changes)`：键 ⊄ `ALLOWED_SESSION_UPDATE_KEYS` → `ValueError(f"unsupported session fields: {sorted(extra)}")`；`archived_at` 字符串 → `parse_iso`；`updated_at = now`；`UPDATE ... WHERE id=:sid AND tenant_id=:t`，`rowcount == 0` → `MAError(SESSION_NOT_FOUND, "session not found")`；之后 `get_session` 返回。
- `list_sessions(tenant, agent_id=None, limit=50)`：`ORDER BY created_at DESC, id DESC`，`limit` 夹到 1..`MAX_LIST_LIMIT`。
- `list_unsettled_sessions()`：跨租户，`status IN ('running','rescheduling') OR (status = 'idle' AND stop_reason['type'].as_string() = 'requires_action')`。
- **`append_events(tenant, sid, events)`**（核心）：

```text
if not events: return []
# 1) pure validation before touching the database
ids = []
for i, ev in enumerate(events):
    if "type" not in ev: raise MAError(INVALID_EVENT_BATCH, f"events[{i}]: missing type", details={"index": i})
    eid = ev.get("id") or new_ulid()
    if not is_ulid(eid): raise MAError(INVALID_EVENT_BATCH, f"events[{i}].id: must be a ULID", details={"index": i})
    ids.append(eid)
if len(set(ids)) != len(ids): raise MAError(INVALID_EVENT_BATCH, "duplicate event id")
now = clock(); n = len(events)
# 2) one transaction: allocate seq under the session row lock, insert events, insert usage rows
try:
    async with engine.begin() as conn:
        row = (await conn.execute(
            update(ma_sessions)
            .where(ma_sessions.c.id == sid, ma_sessions.c.tenant_id == tenant)
            .values(last_seq=ma_sessions.c.last_seq + n, updated_at=now)
            .returning(ma_sessions.c.last_seq, ma_sessions.c.agent_id, ma_sessions.c.agent_version,
                       ma_sessions.c.created_by_user_id))).first()
        if row is None: raise MAError(SESSION_NOT_FOUND, "session not found")
        base = int(row.last_seq) - n
        event_rows, usage_rows, out = [], [], []
        for i, ev in enumerate(events):
            seq = base + i + 1
            payload = {k: v for k, v in ev.items() if k not in ENVELOPE_KEYS}
            event_rows.append({id: ids[i], tenant_id, session_id: sid, seq, thread_id: ev.get("thread_id"),
                               type: ev["type"], payload, created_at: now,
                               processed_at: parse_iso(ev["processed_at"]) if ev.get("processed_at") else None})
            if ev["type"] == "span.model_request_end":
                mu = payload.get("model_usage") or {}
                usage_rows.append({id: new_ulid(), tenant_id, session_id: sid, agent_id: row.agent_id,
                                   agent_version: row.agent_version, user_id: row.created_by_user_id,
                                   model: str(payload.get("model") or "")[:160],
                                   input_tokens: int(mu.get("input_tokens") or 0),
                                   output_tokens: int(mu.get("output_tokens") or 0),
                                   cache_read_input_tokens: int(mu.get("cache_read_input_tokens") or 0),
                                   tool_calls: 0, runtime_ms: 0, is_error: bool(payload.get("is_error")),
                                   event_seq: seq, created_at: now})
            out.append(StoredEvent(id=ids[i], tenant_id=tenant, session_id=sid, seq=seq, type=ev["type"],
                                   payload=payload, created_at=utc_now_iso(now), thread_id=ev.get("thread_id"),
                                   processed_at=ev.get("processed_at")))
        await conn.execute(insert(ma_session_events), event_rows)
        if usage_rows:
            await conn.execute(_insert_ignore(conn.dialect.name, ma_session_usage, ("session_id", "event_seq")), usage_rows)
except IntegrityError as exc:
    raise MAError(INVALID_EVENT_BATCH, "duplicate event id") from exc
return out
```

`_insert_ignore(dialect, table, conflict_cols)`：`postgresql` → `sqlalchemy.dialects.postgresql.insert(table).on_conflict_do_nothing(index_elements=list(conflict_cols))`；`sqlite` → `sqlalchemy.dialects.sqlite.insert(table).on_conflict_do_nothing(index_elements=...)`；其他 → `NotImplementedError`。

PG 下 `UPDATE ... RETURNING` 拿到会话行锁直到提交，同会话并发 append 被串行化，seq 连续唯一（A02 FR-4 语义）。`MAError` 在 `engine.begin()` 内抛出会自动回滚。

- `list_events(tenant, sid, after_seq=0, limit=100, types=None)`：`WHERE tenant_id AND session_id AND seq > after_seq [AND type IN types] ORDER BY seq LIMIT clamp(limit, 1, 500)`；行 → `StoredEvent`（`payload` 为 dict；`created_at` / `processed_at` 转 ISO 字符串）。
- `get_event`、`mark_processed`（`processed_at IS NULL` 才更新）、`last_seq`（会话不存在返回 0）同 A02。
- `close()`：`await engine.dispose()`（幂等）。

### 5.7 `ma_agent_runtime/pg_work_queue.py`

```python
from agenticx.managed.host.work_queue import ACTIVE_STATUSES, LEASED_STATUSES, WorkItemRow  # A05

PG_WORK_WAIT_SLICE_SECONDS = 2.0

class PgWorkQueue:
    def __init__(self, engine: Engine, *, clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> None: ...
    # identical public surface to A05 SqliteWorkQueue (§5.1 of the A05 plan):
    def notify(self, environment_id: str) -> None: ...
    async def wait_for_work(self, environment_id: str, timeout: float) -> None: ...
    def create(self, *, tenant_id: str, session_id: str, environment_id: str, inbox_after_seq: int) -> WorkItemRow: ...
    def get(self, tenant_id: str, work_id: str) -> WorkItemRow | None: ...
    def active_for_session(self, tenant_id: str, session_id: str) -> WorkItemRow | None: ...
    def claim_next(self, tenant_id: str, environment_id: str, device_id: str) -> WorkItemRow | None: ...
    def require_lease(self, tenant_id: str, work_id: str, device_id: str, *, statuses: Sequence[str]) -> WorkItemRow: ...
    def ack(self, tenant_id: str, work_id: str, device_id: str) -> WorkItemRow: ...
    def heartbeat(self, tenant_id: str, work_id: str, device_id: str) -> WorkItemRow: ...
    def complete(self, tenant_id: str, work_id: str, device_id: str, consumed_through_seq: int) -> WorkItemRow: ...
    def finish(self, tenant_id: str, work_id: str, *, status: Literal["failed", "stopped"], error: str,
               consumed_through_seq: int) -> WorkItemRow: ...
    def expired(self) -> list[WorkItemRow]: ...
    def leased_items(self) -> list[WorkItemRow]: ...
```

语义与 A05 §5.1 逐条一致（租约 `WORK_LEASE_TTL_SECONDS`=120、宽限 `WORK_STOP_GRACE_SECONDS`=60、错误码 `work_lease_lost` 409 等，常量从 `agenticx.managed.protocol` 导入）。差异：
- 每个方法 `with self._engine.begin() as conn:` 一个短事务。
- `claim_next`：`SELECT id ... WHERE tenant_id=:t AND environment_id=:e AND status='queued' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`（`.with_for_update(skip_locked=True)`；sqlite 会忽略）→ `UPDATE ... WHERE id=:id AND status='queued'` 设 `status='claimed'`、`claimed_by_device`、`claimed_at=now`、`lease_expires_at=now+120s`、`attempts=attempts+1`、`last_heartbeat_at=now`、`updated_at=now`；`rowcount != 1` → None。`claimed_by_user_id` 保持 NULL（A05 接口不带用户）。
- `complete` / `finish` 额外写 `completed_at=now`。
- `WorkItemRow` 的时间字段转 `utc_now_iso` 字符串；`error` 存储前截断到 500 字符（A05 的 `fail_work` 已截断，这里再防一次）。
- `wait_for_work(env, timeout)`：本进程 `asyncio.Event`（惰性创建）+ 每次最多等 `min(timeout, PG_WORK_WAIT_SLICE_SECONDS)` 后返回，让 A05 poll 循环重新 `claim_next`，即使将来出现第二个进程写入的工作项，最多 2 秒内也能被领取。

### 5.8 `ma_agent_runtime/isolation.py`

```python
RUNTIME_CONFIG_YAML = (
    "# Managed by agent-runtime; rewritten on every start. Do not edit.\n"
    "permissions:\n"
    "  command_permissions: workspace-write\n"
)

class RuntimeIsolationError(RuntimeError): ...

def ensure_isolated_home(home: Path) -> Path: ...
def write_runtime_config(home: Path) -> Path: ...
def probe_command_sandbox(home: Path, *, mode: Literal["required", "best_effort"],
                          platform_name: str | None = None, runner: Callable[..., Any] = subprocess.run) -> str: ...
```

- `ensure_isolated_home(home)`：`home` 须为绝对路径；`Path.home().resolve() != home.resolve()` → `RuntimeIsolationError("HOME must equal MA_RUNTIME_HOME before the runtime starts")`；`(home/".agenticx"/"sessions").mkdir(parents=True, exist_ok=True)`；返回 `home/".agenticx"`。
- `write_runtime_config(home)`：写 `home/.agenticx/config.yaml` = `RUNTIME_CONFIG_YAML`（覆盖），`chmod 0o600`，返回路径；随后调 `agenticx.cli.config_manager.ConfigManager._invalidate_yaml_cache(None)`（若该方法存在，以实际实现为准）。
- `probe_command_sandbox(home, mode)`：

```text
probe_dir = home/".agenticx"/"sandbox-probe"; mkdir
try:
    plan = build_command_sandbox_plan(["/bin/sh", "-c", "true"], permissions="workspace-write",
                                      writable_roots=[probe_dir], readable_roots=[probe_dir],
                                      scope_id="ma-runtime-probe", cwd=probe_dir, platform_name=platform_name)
    proc = runner(list(plan.argv), env=dict(plan.env), cwd=str(probe_dir), timeout=15, capture_output=True)
    ok = proc.returncode == 0
    backend = plan.backend; detail = (proc.stderr or b"")[-300:].decode("utf-8", "replace")
except CommandSandboxUnavailable as exc: ok, backend, detail = False, "none", str(exc)
except Exception as exc: ok, backend, detail = False, "none", f"{type(exc).__name__}: {exc}"
if ok: log info f"command sandbox ready backend={backend}"; return backend
if mode == "required": raise RuntimeIsolationError(f"command sandbox unavailable ({detail}); set MA_RUNTIME_COMMAND_SANDBOX=best_effort only on a trusted development host")
log warning "command sandbox unavailable; bash_exec will run WITHOUT OS isolation (best_effort)"
return "none"
```

（`build_command_sandbox_plan` / `CommandSandboxUnavailable` 从 `agenticx.runtime.command_sandbox` 导入。）

### 5.9 `ma_agent_runtime/worker_wiring.py`

```python
def wire_worker_plane(app: FastAPI, work_queue: PgWorkQueue) -> None: ...
```

照 A05 §5.9 的接线逻辑重写一遍（因为 A05 只对 `SqliteEventStore` 接线）：

```python
state = app.state.ma                                   # MAHostState
service = state.service
state.extras["work_queue"] = work_queue
service.register_executor_factory("desktop_worker", lambda actor: RemoteWorkerExecutor(actor, work_queue))
app.include_router(build_worker_router(state, work_queue))

async def _stop_stale_leases_on_startup() -> None:
    for item in work_queue.leased_items():
        work_queue.finish(item.tenant_id, item.id, status="stopped", error="host restarted",
                          consumed_through_seq=await state.store.last_seq(item.tenant_id, item.session_id))

async def _start_sweeper() -> None:
    async def _loop() -> None:
        while True:
            await asyncio.sleep(WORK_HEARTBEAT_INTERVAL_SECONDS)
            try:
                await stop_expired_work(service, work_queue)
            except Exception:
                logger.exception("work lease sweeper failed")
    state.extras["work_sweeper"] = asyncio.create_task(_loop())

async def _stop_sweeper() -> None:
    task = state.extras.pop("work_sweeper", None)
    if task is not None:
        task.cancel()

state.startup_hooks.extend([_stop_stale_leases_on_startup, _start_sweeper])
state.shutdown_hooks.append(_stop_sweeper)
```

导入：`RemoteWorkerExecutor`（`agenticx.managed.host.remote_executor`）、`build_worker_router`（`agenticx.managed.host.worker_routes`）、`stop_expired_work`（`agenticx.managed.host.ingest`）、`WORK_HEARTBEAT_INTERVAL_SECONDS`（`agenticx.managed.protocol`）。以 A05 实际实现为准。

### 5.10 `ma_agent_runtime/app.py`

```python
def build_app(settings: Settings, *, admin_transport: httpx.AsyncBaseTransport | None = None,
              scrub_env: bool = True, search_path: str | None = None) -> FastAPI: ...

def create_app() -> FastAPI:
    """uvicorn factory: build_app(Settings.from_env())."""
```

`build_app` 步骤（顺序固定，任一步抛错则进程不启动）：

1. `data_dir = ensure_isolated_home(settings.home)`；`write_runtime_config(settings.home)`；`probe_command_sandbox(settings.home, mode=settings.command_sandbox)`。
2. `apply_runtime_env_defaults()`；若 `scrub_env`：`removed = scrub_secret_env()`，`logger.info("scrubbed %d secret env vars", len(removed))`（只记数量）。
3. `urls = split_database_url(settings.database_url, search_path=search_path)`；`urls.dialect == "sqlite" and not settings.allow_sqlite` → `RuntimeError`；`async_engine, sync_engine = build_engines(urls, pool_size=settings.db_pool_size)`。
4. `client = AdminConsoleClient(settings.admin_url, settings.internal_token, transport=admin_transport)`；`registry = AdminConsoleAgentRegistry(client, cache_seconds=settings.registry_cache_seconds, implicit_local_env=settings.implicit_local_env)`；`authenticator = PatIntrospectionAuthenticator(client, cache_seconds=settings.pat_cache_seconds)`。
5. `llm_factory = GatewayLLMFactory(base_url=settings.gateway_url, token=settings.gateway_token, timeout_seconds=settings.llm_timeout_seconds)`。
6. `config = HostConfig(data_dir=data_dir, tenant_id="enterprise", tokens={}, agents={}, environments={}, dev=False, interrupt_grace_seconds=settings.interrupt_grace_seconds)`（其余字段默认；以 A04 实际 `HostConfig` 字段为准）。
7. `app = create_ma_app(config, llm_factory=llm_factory, store=PgEventStore(async_engine), registry=registry, authenticator=authenticator)`。
8. `app.add_middleware(OnBehalfOfMiddleware)`（FastAPI 对纯 ASGI 类同样支持 `add_middleware`）。
9. 健康检查（不鉴权）：`GET /healthz` → `{"ok": true}`；`GET /readyz` → 对 async 引擎执行 `SELECT 1`，成功 200 `{"ok": true}`，失败 503 `{"ok": false}`（不回显异常）。
10. `settings.desktop_worker_enabled` → `wire_worker_plane(app, PgWorkQueue(sync_engine))`。
11. `app.state.ma.shutdown_hooks.append(_close_extras)`，其中关闭 `client.aclose()` 与 `sync_engine.dispose()`（`async_engine` 由 `store.close()` 释放）。

`create_app()`：`logging.basicConfig(level=os.environ.get("MA_RUNTIME_LOG_LEVEL", "INFO"))` 后 `return build_app(Settings.from_env())`。

### 5.11 Dockerfile / requirements / README

`requirements.txt`（逐字）：

```text
# agent-runtime 额外依赖；agenticx 本体由 Dockerfile 以源码安装（含核心依赖）。
SQLAlchemy[asyncio]>=2.0.30,<3
asyncpg>=0.29,<1
psycopg2-binary>=2.9.9,<3
aiosqlite>=0.20,<1
httpx>=0.25.0,<1
```

`Dockerfile`（构建上下文 = 仓库根）：

```dockerfile
# 托管运行时：复用 agenticx 框架的 AgentRuntime 与托管宿主，会话事件落企业 PG，模型调用经企业网关。
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/data/home \
    MA_RUNTIME_HOME=/data/home \
    MA_RUNTIME_COMMAND_SANDBOX=required \
    AGX_LEARNING_ENABLED=0 \
    AGX_SESSION_FTS=0 \
    AGX_SKILL_MANAGE=0

RUN apt-get update \
 && apt-get install -y --no-install-recommends bubblewrap ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY pyproject.toml README.md LICENSE /src/
COPY agenticx /src/agenticx
RUN pip install --no-cache-dir "/src[mcp]"

COPY enterprise/apps/agent-runtime/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY enterprise/apps/agent-runtime/ma_agent_runtime /app/ma_agent_runtime

RUN useradd --create-home --uid 10002 agentrt \
 && mkdir -p /data/home \
 && chown -R agentrt:agentrt /app /data
USER agentrt
WORKDIR /app

EXPOSE 8092
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8092/healthz').status==200 else 1)"

CMD ["uvicorn", "ma_agent_runtime.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8092"]
```

`README.md`：中文，章节：职责 / 不负责、环境变量（照抄 §5.1 表）、本地运行（`bash scripts/start-dev.sh --with-agent-runtime`）、单测命令、PG 契约测试命令、隔离边界（照抄 D3，明确写「不是每会话容器」「不做出站白名单」）、单副本限制、PAT 准备方法（API 令牌页或 `pnpm ma:provision-dev-tokens`）。**不写**客户名或第三方产品名。

### 5.12 本地开发 PAT 预置 `enterprise/scripts/ma-provision-dev-tokens.ts`

结构照抄 `scripts/migrate-runtime-legacy.ts`（`loadEnvLocal`、`DATABASE_URL` / `DEFAULT_TENANT_ID` 检查、`finally` 里 `__resetDatabaseForTests()`）。主体：

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { __resetDatabaseForTests, createPat, loadAuthUserByEmail } from "@agenticx/iam-core";

const SECRETS_DIR = path.join(ENTERPRISE_DIR, ".local-secrets");
const TARGETS = [
  { file: "ma_runtime_gateway.pat", name: "托管运行时模型调用（本地开发）", scopes: ["workspace:chat"] },
  { file: "ma_portal_service.pat", name: "门户调用托管运行时（本地开发）", scopes: ["ma:sessions:read", "ma:sessions:write", "ma:sessions:on_behalf", "ma:agents:read"] },
] as const;

async function main(): Promise<void> {
  loadEnvLocal();
  // DATABASE_URL / DEFAULT_TENANT_ID required (same messages as migrate-runtime-legacy.ts)
  const tenantId = process.env.DEFAULT_TENANT_ID!.trim();
  const email = (process.env.MA_DEV_SERVICE_USER_EMAIL || "admin@agenticx.local").trim().toLowerCase();
  const user = await loadAuthUserByEmail(tenantId, email);
  if (!user) {
    console.log(`[ma-provision-dev-tokens] skip: user ${email} not found in tenant ${tenantId}`);
    return;
  }
  fs.mkdirSync(SECRETS_DIR, { recursive: true });
  for (const target of TARGETS) {
    const file = path.join(SECRETS_DIR, target.file);
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8").trim().startsWith("agx-pat-")) {
      console.log(`[ma-provision-dev-tokens] ${target.file}: exists`);
      continue;
    }
    const { record, token } = await createPat({
      tenantId, userId: user.id, deptId: user.deptId ?? null, name: target.name,
      createdBy: user.id, scopes: [...target.scopes], expireDays: 365,
    });
    fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
    console.log(`[ma-provision-dev-tokens] ${target.file}: created id=${record.id} prefix=${record.tokenPrefix}`);
  }
  console.log("[ma-provision-dev-tokens] done");
}
```

永不打印 token 明文。`enterprise/package.json` 的 `scripts` 在 `"ma:backfill-agent-versions"` 下一行追加：`"ma:provision-dev-tokens": "tsx scripts/ma-provision-dev-tokens.ts",`。

### 5.13 `enterprise/scripts/start-dev.sh`

只增不改既有行为（不带新开关时，脚本行为与改动前一致）：

1. 变量区（`USE_WEBPACK=0` 之后）加 `WITH_AGENT_RUNTIME="${AGX_START_AGENT_RUNTIME:-0}"`。
2. `print_help` 选项里加一行：`  --with-agent-runtime  同时拉起托管运行时 agent-runtime（:8092，需本机 Python 已安装 agenticx 与 apps/agent-runtime/requirements.txt）`；端口列表加 `  agent-runtime  http://localhost:8092/healthz（--with-agent-runtime 时）`。
3. 参数 `case` 加 `--with-agent-runtime) WITH_AGENT_RUNTIME=1 ;;`。
4. 在「3) 可选自动迁移」块**之后**、「4) 子进程管理」之前插入 MA 准备块：

```bash
# 3.5) 托管运行时准备（仅 --with-agent-runtime）：内部 token 与本地开发 PAT。
REPO_ROOT="$(cd "$ENTERPRISE_DIR/.." && pwd)"
if [ "$WITH_AGENT_RUNTIME" = "1" ]; then
  SECRETS_DIR="$ENTERPRISE_DIR/.local-secrets"
  mkdir -p "$SECRETS_DIR"
  if [ -z "${MA_INTERNAL_TOKEN_FILE:-}" ] && [ -z "${MA_INTERNAL_TOKEN:-}" ]; then
    export MA_INTERNAL_TOKEN_FILE="$SECRETS_DIR/ma_internal.token"
  fi
  if [ -n "${MA_INTERNAL_TOKEN_FILE:-}" ] && [ ! -s "$MA_INTERNAL_TOKEN_FILE" ]; then
    openssl rand -hex 16 > "$MA_INTERNAL_TOKEN_FILE"
    chmod 600 "$MA_INTERNAL_TOKEN_FILE"
    echo "[start-dev] generated $MA_INTERNAL_TOKEN_FILE"
  fi
  : "${MA_RUNTIME_GATEWAY_TOKEN_FILE:=$SECRETS_DIR/ma_runtime_gateway.pat}"
  : "${MA_RUNTIME_SERVICE_TOKEN_FILE:=$SECRETS_DIR/ma_portal_service.pat}"
  export MA_RUNTIME_GATEWAY_TOKEN_FILE MA_RUNTIME_SERVICE_TOKEN_FILE
  : "${MA_RUNTIME_URL:=http://127.0.0.1:8092}"
  export MA_RUNTIME_URL
  if [ ! -s "$MA_RUNTIME_GATEWAY_TOKEN_FILE" ] || [ ! -s "$MA_RUNTIME_SERVICE_TOKEN_FILE" ]; then
    ( cd "$ENTERPRISE_DIR" && pnpm ma:provision-dev-tokens ) || echo "[start-dev] 警告：ma:provision-dev-tokens 失败，agent-runtime 将无法调用网关" >&2
  fi
fi
```

（这一块必须在启动 Next 应用之前，admin-console 进程才能继承 `MA_INTERNAL_TOKEN_FILE`。）

5. 在 gateway 探活（`wait_for_http "gateway" ...` 那个 `if` 块）**之后**、`echo "[start-dev] all services launching..."` 之前插入：

```bash
# 7) 可选：托管运行时（Python）。HOME 必须指向隔离目录，避免读写开发者自己的 ~/.agenticx。
if [ "$WITH_AGENT_RUNTIME" = "1" ]; then
  AGX_PYTHON="${AGX_PYTHON:-python3}"
  RT_HOME="$ENTERPRISE_DIR/.runtime/agent-runtime/home"
  mkdir -p "$RT_HOME"
  if ! "$AGX_PYTHON" -c "import agenticx, sqlalchemy, asyncpg, psycopg2" >/dev/null 2>&1; then
    echo "[start-dev] 警告：$AGX_PYTHON 缺少 agenticx / sqlalchemy / asyncpg / psycopg2，跳过 agent-runtime。" >&2
    echo "          先执行：pip install -e . && pip install -r enterprise/apps/agent-runtime/requirements.txt" >&2
  elif lsof -nP -iTCP:8092 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[start-dev] 警告：:8092 已被占用，跳过启动 agent-runtime。" >&2
  else
    case "$(uname -s)" in
      Darwin) _rt_sandbox="${MA_RUNTIME_COMMAND_SANDBOX:-required}" ;;
      *) _rt_sandbox="${MA_RUNTIME_COMMAND_SANDBOX:-best_effort}" ;;
    esac
    echo "[start-dev] booting agent-runtime (:8092, sandbox=$_rt_sandbox) ..."
    (
      cd "$ENTERPRISE_DIR/apps/agent-runtime"
      exec env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
        HOME="$RT_HOME" MA_RUNTIME_HOME="$RT_HOME" \
        PYTHONPATH="$REPO_ROOT:$ENTERPRISE_DIR/apps/agent-runtime" \
        MA_RUNTIME_ADMIN_URL="${MA_RUNTIME_ADMIN_URL:-http://127.0.0.1:3001}" \
        MA_RUNTIME_GATEWAY_URL="${MA_RUNTIME_GATEWAY_URL:-${GATEWAY_BASE_URL:-http://127.0.0.1:8088}/v1}" \
        MA_RUNTIME_COMMAND_SANDBOX="$_rt_sandbox" \
        "$AGX_PYTHON" -m uvicorn ma_agent_runtime.app:create_app --factory --host 127.0.0.1 --port 8092
    ) &
    PIDS+=("$!")
    wait_for_http "agent-runtime" "http://127.0.0.1:8092/healthz" 60 || \
      echo "[start-dev] 警告：agent-runtime 未在 60s 内就绪，查看上方日志（常见：MA_INTERNAL_TOKEN / 网关 PAT 缺失、沙箱探测失败）。" >&2
  fi
fi
```

6. 末尾服务清单 `echo` 区追加：`if [ "$WITH_AGENT_RUNTIME" = "1" ]; then echo "  - agent-runtime http://localhost:8092/healthz"; fi`。

macOS 默认 `required`（`sandbox-exec` 系统自带）；Linux 本机默认 `best_effort` 并在启动日志明确告警（开发机常未装 bwrap）。

`start-dev-with-infra.sh`：第 50 行 `--all|--ui=tui|--ui=stream|--webpack) APP_ARGS+=("$arg") ;;` 改为 `--all|--ui=tui|--ui=stream|--webpack|--with-agent-runtime) APP_ARGS+=("$arg") ;;`；help 文本对应加一行 `  --with-agent-runtime   透传给 start-dev.sh（托管运行时 :8092）`。

### 5.14 `enterprise/scripts/bootstrap.sh`

1. 在 `if [ "$MODE" = "local" ]; then GATEWAY_INTERNAL_TOKEN_FILE=...` 块内、`gateway internal token` 生成之后追加：

```bash
  MA_INTERNAL_TOKEN_FILE="$SECRETS_DIR/ma_internal.token"
  if [ ! -f "$MA_INTERNAL_TOKEN_FILE" ]; then
    random_hex 16 > "$MA_INTERNAL_TOKEN_FILE"
    chmod 600 "$MA_INTERNAL_TOKEN_FILE"
    ok "generated managed-agents internal token at $MA_INTERNAL_TOKEN_FILE"
  else
    ok "managed-agents internal token already exists"
  fi
  : "${MA_RUNTIME_URL:=http://127.0.0.1:8092}"
  : "${MA_RUNTIME_GATEWAY_TOKEN_FILE:=$SECRETS_DIR/ma_runtime_gateway.pat}"
  : "${MA_RUNTIME_SERVICE_TOKEN_FILE:=$SECRETS_DIR/ma_portal_service.pat}"
```

2. `.env.local` heredoc 中 `GATEWAY_MCP_HOSTING=...` 行之后追加：

```bash

MA_INTERNAL_TOKEN_FILE='${MA_INTERNAL_TOKEN_FILE:-}'
MA_RUNTIME_URL='${MA_RUNTIME_URL:-}'
MA_RUNTIME_ENABLED='${MA_RUNTIME_ENABLED:-0}'
MA_RUNTIME_GATEWAY_TOKEN_FILE='${MA_RUNTIME_GATEWAY_TOKEN_FILE:-}'
MA_RUNTIME_SERVICE_TOKEN_FILE='${MA_RUNTIME_SERVICE_TOKEN_FILE:-}'
```

bootstrap **不**创建 PAT（不在默认流程里写库）；PAT 只在 `--with-agent-runtime` 时由 start-dev 预置。

`enterprise/.env.local.example` 在 E02 追加的 `MA_INTERNAL_TOKEN` 说明之后追加：

```bash
# 托管运行时 agent-runtime（:8092）。门户开关 MA_RUNTIME_ENABLED=1 时，协作房间的云端智能体改由它执行。
MA_RUNTIME_URL=http://127.0.0.1:8092
MA_RUNTIME_ENABLED=0
# agent-runtime 调网关用的 PAT（scope 至少 workspace:chat）；门户调 agent-runtime 用的 PAT（scope ma:sessions:read / ma:sessions:write / ma:sessions:on_behalf / ma:agents:read）。
MA_RUNTIME_GATEWAY_TOKEN_FILE=.local-secrets/ma_runtime_gateway.pat
MA_RUNTIME_SERVICE_TOKEN_FILE=.local-secrets/ma_portal_service.pat
```

### 5.15 nginx `enterprise/deploy/nginx/gateway.conf`

在 `server {` 内、`location /admin/ {` 之前插入（现有 location 一字不改）：

```nginx
    # Managed Agents 公共 API：控制面资源 -> admin-console /api/ma/v1/*；会话面 / Worker -> agent-runtime。
    # agent-runtime 用变量 + resolver 寻址：未部署该容器时 nginx 仍能启动，只有 /ma/v1 会话面返回 502。
    resolver 127.0.0.11 valid=30s ipv6=off;

    # environments 下的 Worker 长轮询属于会话面，必须写在控制面正则之前（正则 location 按出现顺序匹配）。
    location ~ ^/ma/v1/environments/[^/]+/work/ {
      set $ma_runtime_upstream http://agent-runtime:8092;
      limit_req zone=api_limit burst=60 nodelay;
      proxy_http_version 1.1;
      proxy_set_header Connection "";
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_read_timeout 120s;
      proxy_pass $ma_runtime_upstream;
    }

    location ~ ^/ma/v1/(agents|environments|vaults|memory_stores|schedules|channels)(/|$) {
      limit_req zone=api_limit burst=40 nodelay;
      rewrite ^/ma/v1/(.*)$ /api/ma/v1/$1 break;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_pass http://admin_console_backend;
    }

    location /ma/v1/ {
      set $ma_runtime_upstream http://agent-runtime:8092;
      limit_req zone=api_limit burst=60 nodelay;
      client_max_body_size 20m;
      proxy_http_version 1.1;
      proxy_set_header Connection "";
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      # SSE：禁用缓冲，长连接保持 1 小时（服务端每 15 秒 ping）。
      proxy_buffering off;
      proxy_cache off;
      chunked_transfer_encoding on;
      proxy_read_timeout 3600s;
      proxy_send_timeout 3600s;
      proxy_pass $ma_runtime_upstream;
    }
```

匹配验证（AC 用）：`/ma/v1/agents` → admin `/api/ma/v1/agents`；`/ma/v1/environments/01J.../work/poll` → agent-runtime（原路径）；`/ma/v1/environments/01J...` → admin；`/ma/v1/sessions/01J.../events/stream` → agent-runtime；`/ma/v1/work/01J.../ack` → agent-runtime；`/ma/v1/health` → agent-runtime。

### 5.16 `enterprise/deploy/docker-compose/prod.yml`

1. 新增服务（放在 `admin-console` 之后）：

```yaml
  agent-runtime:
    profiles: ["managed-agents"]
    image: ghcr.io/agenticx/enterprise-agent-runtime:latest
    container_name: agenticx-agent-runtime
    restart: unless-stopped
    environment:
      DATABASE_DIALECT: ${DATABASE_DIALECT:-postgresql}
      DATABASE_URL: ${DATABASE_URL:-}
      MA_INTERNAL_TOKEN: ${MA_INTERNAL_TOKEN:-}
      MA_RUNTIME_ADMIN_URL: http://admin-console:3001
      MA_RUNTIME_GATEWAY_URL: http://gateway-a:8088/v1
      MA_RUNTIME_GATEWAY_TOKEN: ${MA_RUNTIME_GATEWAY_TOKEN:-}
      MA_RUNTIME_COMMAND_SANDBOX: ${MA_RUNTIME_COMMAND_SANDBOX:-required}
      MA_RUNTIME_DESKTOP_WORKER_ENABLED: ${MA_RUNTIME_DESKTOP_WORKER_ENABLED:-0}
    # bubblewrap 需要在容器内创建用户 / PID 命名空间；默认 seccomp / apparmor 会拒绝。
    security_opt:
      - seccomp=unconfined
      - apparmor=unconfined
    volumes:
      - agent_runtime_data:/data
    networks:
      - agenticx-backbone
```

2. `admin-console.environment` 追加 `MA_INTERNAL_TOKEN: ${MA_INTERNAL_TOKEN:-}`。
3. `web-portal.environment` 追加 `MA_RUNTIME_ENABLED: ${MA_RUNTIME_ENABLED:-0}`、`MA_RUNTIME_URL: ${MA_RUNTIME_URL:-http://agent-runtime:8092}`、`MA_RUNTIME_SERVICE_TOKEN: ${MA_RUNTIME_SERVICE_TOKEN:-}`（MA-E04 消费）。
4. `volumes:` 追加 `agent_runtime_data:`。

不用 `:?` 必填写法：compose 会对所有服务做变量插值，`profiles` 未启用时也会报错；缺失值由服务启动时 fail-closed 报出。启用方式：`docker compose -f prod.yml --profile managed-agents up -d`。模型调用直连 `gateway-a`（不经 nginx `/v1/`，避免单 IP 限流 20 r/s 误伤）。

---

## 6. Before / After

| 场景 | Before | After |
|---|---|---|
| `/ma/v1/*` 请求到达 nginx | 落到 `location /` → web-portal 404 | 控制面前缀 → admin-console；会话面 → agent-runtime |
| 托管会话事件 | 只在 `agx ma serve` 的本地 SQLite | 企业 PG `ma_session_events`，每个 `span.model_request_end` 另写一行 `ma_session_usage` |
| 托管会话模型调用 | 本机 provider 配置直连上游 | 经企业网关，审计里可按 `session_id` / `agent_id` / `trace_id` 查 |
| 调用方鉴权 | 静态 dev token | iam-core PAT 内省（30 秒缓存）；`ma:sessions:on_behalf`（或 `ma:admin`）可代表用户建会话 |
| `start-dev.sh`（不带新开关） | 起 web-portal / admin-console / gateway | **完全不变** |
| `ma_work_items` | 无 inbox 游标列 | 多 `inbox_after_seq`、`consumed_through_seq` 两列 |

---

## 7. FR / NFR / AC

测试约定：服务测试在 `enterprise/apps/agent-runtime/tests/`，`conftest.py` 把服务根加入 `sys.path`（同 context-service），并提供：
- fixture `sqlite_urls(tmp_path)`：`split_database_url(f"sqlite:///{tmp_path/'ma.db'}")`，`create_all(sync_engine)`。
- fixture `pg_urls`：读 `MA_TEST_DATABASE_URL`，缺失则 `pytest.skip("MA_TEST_DATABASE_URL not set")`；生成随机 schema 名 `ma_test_<hex8>`，`CREATE SCHEMA`，`split_database_url(url, search_path=schema)`，`metadata.create_all`；teardown `DROP SCHEMA ... CASCADE`。
- fixture `store`（参数化 `["sqlite", "pg"]`）与 `work_queue`（同样参数化），给契约测试用。
- `tests/fakes.py`：`FakeAdminConsole`（`httpx.MockTransport` handler，记录请求，可配置 agent / version / environment / PAT 表）与 `FakeGateway`（FastAPI app + uvicorn 线程，空闲端口；`/v1/chat/completions` 支持非流式与 `stream=true` 两种响应；按 `X-AgenticX-Session-Id` 记录请求头与 body；可设置脚本：第 n 次请求返回工具调用或文本）。

异步测试直接写 `async def test_...`：从仓库根运行时 `pyproject.toml` 的 `asyncio_mode = "auto"` 生效；命令里的 `-o addopts=""` 只清掉覆盖率等参数（同 context-service），`-o asyncio_mode=auto` 是显式兜底。服务测试目录**不**新建 `pytest.ini`。

| ID | 需求 | AC（测试文件 :: 用例 → 断言） |
|---|---|---|
| FR-1 | 配置 fail-closed | `test_config.py::test_from_env_requires_secrets`：缺 `MA_INTERNAL_TOKEN` → `RuntimeError` 消息以 `MA_INTERNAL_TOKEN:` 开头；缺网关 token、token 不以 `agx-pat-` 开头、缺 `MA_RUNTIME_HOME` 分别报对应变量名。`test_from_env_reads_file_variants`：`MA_INTERNAL_TOKEN_FILE` 指向临时文件（内容带换行）→ `settings.internal_token` 去掉空白。`test_rejects_mysql`：`DATABASE_URL=mysql://...` 或 `DATABASE_DIALECT=mysql` → 错误含 `PostgreSQL only`。`test_gateway_url_must_end_with_v1`。`test_command_sandbox_values`：`foo` → 错误；缺省 → `required` |
| FR-2 | 密钥擦除 | `test_config.py::test_scrub_secret_env`：对字典 `{"DATABASE_URL":"x","MA_INTERNAL_TOKEN":"x","MA_INTERNAL_TOKEN_FILE":"x","AUTH_JWT_PRIVATE_KEY":"x","ADMIN_CONSOLE_LOGIN_PASSWORD":"x","OPENAI_API_KEY":"x","SSO_STATE_SIGNING_SECRET":"x","PATH":"/bin","HOME":"/h","MA_RUNTIME_HOME":"/h"}` → 返回值等于前 7 个键排序；剩余恰为 `PATH/HOME/MA_RUNTIME_HOME` |
| FR-3 | URL 拆分 | `test_db_url.py::test_postgres_urls`：`postgresql://u:p@h:5432/db?sslmode=require` → async `postgresql+asyncpg://u:p@h:5432/db`（无 sslmode）且 `async_connect_args["ssl"] == "require"`，sync `postgresql+psycopg2://...?sslmode=require`；`postgres://` 同样；`search_path="s1"` → async `server_settings.search_path == "s1"`，sync `options == "-csearch_path=s1"`；`sqlite:///tmp/a.db` → `sqlite+aiosqlite:///tmp/a.db`；`mysql://` → `ValueError` |
| FR-4 | 与 drizzle DDL 列一致 | `test_tables_parity.py::test_columns_match_drizzle_migrations`：读取 `enterprise/packages/db-schema/drizzle/0061_ma_control_plane.sql` 与 `0062_ma_work_inbox.sql`（路径从测试文件向上定位仓库根），正则解析 4 张表的 `CREATE TABLE` 列行与 `ALTER TABLE ... ADD COLUMN`；断言每张表：列名集合与 `tables.py` 完全相等；每列类型族一致（`varchar(n)`↔`String(n)` 且长度相等、`text`↔`Text`、`integer`↔`Integer`、`bigint`↔`BigInteger`、`boolean`↔`Boolean`、`jsonb`↔`JSON`、`timestamp with time zone`↔`DateTime(timezone=True)`）；`NOT NULL` 或 `PRIMARY KEY` ⇔ `nullable is False`。`test_unique_constraints_present`：`ma_session_events_session_seq_uq`、`ma_session_usage_session_event_uq` 存在 |
| FR-5 | 事件存储契约（sqlite 必跑 + PG 可选） | `test_pg_event_store_contract.py`，全部用例对 `store` 参数化：`test_append_assigns_contiguous_seq`（2+3 条 → seq 1..5，`last_seq == 5`）；`test_concurrent_appends_unique_seq`（`asyncio.gather` 20 次各 1 条 → seq 集合 `== set(range(1,21))`）；`test_list_events_after_seq_limit_types`（同 A02 FR-5）；`test_tenant_isolation`（他租户 `get_session` → None、append → `session_not_found`、list → `[]`）；`test_event_id_preserved_and_validated`（`id="bad"` → `invalid_event_batch` 且 `details["index"] == 0`；重复 id → `invalid_event_batch` 且 `last_seq` 不变）；`test_append_is_atomic`；`test_stored_event_to_wire`（wire 不含 `tenant_id`、`parse_server_event` 通过）；`test_update_session_and_unsettled`（同 A02 FR-11；另断言 `usage` 写入后 `get_session().usage.input_tokens` 正确、库里列名是 `usage_totals`）；`test_usage_row_per_model_request_end`（append 两个 `span.model_request_end`（`model_usage.input_tokens` 分别 3、5）与一个 `agent.message` → `ma_session_usage` 恰 2 行，`event_seq` 等于对应事件 seq，`agent_id` / `agent_version` / `user_id` 取自会话；对同一会话再插一条 `event_seq` 相同的行走 `_insert_ignore` 不报错且行数不变）；`test_reopen_continues_seq`（新建第二个 `PgEventStore` 实例指向同库 → seq 接续） |
| FR-6 | Work Queue 契约 | `test_pg_work_queue_contract.py`（`work_queue` 参数化，注入可控 clock）：`test_claim_next_is_exclusive`（同 A05 FR-2 前半，`attempts == 1`、`claimed_at` 非空）；`test_lease_rules`（同 A05 FR-4）；`test_expired_after_ttl_plus_grace`（+170 秒不在 `expired()`，+181 秒在）；`test_finish_sets_completed_at_and_never_reclaimed`（`finish(stopped)` 后 `claim_next` → None，`completed_at` 非空）；`test_inbox_columns_roundtrip`（`create(inbox_after_seq=7)` → `get().inbox_after_seq == 7`；`complete(consumed_through_seq=9)` → `9`）；`test_wait_for_work_returns_within_slice`（无 notify、`timeout=10` → 2.5 秒内返回） |
| FR-7 | registry 解析与缓存 | `test_control_plane.py`（`FakeAdminConsole` + 可控 clock）：`test_get_version_none_uses_effective`（`get_version(t, a, None)` 请求路径以 `/effective?tenant_id=t` 结尾）；`test_integer_version_cached_forever`（同一整数版本调两次只发 1 次请求，clock 前进 1 天仍 1 次）；`test_effective_cache_ttl`（10 秒内 1 次请求，clock +11 秒后 2 次）；`test_unknown_agent_returns_none`（404 → None）；`test_non_ulid_agent_id_short_circuits`（`"demo"` → None 且 0 次请求）；`test_implicit_local_environment`（`get_environment(t,"local")` 返回 cloud、`sandbox_backend == "docker"`、0 次请求；`implicit_local_env=False` → None）；`test_desktop_worker_agent_without_env_maps_to_unset`（`runtime="desktop_worker"`、`default_environment_id=None` → `get_agent().default_environment_id == "unset"`；`get_environment(t,"unset")` → None）；`test_remote_backend_rejected`（环境 config `sandbox_backend="remote"` → `MAError` code `invalid_request`）；`test_internal_401_maps_to_internal_error`（401 → `MAError` code `internal_error`，`str(err)` 与日志不含 internal token：用 `caplog` 断言） |
| FR-8 | PAT 内省与缓存 | `test_control_plane.py::test_authenticate_active_and_cache`（active → `Principal` 租户 / 用户 / scopes 正确；30 秒内第二次 0 新请求；clock +31 秒后再请求）；`test_inactive_is_cached`（`active:false` → None，30 秒内不重复请求）；`test_non_pat_token_short_circuits`（`"Bearer-xyz"` → None，0 请求）；`test_introspect_body_carries_token_not_query`（请求 URL 不含 token，body JSON `token` 字段等于 token）；`test_on_behalf_of_requires_scope`（`on_behalf_of_user.set(ULID)` 后：scopes 含 `ma:sessions:on_behalf` → `principal.user_id == ULID`；只含 `ma:admin` 也通过；两者都不含 → `MAError` code `forbidden_scope`） |
| FR-9 | on-behalf-of 中间件 | `test_control_plane.py::test_middleware_sets_and_resets_contextvar`：最小 Starlette app 的 endpoint 返回 `on_behalf_of_user.get()`；带合法 ULID 头 → 返回该 ULID；带 `not-a-ulid` → `null`；请求结束后在测试协程里 `on_behalf_of_user.get() is None` |
| FR-10 | 网关 LLM 头与模型名 | `tests/managed/test_gateway_llm.py::test_invoke_sends_gateway_headers`：`FakeGateway`（与服务测试同款，复制一份最小实现到该测试文件内）；`GatewayLLMFactory(base_url=fake.base_url+"/v1", token="agx-pat-test").create(provider="demo", model="reply-model", context=LLMCallContext(tenant_id="t", session_id="01JABCDEFGHJKMNPQRSTVWXYZ0", agent_id="01JAGENTAAAAAAAAAAAAAAAAAA", agent_version=2))` 调 `invoke([{"role":"user","content":"hi"}])` → 假网关收到：`authorization == "Bearer agx-pat-test"`、`x-agenticx-provider == "demo"`、`x-agenticx-trace-id == "01jabcdefghjkmnpqrstvwxyz0"`、`x-agenticx-trace-step == "1"`、`x-agenticx-trace-stage == "ma.session"`、`x-agenticx-session-id`、`x-agenticx-agent-id`、`x-agenticx-deployment-id == "ma-01JAGENTAAAAAAAAAAAAAAAAAA-v2"`、body `model == "reply-model"`；第二次调用 `trace-step == "2"`。`test_stream_with_tools_sends_headers`：同上走 `stream_with_tools` 并消费完生成器。`test_repr_hides_token`：`"agx-pat-test" not in repr(factory)` | gitleaks:allow
| FR-11 | 隔离 HOME 与运行时配置 | `test_isolation.py::test_home_must_match`（`monkeypatch.setenv("HOME", a)`，传 `b` → `RuntimeIsolationError`）；`test_creates_sessions_root_equal_to_session_boundary`（HOME=tmp → 返回 `tmp/.agenticx`，且 `agenticx.runtime.session_boundary.sessions_root() == tmp/.agenticx/sessions` 存在）；`test_write_runtime_config`（文件内容等于 `RUNTIME_CONFIG_YAML`，权限 `0o600`） |
| FR-12 | 沙箱探测策略 | `test_isolation.py::test_probe_required_raises_when_unavailable`（`monkeypatch` 让 `build_command_sandbox_plan` 抛 `CommandSandboxUnavailable("no bwrap")`，mode `required` → `RuntimeIsolationError` 消息含 `no bwrap`）；`test_probe_best_effort_returns_none`（同条件 `best_effort` → 返回 `"none"` 且 `caplog` 有 WARNING）；`test_probe_success_returns_backend`（`runner` 替身返回 `returncode=0` → 返回 plan.backend） |
| FR-13 | 端到端（sqlite 存储 + 假控制面 + 假网关） | `test_app_e2e.py::test_portal_style_session_end_turn`：`HOME`/`MA_RUNTIME_HOME` 设为 `tmp_path/"home"`；`Settings(database_url=f"sqlite:///{db}", allow_sqlite=True, command_sandbox="best_effort", gateway_url=fake_gw+"/v1", gateway_token="agx-pat-gw", admin_url="http://admin.test", internal_token="it", home=...)`；表 `create_all`；`app = build_app(settings, admin_transport=FakeAdminConsole(...).transport, scrub_env=False)`；`httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://rt")` 并手动 `await app.state.ma.startup()`。FakeAdminConsole：PAT `agx-pat-svc` active、scopes `["ma:sessions:read","ma:sessions:write","ma:sessions:on_behalf","ma:agents:read"]`、tenant `T`、user `SVCUSER...`；agent `A`（ULID）effective v2，manifest `{"schema":"agx.agent/v1","model":"demo/reply-model","system":"you are a test agent","tools":[{"type":"agx_builtin","default_policy":"always_allow"}]}`，runtime `cloud`，`default_environment_id: null`。步骤：`POST /ma/v1/sessions`（头 `Authorization: Bearer agx-pat-svc`、`X-AgenticX-On-Behalf-Of: <USER ULID>`，body `{"agent_id": A, "source": "portal"}`）→ 201，`agent_version == 2`、`environment_id == "local"`、`created_by_user_id == USER`；POST `user.message` → 200；轮询 GET 会话（≤15 秒）到 `idle` + `end_turn`；GET events 含 `agent.message` 文本等于假网关脚本文本；假网关记录的该会话请求头满足 FR-10 的头集合（`x-agenticx-session-id == sid`）；`ma_session_usage` 行数等于 `span.model_request_end` 事件数且 `user_id == USER` | gitleaks:allow
| FR-14 | 端到端：bash 在会话私有目录执行 | `test_app_e2e.py::test_bash_runs_in_session_workdir`：假网关脚本第 1 次返回 `bash_exec` 工具调用 `{"command": "echo e3-ok > out.txt"}`，第 2 次返回文本；会话结束后 `tmp_path/"home"/".agenticx"/"sessions"/sid/"work"/"out.txt"` 内容为 `e3-ok\n`；事件里有 `agent.tool_use(name="bash_exec", evaluated_policy="always_allow")` 与 `is_error is False` 的 `agent.tool_result` |
| FR-15 | 端到端：固定版本 | `test_app_e2e.py::test_pinned_routing_selects_effective_version`：FakeAdminConsole 把 effective 设为 v1（latest 为 v2）→ 新会话 `agent_version == 1` |
| FR-16 | 端到端：鉴权 | `test_app_e2e.py::test_auth_failures`：无头 → 401；`agx-pat-inactive` → 401；只有 `ma:sessions:read` 的 PAT 带 on-behalf-of 头建会话 → 403 `forbidden_scope`；`remote` 环境 → 400 |
| FR-17 | Worker 面默认关闭 | `test_app_e2e.py::test_desktop_worker_disabled_by_default`：`POST /ma/v1/environments/<ULID>/work/poll` → 404（路由不存在）；`desktop_worker_enabled=True` 构建的 app 上同一路径不再是 404（环境查无时为 404 `environment_not_found` 的 JSON 体，断言 `error.code`） |
| FR-18 | 健康检查 | `test_app_e2e.py::test_health_endpoints`：`/healthz` 200 无需鉴权；`/readyz` 200 |
| FR-19 | db-schema 追加列 | `pnpm --filter @agenticx/db-schema test` 全绿（含改过的三个测试文件）；`ma-schema.test.ts` 冻结列集合含两列新列 |
| FR-20 | nginx 分流 | 手动 / CI 命令（§8）：`nginx -t` 通过；`test_nginx_routing` 不写成 pytest（需要容器），改为 §8 的 curl 验证清单逐条输出期望 |
| NFR-1 | 框架零改动 | `git diff --name-only -- agenticx` 只出现 `agenticx/managed/gateway_llm.py`（新文件）；`git diff --quiet -- agenticx/studio/server.py agenticx/runtime agenticx/cli agenticx/llms` |
| NFR-2 | 既有 MA 测试不回归 | `pytest tests/managed -q --no-cov` 全绿 |
| NFR-3 | 镜像可导入 | `docker build` 成功；`docker run --rm --entrypoint python <img> -c "import ma_agent_runtime.app, agenticx.managed.host.app; print('ok')"` 输出 `ok` |
| NFR-4 | 不泄露凭证 | FR-2、FR-7（`caplog`）、FR-10（repr）三组断言；人工检查：`rg -n "logger\.(info|warning|error|exception).*token" enterprise/apps/agent-runtime/ma_agent_runtime` 无把 token 变量传入日志 |
| NFR-5 | start-dev 默认行为不变 | `bash -n enterprise/scripts/start-dev.sh`；人工：不带 `--with-agent-runtime` 运行时输出与改动前相同（无 agent-runtime 行、不生成 PAT） |

---

## 8. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
python -m pip install -r enterprise/apps/agent-runtime/requirements.txt

# 框架新文件
python -m pytest -o addopts="" -o asyncio_mode=auto tests/managed/test_gateway_llm.py -q
python -m pytest tests/managed -q --no-cov

# 服务单测 + sqlite 契约
python -m pytest -o addopts="" -o asyncio_mode=auto enterprise/apps/agent-runtime/tests -q

# 真 PG 契约（可选；用 dev.yml 的 postgres：docker compose -f enterprise/deploy/docker-compose/dev.yml --profile postgresql up -d）
MA_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/agenticx \
  python -m pytest -o addopts="" -o asyncio_mode=auto enterprise/apps/agent-runtime/tests -q -k "pg"

# db-schema
pnpm -C enterprise --filter @agenticx/db-schema test
pnpm -C enterprise --filter @agenticx/db-schema typecheck
pnpm -C enterprise --filter @agenticx/iam-core typecheck

# 脚本语法
bash -n enterprise/scripts/start-dev.sh enterprise/scripts/start-dev-with-infra.sh enterprise/scripts/bootstrap.sh

# 镜像
docker build -f enterprise/apps/agent-runtime/Dockerfile -t agx-agent-runtime:dev .
docker run --rm --entrypoint python agx-agent-runtime:dev -c "import ma_agent_runtime.app, agenticx.managed.host.app; print('ok')"
docker run --rm --security-opt seccomp=unconfined --security-opt apparmor=unconfined --entrypoint bwrap agx-agent-runtime:dev \
  --ro-bind / / --dev /dev --unshare-pid --proc /proc true && echo "bwrap ok"

# nginx 配置（为静态 upstream 主机名补 hosts）
docker run --rm -v "$PWD/enterprise/deploy/nginx/gateway.conf:/etc/nginx/nginx.conf:ro" \
  --add-host gateway-a:127.0.0.1 --add-host gateway-b:127.0.0.1 \
  --add-host web-portal:127.0.0.1 --add-host admin-console:127.0.0.1 \
  nginx:1.27-alpine nginx -t

# compose 结构
DATABASE_URL=x DEFAULT_TENANT_ID=x GATEWAY_INTERNAL_TOKEN=x ADMIN_CONSOLE_LOGIN_PASSWORD=x ADMIN_CONSOLE_SESSION_SECRET=x \
  docker compose -f enterprise/deploy/docker-compose/prod.yml --profile managed-agents config >/dev/null && echo "compose ok"

git status --porcelain
```

**本地联调（需 E01 / E02 / A04 / A05 已合入、PG 已起）：**

```bash
cd /Users/damon/myWork/AgenticX/enterprise
bash scripts/start-dev-with-infra.sh --with-agent-runtime --ui=stream
# 另一终端
curl --noproxy '*' -s http://127.0.0.1:8092/healthz            # {"ok":true}
SVC=$(cat .local-secrets/ma_portal_service.pat)
AGENT=<在 /admin/agents 里一个 cloud Agent 的 id>
USER=<任一用户 ULID>
SID=$(curl --noproxy '*' -s -X POST http://127.0.0.1:8092/ma/v1/sessions \
  -H "Authorization: Bearer $SVC" -H "X-AgenticX-On-Behalf-Of: $USER" -H 'content-type: application/json' \
  -d "{\"agent_id\":\"$AGENT\",\"source\":\"api\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl --noproxy '*' -s -X POST http://127.0.0.1:8092/ma/v1/sessions/$SID/events -H "Authorization: Bearer $SVC" \
  -H 'content-type: application/json' -d '{"events":[{"type":"user.message","content":[{"type":"text","text":"你好"}]}]}'
curl --noproxy '*' -N -s http://127.0.0.1:8092/ma/v1/sessions/$SID/events/stream -H "Authorization: Bearer $SVC"
# 期望：看到 session.status_running … agent.message … session.status_idle(end_turn)
# 网关审计：admin-console 网关审计页按 session_id=$SID 能查到模型调用记录
```

---

## 9. 回滚

- 运行时开关：agent-runtime 只在 `start-dev.sh --with-agent-runtime` 或 compose `--profile managed-agents` 时启动；门户开关 `MA_RUNTIME_ENABLED` 默认 `0`（E04 消费）。不启用时对现有功能零影响。
- nginx：`/ma/v1` 三段 location 删除即回滚；未部署 agent-runtime 时会话面返回 502，其他路由不受影响。
- 迁移 `0062` / `0036` 为纯追加列，回滚代码后列保留无害；如需物理回滚：`ALTER TABLE "ma_work_items" DROP COLUMN IF EXISTS "consumed_through_seq"; ALTER TABLE "ma_work_items" DROP COLUMN IF EXISTS "inbox_after_seq";` 并删除 `__drizzle_migrations` 对应行（以实际库为准）。
- 代码：删除 §3.1 新建文件，`git checkout` 被修改文件。
- 紧急关闭：撤掉 admin-console 的 `MA_INTERNAL_TOKEN` → 内省与 registry 全部失败 → 所有会话面请求 500，不会执行任何新回合。

---

## 10. 不变量、风险与待确认问题

### 10.1 不变量

1. `agenticx/studio/server.py`、`agenticx/runtime/**`、`agenticx/cli/**`、`agenticx/llms/**` 零改动；`agenticx/managed/**` 只新增 `gateway_llm.py`。
2. Go 网关零改动；agent-runtime 发出的头只限 §5.5 的 7 个。
3. agent-runtime 只写 `ma_sessions` / `ma_session_events` / `ma_work_items` / `ma_session_usage`，**从不写**控制面表，从不执行 DDL。
4. 同一会话 seq 连续、单调、从 1 开始；预览帧不落库。
5. 不带 `--with-agent-runtime` 时 `start-dev.sh` 行为、日志、生成文件与改动前一致；bootstrap 不在默认流程写库。
6. 现有 nginx location（`/healthz`、`/v1/`、`/api/chat/`、`/admin/`、`/`）语义不变。
7. 日志、异常、`repr` 中永不出现 PAT、内部 token、数据库口令。

### 10.2 风险

1. **bubblewrap 在容器内需要 `seccomp=unconfined` / `apparmor=unconfined`**：降低了容器本身的系统调用过滤强度，换来每条命令的文件隔离。若客户环境不允许，只能 `best_effort`（bash 无 OS 隔离），必须在部署评审中显式接受。
2. **sync Work Queue 阻塞事件循环**：仅 Worker 面启用后出现，每次调用 1–2 条短 SQL；Worker 面默认关闭。
3. **网关侧的用户级配额 / 模型可见性不作用于托管会话**（D4）：门户 E04 做模型可见性前置校验；配额待 MA-E10。网关审计里的 user 是服务账号，需要按 `session_id` 关联真实用户。
4. **出站网络未限制**：工具可访问容器网络内的服务（admin-console、PG 端口）。密钥已擦除，内部接口都要 token，但 SSRF 面仍在；出站白名单归 MA-A06。
5. 单副本：进程重启时运行中会话被收尾为 `retries_exhausted`（A04 行为）。
6. `max_tool_rounds` 软上限（master §12）在托管运行时同样存在。
7. 网关策略拦截（`90001` / `90002`）映射为 `retries_exhausted` + `session.error`，而不是 `policy_blocked`；要映射需改 MA-A02 适配器，列为后续。

### 10.3 待确认问题（交给用户 / master 拍板）

- **Q1**：master §7 W2 门写的是「工具在 docker 沙箱里跑」。本子规划实际交付的是「运行时容器内 + bubblewrap 每命令文件隔离 + 每会话目录」，**不是每会话一个容器**。是否接受并在 master §12 登记？若必须每会话容器，需要另起子规划改造 `agent_tools.py` 的命令执行路径。
- **Q2（已决，2026-10-25）**：新增专用 scope `ma:sessions:on_behalf`（已加入 MA-00 `PAT_SCOPES` 与管理台选项），门户服务 PAT 不再需要 `ma:admin`。
- **Q3**：是否需要首版就支持 MySQL 部署的 agent-runtime？
