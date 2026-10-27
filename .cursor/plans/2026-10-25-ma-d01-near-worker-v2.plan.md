# MA-D01 Near Worker 2.0：桌面端开启 MA 协议、领取授权与「企业 Worker」设置面板

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W3 · MA-D01）
Depends-on:
- MA-00 `.cursor/plans/2026-10-25-ma-00-protocol-freeze.plan.md`（已实现：`agenticx/managed/{protocol,manifest,errors}.py`）
- MA-A01 / A02 / A03（已实现：`agenticx/managed/{spec,llm,builder,permissions,actions}.py`、`agenticx/managed/events/*`）
- MA-A04 `.cursor/plans/2026-10-25-ma-a04-managed-host.plan.md`（实施中：`agenticx/managed/host/*`）
- MA-A05 `.cursor/plans/pending/2026-10-25-ma-a05-worker-sdk.plan.md`（未实施：`agenticx/managed/worker/*`、`enterprise_worker.py` 的 `protocol: legacy|ma` 开关）
- MA-E02 `.cursor/plans/2026-10-25-ma-e02-agent-versioning-admin.plan.md`（已实现：`/api/internal/ma/*`、`src/lib/ma/{internal-auth,errors,http,records}.ts`）
- MA-E03 `.cursor/plans/pending/2026-10-25-ma-e03-agent-runtime-service.plan.md`（未实施：`enterprise/apps/agent-runtime/ma_agent_runtime/*`、`agenticx/managed/gateway_llm.py`）

> 风险等级：高（新增授权边界；修改被 `agenticx/studio/server.py:74` 顶层 import 的 `enterprise_worker.py`）。合入前建议强推理档只读审查。
>
> **上游未实现声明**：A04 / A05 / E03 写作时尚未合入。下文引用它们的类名、函数签名、文件路径，一律按各自 plan 书写，**以实际实现为准，实施前核对**：
> `rg -n "class MAWorker|class WorkItemRunner|class MAWorkerClient|def worker_protocol|def _run_once_ma|def _ma_worker_for" agenticx/` 与 `rg -n "class PgWorkQueue|class PatIntrospectionAuthenticator|class AdminConsoleClient|def wire_worker_plane|def build_app" enterprise/apps/agent-runtime`。签名不一致时按实际签名调整调用代码，不得为迁就本文去改动上游已有行为（本文 §3 明确列出的追加点除外）。
>
> **栈说明（偏离 master §0 规则 1，须用户确认，见 §12 Q1）**：本子规划跨 Python（`agenticx/` 桌面后端 + `enterprise/apps/agent-runtime`，同为 Python）、Desktop（React 设置面板）与 admin-console TS（**仅 1 个内部只读路由**）。TS 那一处是 agent-runtime 解析「用户分配键」的唯一合法读取通道（单一写入方原则禁止 agent-runtime 直读 IAM 表），无法在其他两栈内完成。

---

## 0. 一句话目标

让员工 Near 在登录企业后，可以用 MA 协议承接 `desktop_worker` 环境的托管会话：模型一律经企业网关（设备 PAT），每个 Work Item 在 `~/.agenticx/sessions/<session_id>/work` 私有目录执行；agent-runtime 侧对桌面设备 PAT 做 scope 映射、**领取授权**（环境 `worker_keys` + Agent `worker_keys` 必须命中该用户分配键）与会话归属校验；设置页新增「企业 Worker」面板展示状态、所属环境、运行中任务，并提供接单开关（暂停 / 恢复）。

---

## 1. 根因 / 动机与证据链

### 1.1 来自 master 的约束

| master 节 | 约束 | 本子规划落点 |
|---|---|---|
| §1.3 桌面作为全回路 Worker | 推理、工具、数据留在员工机器，只回传事件 | A05 `WorkItemRunner` 在本机跑；本文只换 LLM 工厂与工作目录 |
| §4 决策 2 | `desktop_worker`：Worker 领取 Work Item 后本机跑完整 `AgentRuntime` | §5.3 |
| §4 决策 3 | 桌面 Worker 用设备 PAT（`desktop:managed`）经企业网关，带 Trace / Session / Agent 头 | §5.3.3 `GatewayLLMFactory`（E03 D13 新建于 `agenticx/managed/gateway_llm.py`） |
| §4 决策 9 | 个人模式不变 | §10 不变量 |
| §6.3 | `work/poll` / `ack` / `heartbeat` / `complete` / `fail` / `events:ingest` / `inbox/stream` | 只加授权中间件，不改路由语义 |
| §6.4 | 一次任务时序 | 不变 |
| §7 W3 门 | 员工开启 Worker，在面板看到所属环境；`desktop_worker` 任务在本机工作区执行 | §5.5 面板；§8 演示脚本 |
| §9 MA-D01 行 | 开启 A05 的 `ma` 协议；设置页「企业 Worker」面板；每个 Work Item 用 `ensure_session_workdir` 独立目录 | §5.3、§5.5 |
| E03 D11 | agent-runtime Worker 面默认关闭，`worker_keys` 授权由 MA-D01 实现后再打开 | §5.2 |

### 1.2 现状代码证据（2026-10-25 核对；实施前重新核对行号）

| 文件 | 行 | 事实 | 影响 |
|---|---|---|---|
| `agenticx/runtime/enterprise_worker.py` | 29–35 | `HEARTBEAT_INTERVAL_S=15`、`CLAIM_INTERVAL_S=3`、`DISABLED_SLEEP_S=5`、`AUTH_PAUSE_S=60`、`AUTH_ERROR="企业登录已失效"` | 复用 |
| 同上 | 46–61 | `worker_enabled()` = `enterprise.enabled` + `token` + `base_url` + `enterprise.worker.enabled` | 交互式环境（§5.3.6）需要一个不看 `worker.enabled` 的登录态读取 |
| 同上 | 64–75 | `_enterprise_settings()` 仅在 `worker_enabled()` 时返回 `(token, base_url)` | 同上 |
| 同上 | 78–79 | `_state_dir() = agx_home()/"enterprise_worker"` | A05 把 MA 工作目录放在 `_state_dir()/"ma_sessions"`，本文改为 `sessions_root()` |
| 同上 | 266–276 | `status()` 返回 `enabled/running/device_id/agents/last_heartbeat_at/current_task_id/last_error` | 只追加键 |
| 同上 | 278–304 | `run_forever`：`if not worker_enabled(): sleep(DISABLED_SLEEP_S); continue` | 交互式环境需要放宽入口条件（§5.3.6） |
| 同上 | 306–340 | `run_once`：心跳 → 领取 → `_execute` | A05 在 `token, base = settings` 之后插入 `if worker_protocol() == "ma": return await self._run_once_ma(token, base)` |
| `agenticx/runtime/session_boundary.py` | 13–14、24–30、33–53 | `sessions_root() = Path.home()/".agenticx"/"sessions"`；`ensure_session_workdir(sid, root=None)` → `<root>/<sid>/work`；`foreign_session_denial` **以 `sessions_root()` 为基准**拒绝别的会话目录 | Worker 的 `workdir_root` 必须**恰好等于** `sessions_root()`，文件工具的跨会话拒绝才生效 |
| `agenticx/managed/builder.py` | 99–123 | `ManagedAgentBuilder(llm_factory, workdir_root).build()` 内部 `ensure_session_workdir(context.session_id, root=self._workdir_root)` | 只需改传入的 `workdir_root` |
| `agenticx/studio/session_manager.py` | 3496–3522 | 会话列表扫描 `sessions_root` 子目录，**无 `messages.json` 的目录直接跳过** | MA 工作目录不会出现在 Near 历史会话里 |
| `agenticx/memory/session_store.py` | 801–811 | FTS 回填同样跳过无 `messages.json` 的目录 | 同上 |
| `agenticx/managed/llm.py` | 15–35 | `LLMCallContext(tenant_id, session_id, agent_id, agent_version, user_id)`；`LocalConfigLLMFactory` | A05 在 Near 内用本机 provider，违背决策 3，本文替换 |
| `agenticx/studio/enterprise_worker_routes.py` | 19–20、43–63 | `EnterpriseWorkerToggle(enabled: bool)`；`GET /api/enterprise-worker/status`、`PUT /api/enterprise-worker` | 追加字段与一个 POST 路由；该模块已在 `server.py:118` 导入并注册，**`server.py` 零改动** |
| `agenticx/studio/server.py` | 74、118、1178–1191、1227–1228 | 顶层 import `EnterpriseWorker`、`register_enterprise_worker_routes`；lifespan 起 `run_forever` | 冷启动 smoke 为强制 AC |
| `enterprise/apps/web-portal/src/lib/desktop-auth.ts` | 3–4 | 设备 PAT scopes 恒为 `["workspace:chat", "desktop:managed"]` | 设备 PAT **没有任何 `ma:` scope** → agent-runtime 必须做映射（§5.2.2） |
| `enterprise/apps/web-portal/src/lib/worker-tasks/eligibility.ts` | 3–24 | 旧协议的资格判定：`resolveAssignmentKeysForUser(...)` 后，`agent.workerKeys.some(key => wanted.has(key))` | 新协议沿用同一语义（分配键交集） |
| `enterprise/packages/iam-core/src/repos/assignment-keys.ts` | 29–51 | 分配键 = `all` + userId + `email:<lower>` + `dept:<祖先链>` + `group:<id>` | 只能在 TS 侧解析 → 新增内部路由 |
| `enterprise/packages/iam-core/src/repos/users.ts` | 266 | `getAdminUser(tenantId, id)` → `AdminUserDto \| null`（含 `email`、`deptId`、`status`） | 内部路由先查用户 |
| `enterprise/packages/iam-core/src/repos/ma-environments.ts` | 301–319 | `listMaEnvironments(tenantId, { status?, type? })` | 内部路由列可承接环境 |
| `enterprise/apps/admin-console/src/app/api/internal/ma/pat-introspect/route.ts` | 1–40 | 内部路由样板：`isMaInternalAuthorized` → `noStore(...)`，错误走 `maError` / `maErrorFromException` | 新路由照抄结构 |
| `agenticx/managed/protocol.py` | 71–85、88–91 | `PAT_SCOPES` 含 `ma:worker` / `ma:sessions:read` / `ma:sessions:write`；`WORK_LEASE_TTL_SECONDS=120` 等 | 映射目标 scope |
| `agenticx/managed/protocol.py` | 361–372 | `DesktopWorkerEnvironmentConfig{type, worker_keys}` | 环境级 `worker_keys` |
| `desktop/src/components/AccountTab.tsx` | 100–107、257–384、477–510 | 现有「让这台电脑承接企业智能体任务」卡片：状态轮询 `GET /api/enterprise-worker/status`（10 s）、开关 `PUT /api/enterprise-worker`，手写 switch | 迁移到新面板，改用 `SettingsSwitch` |
| `desktop/src/settings-tab.ts` | 16–35 | `SETTINGS_TAB_IDS` | 追加 `"enterprise_worker"` |
| `desktop/src/components/SettingsPanel.tsx` | 1092–1112、5022、7159–7199、7220 | `TAB_DEFS`；`tabs` 由 `t(\`tabs.${id}\`)` 生成；左栏渲染；`{tab === "account" && <AccountTab />}` | 追加 tab 与渲染分支；未登录企业时隐藏该 tab |
| `desktop/src/components/settings/SettingsSwitch.tsx` | 1–42 | 统一开关组件 `{checked, disabled, onChange, size, aria-label}` | AGENTS.md：设置内开关视觉须统一 |
| `desktop/locales/{zh,en}/settings.json` | — | 设置文案；`desktop/src/i18n/message-parity.test.ts` 校验中英键一致 | 两份同步加键 |

### 1.3 为什么需要 agent-runtime 侧授权（E03 D11 的遗留）

A05 宿主与 E03 PG Work Queue 的 `claim_next(tenant, env, device_id)` 对**租户内任何**持 `ma:worker` 的 token 开放任一 `desktop_worker` 环境；`require_lease` 只比对 `device_id`。若直接给设备 PAT 映射 `ma:worker`，任何员工设备都能领取别人的任务、读取别人的会话（A04 读接口只按租户过滤）。因此本文在 agent-runtime 加一层 **`DesktopAccessMiddleware`**（纯 ASGI），把以下规则绑定到 `MA_RUNTIME_DESKTOP_WORKER_ENABLED=1`（不可单独开 Worker 面而不装授权）：

1. 领取：环境必须在该用户的「可承接环境」内（环境 `config.worker_keys` ∩ 用户分配键 ≠ ∅）。
2. 领取：Work Item 所属会话的 Agent 若 `worker_keys` 非空，须与用户分配键有交集。
3. 领取：`source == "desktop"` 的会话只能由会话创建者本人领取（桌面交互式会话不外流到他人电脑）。
4. 租约：`claimed_by_user_id` 记录领取用户；后续 ack / heartbeat / complete / fail / ingest / inbox 必须是同一用户，否则 `409 work_lease_lost`。
5. 设备 PAT 访问会话面（`MA_RUNTIME_DESKTOP_PAT_ENABLED=1`）：只能读写自己创建的会话；建会话时 Agent 必须对该用户可见、`source` 必须为 `desktop`（会话创建规则由 MA-D02 使用，授权在本文统一实现）。

---

## 2. 关键设计决策（本子规划内定）

| # | 决策 | 理由 |
|---|---|---|
| D1 | 设备 PAT scope 映射在 agent-runtime 的 `PatIntrospectionAuthenticator` 内做：`desktop:managed` ∈ scopes 且 `MA_RUNTIME_DESKTOP_PAT_ENABLED=1` → 追加 `ma:sessions:read`、`ma:sessions:write`、`ma:worker`；**保留** `desktop:managed` 作为「桌面主体」标记；绝不追加 `ma:admin` / `ma:sessions:on_behalf` / `ma:agents:*` | 不改 web-portal 签发逻辑；已登录设备无需重新登录；开关关闭即回到 403 |
| D2 | 授权统一放在新文件 `ma_agent_runtime/desktop_access.py` 的纯 ASGI 中间件，不改 A04/A05 路由 | A04/A05 是框架代码；中间件可整体开关 |
| D3 | 用户分配键与可承接环境由 admin-console 新内部路由 `GET /api/internal/ma/worker-eligibility?tenant_id=&user_id=` 一次返回，agent-runtime 按 `(tenant, user)` 缓存 30 秒 | 单一写入方 + 分配键只在 iam-core 解析（`assignment-keys.ts` 注释明确「唯一一处」） |
| D4 | 拒绝领取不可见环境时返回 `404 environment_not_found`（不暴露环境存在性）；会话归属不符返回 `404 session_not_found`；租约用户不符返回 `409 work_lease_lost`；桌面主体建会话 `source != "desktop"` → `400 invalid_request` | 只用 MA-00 冻结错误码 |
| D5 | Agent 级 `worker_keys` 过滤：中间件在 poll 前取该环境 queued 项的 `agent_id` 集合（同步 SQL），逐个经 registry（已有 10 秒缓存）判定，结果放 contextvar；`PgWorkQueue.claim_next` 只在允许集合内选 | registry 是 async，`claim_next` 是 sync（A05 接口）；poll 期间新出现的其它 Agent 的任务本轮跳过，下一轮再判定（桌面 `max_wait_seconds=0`，3 秒一轮） |
| D6 | 桌面端协议新增取值 `dual`（先 MA 后 legacy），面板开关「承接托管智能体任务」写 `protocol: dual` + `ma_environment_mode: auto`；关闭写回 `legacy` | E04 约定协作房间 `desktop_worker` 仍走旧队列；单选 `ma` 会让旧房间任务没人接 |
| D7 | 环境自动发现：`ma_environment_mode == "auto"` 时，Worker 调 agent-runtime 新增的 `GET /ma/v1/work/environments`（仅 `ma:worker`，返回该用户可承接的 `desktop_worker` 环境），缓存 300 秒；`manual`（缺省）保持 A05 语义（读 `ma_environment_ids`，空则 `MA_ENV_MISSING`） | A05 的 FR-17 测试不受影响；`/ma/v1/work/*` 已被 nginx 分到 agent-runtime（E03 §5.15 `location /ma/v1/`），无需改 nginx |
| D8 | Near 内的 MA Worker 一律用 `GatewayLLMFactory(base_url=<gateway>, token=<设备 PAT>)`；网关地址 = `enterprise.worker.gateway_url`，缺省 `f"{enterprise.base_url}/v1"`（生产 nginx 把 `/v1/` 转网关） | master 决策 3；本地开发门户是 Next `:3000` 无 `/v1`，需显式配 `http://127.0.0.1:8088/v1` |
| D9 | `workdir_root = agenticx.runtime.session_boundary.sessions_root()` | 使 `foreign_session_denial` 对 MA 会话生效；无 `messages.json` 的目录不会污染 Near 历史（证据见 1.2） |
| D10 | 交互式环境：`EnterpriseWorker.add_interactive_environment(env_id)`（TTL 30 分钟，每次调用续期）让 Near 在**未开启接单**时也只为该环境轮询；供 MA-D02「本机执行」使用。交互式轮询只需企业登录态，不看 `enterprise.worker.enabled` | D02 的「本机执行」与 W3 门「直接对话」要求不依赖用户先打开接单开关；会话归属规则 3 保证只领自己的桌面会话 |
| D11 | 「企业 Worker」作为设置页**独立 tab**（id `enterprise_worker`），仅企业登录后显示；把 AccountTab 中原有的 Worker 卡片整体迁过来（AccountTab 只留一行跳转链接） | master §9 要求设置页新增面板；避免两处各有一个开关 |
| D12 | 「暂停 / 恢复」= `enterprise.worker.enabled` 开关（已有 `PUT /api/enterprise-worker`）；暂停后正在执行的 Work Item 跑完为止，不强杀 | 复用现有语义（`run_forever` 每轮检查开关，A05 `MAWorker.run_once` 内一次 run 跑到完成） |

---

## 3. In scope / Out of scope

### 3.1 In scope（只能创建或修改这些文件）

**admin-console（TS，1 路由）**
- 新建 `enterprise/apps/admin-console/src/app/api/internal/ma/worker-eligibility/route.ts`
- 新建 `enterprise/apps/admin-console/src/app/api/internal/ma/__tests__/worker-eligibility-route.test.ts`

**agent-runtime（Python，E03 的文件，以实际实现为准）**
- 修改 `enterprise/apps/agent-runtime/ma_agent_runtime/config.py`（`Settings` 追加 2 字段 + `from_env` 2 行解析）
- 修改 `enterprise/apps/agent-runtime/ma_agent_runtime/control_plane.py`（`AdminConsoleClient.get_worker_eligibility`；`PatIntrospectionAuthenticator` 映射）
- 修改 `enterprise/apps/agent-runtime/ma_agent_runtime/pg_work_queue.py`（claim 过滤与租约用户校验，读 contextvar）
- 修改 `enterprise/apps/agent-runtime/ma_agent_runtime/worker_wiring.py`（安装中间件与 `/ma/v1/work/environments` 路由）
- 修改 `enterprise/apps/agent-runtime/ma_agent_runtime/app.py`（`desktop_pat_enabled` 时也安装中间件；传参）
- 新建 `enterprise/apps/agent-runtime/ma_agent_runtime/desktop_access.py`
- 新建 `enterprise/apps/agent-runtime/tests/test_desktop_access.py`
- 修改 `enterprise/apps/agent-runtime/tests/fakes.py`（`FakeAdminConsole` 追加 worker-eligibility 处理）
- 修改 `enterprise/apps/agent-runtime/README.md`（追加 2 个环境变量说明）

**框架 / 桌面后端（Python）**
- 修改 `agenticx/managed/worker/client.py`（A05 文件，**只追加** `list_eligible_environments` 方法）
- 修改 `agenticx/runtime/enterprise_worker.py`（在 A05 改动之上追加，见 §5.3）
- 修改 `agenticx/studio/enterprise_worker_routes.py`
- 新建 `tests/test_enterprise_worker_d01.py`
- 新建 `tests/test_enterprise_worker_routes_d01.py`
- 修改 `tests/managed/test_worker_sdk.py`（A05 文件，只追加 1 个用例）

**Desktop**
- 修改 `desktop/src/settings-tab.ts`（追加 1 个 id）
- 修改 `desktop/src/settings-tab.test.ts`（若其断言 id 全集则同步）
- 修改 `desktop/src/components/SettingsPanel.tsx`（`TAB_DEFS` 1 行、tabs 过滤、渲染 1 行、企业登录态读取）
- 新建 `desktop/src/components/settings/enterprise/EnterpriseWorkerPanel.tsx`
- 新建 `desktop/src/components/settings/enterprise/enterprise-worker-status.ts`（纯函数）
- 新建 `desktop/src/components/settings/enterprise/enterprise-worker-status.test.ts`
- 新建 `desktop/src/components/settings/enterprise/EnterpriseWorkerPanel.test.tsx`
- 修改 `desktop/src/components/AccountTab.tsx`（移除 Worker 卡片与其状态 / 轮询 / 开关代码，换成一行跳转）
- 修改 `desktop/locales/zh/settings.json`、`desktop/locales/en/settings.json`

### 3.2 Out of scope（不得修改）

- `agenticx/studio/server.py`（零改动；路由经已注册的 `register_enterprise_worker_routes` 追加）。
- `agenticx/managed/host/**`、`agenticx/managed/worker/{runner,broker}.py`、`agenticx/managed/{protocol,manifest,spec,builder,llm,permissions,actions}.py`、`agenticx/managed/gateway_llm.py`（E03 新建，本文只调用）。
- web-portal 全部（设备 PAT 签发 scope 不改；旧 `/api/desktop/worker/*` 不改）；门户发起 `desktop_worker` 会话（E04 约定仍走旧队列，见 §12 Q3）。
- Go 网关；nginx（`/ma/v1/work/*` 已归 agent-runtime）；`desktop/electron/**`（本文无新 IPC，渲染进程经现有 `studioFetch` 访问本机 Studio）。
- 企业 Agent 入口与会话渲染（MA-D02 / MA-D03）；发布分身（MA-D04）。
- Work Item 自动转派；Worker 回传预览帧；多设备同用户负载均衡。

---

## 4. 数据与协议

### 4.1 admin-console 内部路由

`GET /api/internal/ma/worker-eligibility?tenant_id=<id>&user_id=<ULID>`，Bearer `MA_INTERNAL_TOKEN`，`cache-control: no-store`。

| 情况 | 响应 |
|---|---|
| 内部 token 不符 | 401 `{"error":{"code":"unauthorized","message":"invalid internal token"}}`（`maInternalUnauthorized()`） |
| `tenant_id` 不匹配 `TENANT_ID_RE` | 400 `invalid_request` `tenant_id is required` |
| `user_id` 不匹配 `ULID_RE` | 400 `invalid_request` `user_id is required` |
| 用户不存在或 `status === "disabled"` | 200 `{"user_id": "<id>", "assignment_keys": [], "environments": []}` |
| 正常 | 200，见下 |

```json
{
  "user_id": "01J…",
  "assignment_keys": ["all", "01J…", "email:a@x.com", "dept:01H…", "group:01K…"],
  "environments": [
    { "id": "01J…", "tenant_id": "t1", "name": "研发桌面", "type": "desktop_worker",
      "config": { "type": "desktop_worker", "worker_keys": ["dept:01H…"] }, "status": "active" }
  ]
}
```

`environments` = `listMaEnvironments(tenant, { type: "desktop_worker", status: "active" })` 中 `config.worker_keys` 与 `assignment_keys` 有交集的项，经 E02 `toMaEnvironmentRecord` 输出（恰好 6 键）。`worker_keys` 为空的环境**不可承接**（fail-closed，与旧协议 `eligibility.ts` 一致）。

### 4.2 agent-runtime 新增接口

`GET /ma/v1/work/environments`（scope `ma:worker`；经 nginx `location /ma/v1/` 到 agent-runtime）：

```json
{ "data": [ { "id": "01J…", "name": "研发桌面" } ] }
```

只返回 id 与 name（不回传 worker_keys）。

### 4.3 agent-runtime 环境变量（追加到 E03 §5.1 表）

| 变量 | 默认 | 说明 |
|---|---|---|
| `MA_RUNTIME_DESKTOP_PAT_ENABLED` | `0` | 仅 `"1"` 为真。为真时 `desktop:managed` PAT 映射 `ma:sessions:read/write` + `ma:worker`，并对桌面主体启用会话归属校验 |
| `MA_RUNTIME_ELIGIBILITY_CACHE_SECONDS` | `30` | 浮点 0–300，非法回退默认 |
| `MA_RUNTIME_DESKTOP_WORKER_ENABLED` | `0`（E03 既有） | 为真时接线 Worker 面，**且必然安装** `DesktopAccessMiddleware` 的 Worker 规则 |

### 4.4 Near `~/.agenticx/config.yaml`（追加到 A05 §5.11 表）

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `enterprise.worker.protocol` | `legacy` \| `ma` \| `dual` | `legacy` | 新增 `dual`：每轮先 MA（`max_wait_seconds=0`）再 legacy；其它值视为 `legacy` |
| `enterprise.worker.ma_environment_mode` | `manual` \| `auto` | `manual` | `auto`：经 `GET /ma/v1/work/environments` 发现；`manual`：读 `ma_environment_ids`（A05 语义） |
| `enterprise.worker.gateway_url` | str | `f"{enterprise.base_url}/v1"` | MA Worker 模型调用的网关根（须以 `/v1` 结尾） |
| `enterprise.worker.ma_base_url` | str | `enterprise.base_url`（A05 既有） | MA 会话面根 |

### 4.5 Studio 本机接口变更（`enterprise_worker_routes.py`）

- `PUT /api/enterprise-worker` 请求体：`{"enabled"?: bool, "ma_enabled"?: bool}`（两键皆可缺省，至少一个，否则 400 `detail="enabled or ma_enabled is required"`）。
  - `enabled` → `ConfigManager.set_value("enterprise.worker.enabled", bool)`（与现状相同）。
  - `ma_enabled=true` → `set_value("enterprise.worker.protocol", "dual")` 与 `set_value("enterprise.worker.ma_environment_mode", "auto")`；`false` → `set_value("enterprise.worker.protocol", "legacy")`（`ma_environment_mode` 不动）。
  - 响应：`status()`（同 GET）。
- `GET /api/enterprise-worker/status` 响应在现有键之外**追加**：

```json
{
  "protocol": "dual",
  "ma_enabled": true,
  "ma_environment_mode": "auto",
  "ma_environments": [{ "id": "01J…", "name": "研发桌面" }],
  "ma_work": [
    { "work_id": "01J…", "session_id": "01J…", "agent_id": "01J…", "agent_version": 3,
      "environment_id": "01J…", "started_at": "2026-10-26T08:00:00Z",
      "workdir": "~/.agenticx/sessions/01J…/work", "interactive": false }
  ],
  "interactive_environments": ["01J…"]
}
```

`ma_enabled` = `protocol in ("ma", "dual")`；`workdir` 用 `~` 替换家目录前缀；`ma_environments` 在 `manual` 模式下为 `[{"id": x, "name": x}]`（name 回落为 id）。

- 新增 `POST /api/enterprise-worker/interactive-environments`，体 `{"environment_id": "<1..64 字符>"}`：
  - 未登录企业（`_login_settings()` 为 None）→ 409 `detail="enterprise_login_required"`。
  - 否则 `worker.add_interactive_environment(env_id)`，返回 `{"ok": true, "environment_id": env_id, "expires_in": 1800}`。
  - `app.state.enterprise_worker` 不存在 → 503 `detail="enterprise_worker_unavailable"`。

---

## 5. 精确落点

文件头、英文注释 / docstring、绝对 import、import 置顶（仓库规则）；TS 同目录现有风格。

### 5.1 admin-console：`src/app/api/internal/ma/worker-eligibility/route.ts`（新建）

```ts
import { NextResponse } from "next/server";
import { getAdminUser, listMaEnvironments, resolveAssignmentKeysForUser } from "@agenticx/iam-core";

import { maError, maErrorFromException } from "../../../../../lib/ma/errors";
import { TENANT_ID_RE, ULID_RE } from "../../../../../lib/ma/http";
import { isMaInternalAuthorized, maInternalUnauthorized } from "../../../../../lib/ma/internal-auth";
import { toMaEnvironmentRecord } from "../../../../../lib/ma/records";

export const dynamic = "force-dynamic";

function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(request: Request) {
  if (!isMaInternalAuthorized(request)) return noStore(maInternalUnauthorized());
  try {
    const url = new URL(request.url);
    const tenantId = (url.searchParams.get("tenant_id") ?? "").trim();
    const userId = (url.searchParams.get("user_id") ?? "").trim();
    if (!TENANT_ID_RE.test(tenantId)) return noStore(maError("invalid_request", "tenant_id is required"));
    if (!ULID_RE.test(userId)) return noStore(maError("invalid_request", "user_id is required"));
    const user = await getAdminUser(tenantId, userId);
    if (!user || user.status === "disabled") {
      return noStore(NextResponse.json({ user_id: userId, assignment_keys: [], environments: [] }));
    }
    const keys = await resolveAssignmentKeysForUser(tenantId, user.id, user.email, user.deptId ?? null);
    const wanted = new Set(keys.map((k) => k.trim()).filter(Boolean));
    const envs = await listMaEnvironments(tenantId, { type: "desktop_worker", status: "active" });
    const eligible = envs.filter((env) => {
      const workerKeys = env.config.type === "desktop_worker" ? env.config.worker_keys : [];
      return workerKeys.some((k) => wanted.has(String(k).trim()));
    });
    return noStore(
      NextResponse.json({
        user_id: userId,
        assignment_keys: [...wanted],
        environments: eligible.map(toMaEnvironmentRecord),
      }),
    );
  } catch (error) {
    return noStore(maErrorFromException(error));
  }
}
```

字段名以实际导出为准（`AdminUserDto` 的 `deptId` / `status`、`MaEnvironment.config` 的判别字段）：实施前读 `enterprise/packages/iam-core/src/repos/users.ts:266` 与 `ma-environments.ts` 的类型定义。若 `getAdminUser` 未从包根导出，从 `@agenticx/iam-core` 的现有导出名中选同语义函数（`web-portal/src/lib/desktop-auth.ts:1` 已从包根导入 `getAdminUser`，应可用）。

### 5.2 agent-runtime

#### 5.2.1 `config.py`

`Settings` 追加（放在 `allow_sqlite` 之后）：

```python
    desktop_pat_enabled: bool = False
    eligibility_cache_seconds: float = 30.0
```

`from_env`：`desktop_pat_enabled = environ.get("MA_RUNTIME_DESKTOP_PAT_ENABLED", "0") == "1"`；`eligibility_cache_seconds` 解析为浮点并夹在 0–300，非法回退 30。

#### 5.2.2 `control_plane.py`

追加常量与方法（不改已有方法的其它行为）：

```python
DESKTOP_PAT_SCOPE = "desktop:managed"
DESKTOP_IMPLIED_MA_SCOPES = frozenset({"ma:sessions:read", "ma:sessions:write", "ma:worker"})


class AdminConsoleClient:
    async def get_worker_eligibility(self, tenant_id: str, user_id: str) -> dict[str, Any]:
        """GET /api/internal/ma/worker-eligibility; same error mapping as get_environment (401 -> INTERNAL, network/5xx -> INTERNAL)."""
```

`PatIntrospectionAuthenticator.__init__` 追加关键字参数 `desktop_pat_enabled: bool = False`。在 `cached = Principal(...)` 构造处改为：

```python
scopes = frozenset(str(s) for s in body.get("scopes") or [])
if self._desktop_pat_enabled and DESKTOP_PAT_SCOPE in scopes:
    scopes = scopes | DESKTOP_IMPLIED_MA_SCOPES
cached = Principal(tenant_id=..., user_id=..., scopes=scopes)
```

Before：设备 PAT 访问任何 `/ma/v1/*` 会话面 → 403 `forbidden_scope`。After：开关开启时可访问，但受 §5.2.4 中间件约束；开关关闭行为不变。

#### 5.2.3 `pg_work_queue.py`

模块级追加（放在 import 区之后）：

```python
@dataclass(frozen=True)
class ClaimScope:
    user_id: str
    allowed_agent_ids: frozenset[str] | None = None   # None = no agent filter (non-poll routes)

current_claim_scope: contextvars.ContextVar[ClaimScope | None] = contextvars.ContextVar("ma_claim_scope", default=None)
CLAIM_CANDIDATE_LIMIT = 50
```

`PgWorkQueue` 追加 / 修改：

```python
    def queued_agent_ids(self, tenant_id: str, environment_id: str) -> set[str]:
        """SELECT DISTINCT s.agent_id FROM ma_work_items w JOIN ma_sessions s ON s.id = w.session_id
        WHERE w.tenant_id=:t AND w.environment_id=:e AND w.status='queued'."""
```

`claim_next(tenant, env, device_id)` 改为：

```text
scope = current_claim_scope.get()
if scope is None:
    <original behaviour unchanged>
else:
    rows = SELECT w.id, s.agent_id, s.source, s.created_by_user_id
           FROM ma_work_items w JOIN ma_sessions s ON s.id = w.session_id
           WHERE w.tenant_id=:t AND w.environment_id=:e AND w.status='queued'
           ORDER BY w.created_at, w.id LIMIT CLAIM_CANDIDATE_LIMIT
           FOR UPDATE OF w SKIP LOCKED        (sqlite: plain select)
    pick first row where:
        (scope.allowed_agent_ids is None or row.agent_id in scope.allowed_agent_ids)
        and (row.source != "desktop" or row.created_by_user_id == scope.user_id)
    none -> return None
    UPDATE ... (same columns as original) + claimed_by_user_id = scope.user_id WHERE id=:id AND status='queued'
    rowcount != 1 -> return None
```

`require_lease(tenant, work_id, device_id, statuses)`：原有判定之后追加：

```python
scope = current_claim_scope.get()
if scope is not None and (row.claimed_by_user_id or "") != scope.user_id:
    raise MAError(WORK_LEASE_LOST, "work lease lost", details={"work_id": work_id})
```

（`WorkItemRow` 若无 `claimed_by_user_id` 字段：在 PgWorkQueue 内部读行时额外取该列做比较，**不改 A05 的 `WorkItemRow` dataclass**。）

`scope is None` 时所有方法行为与 E03 原实现逐字节一致（E03 现有契约测试必须保持全绿）。

#### 5.2.4 `desktop_access.py`（新建）

```python
#!/usr/bin/env python3
"""Authorization for desktop device tokens and desktop workers on the managed runtime.

Author: Damon Li
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from agenticx.managed.errors import (ENVIRONMENT_NOT_FOUND, INVALID_REQUEST, MAError, SESSION_NOT_FOUND)
from agenticx.managed.host.auth import bearer_token
from agenticx.managed.host.config import Principal

from ma_agent_runtime.control_plane import DESKTOP_PAT_SCOPE, AdminConsoleClient, TTLCache
from ma_agent_runtime.pg_work_queue import ClaimScope, PgWorkQueue, current_claim_scope

POLL_RE = re.compile(r"^/ma/v1/environments/(?P<env>[^/]+)/work/poll$")
WORK_RE = re.compile(r"^/ma/v1/work/(?P<work>[^/]+)/(ack|heartbeat|complete|fail)$")
INGEST_RE = re.compile(r"^/ma/v1/sessions/(?P<sid>[^/]+)/events:ingest$")
INBOX_RE = re.compile(r"^/ma/v1/sessions/(?P<sid>[^/]+)/inbox/stream$")
SESSION_RE = re.compile(r"^/ma/v1/sessions/(?P<sid>[^/:]+)(?:/(events|events/stream|archive))?$")
CREATE_SESSION_PATH = "/ma/v1/sessions"
WORK_ENVIRONMENTS_PATH = "/ma/v1/work/environments"
MAX_CREATE_BODY_BYTES = 65536


@dataclass(frozen=True)
class Eligibility:
    assignment_keys: frozenset[str]
    environments: tuple[dict[str, Any], ...]          # EnvironmentRecord wire dicts

    def environment_ids(self) -> frozenset[str]: ...
    def intersects(self, keys: list[str]) -> bool: ...  # any(k.strip() in assignment_keys)


class EligibilityResolver:
    def __init__(self, client: AdminConsoleClient, *, cache_seconds: float,
                 clock: Callable[[], float] = time.monotonic) -> None: ...
    async def resolve(self, tenant_id: str, user_id: str) -> Eligibility: ...   # TTLCache key f"{tenant}|{user}"


def is_desktop_principal(principal: Principal) -> bool:
    return DESKTOP_PAT_SCOPE in principal.scopes and "ma:admin" not in principal.scopes


class DesktopAccessMiddleware:
    """Pure ASGI middleware. Installed by build_app when the worker plane or desktop PATs are enabled."""

    def __init__(self, app: Any, *, state_getter: Callable[[], Any], resolver: EligibilityResolver,
                 work_queue: PgWorkQueue | None, enforce_worker_rules: bool, enforce_desktop_sessions: bool) -> None: ...
    async def __call__(self, scope, receive, send) -> None: ...


def build_work_environments_router(state_getter, resolver) -> APIRouter: ...   # GET /ma/v1/work/environments
```

`state_getter()` 返回 `app.state.ma`（`MAHostState`：`authenticator`、`registry`、`store`，字段名以 A04 实际为准）。

**`__call__` 算法（逐条实现）：**

```text
if scope["type"] != "http": return await app(scope, receive, send)
path, method = scope["path"], scope["method"]
token = bearer_token(header "authorization")
principal = await state.authenticator.authenticate(token) if token else None   # cached, same object A04 will use
if principal is None: return await app(...)                    # A04 answers 401
ctx_token = None
try:
    if enforce_worker_rules and (m := POLL_RE.match(path)) and method == "POST":
        elig = await resolver.resolve(principal.tenant_id, principal.user_id)
        env_id = m["env"]
        if env_id not in elig.environment_ids():
            return await _error(send, MAError(ENVIRONMENT_NOT_FOUND, "environment not found"))
        allowed = set()
        for agent_id in work_queue.queued_agent_ids(principal.tenant_id, env_id):
            agent = await state.registry.get_agent(principal.tenant_id, agent_id)
            if agent is None: continue
            if not agent.worker_keys or elig.intersects(agent.worker_keys):
                allowed.add(agent_id)
        ctx_token = current_claim_scope.set(ClaimScope(principal.user_id, frozenset(allowed)))
    elif enforce_worker_rules and (WORK_RE.match(path) or INGEST_RE.match(path) or INBOX_RE.match(path)):
        ctx_token = current_claim_scope.set(ClaimScope(principal.user_id, None))
    elif enforce_desktop_sessions and is_desktop_principal(principal):
        if path == CREATE_SESSION_PATH and method == "POST":
            body, receive = await _buffer_body(receive, MAX_CREATE_BODY_BYTES)   # replayable receive
            err = await _check_desktop_create(principal, body)                  # see below
            if err is not None: return await _error(send, err)
        elif (m := SESSION_RE.match(path)):
            record = await state.store.get_session(principal.tenant_id, m["sid"])
            if record is not None and record.created_by_user_id != principal.user_id:
                return await _error(send, MAError(SESSION_NOT_FOUND, "session not found"))
    return await app(scope, receive, send)
finally:
    if ctx_token is not None: current_claim_scope.reset(ctx_token)
```

**`_check_desktop_create(principal, body)`**：

```text
data = json.loads(body or b"{}") (not a dict / invalid JSON -> None, let A04 validate and 400)
if data.get("source") != "desktop":
    return MAError(INVALID_REQUEST, 'desktop tokens must create sessions with source "desktop"')
agent_id = str(data.get("agent_id") or "")
agent = await state.registry.get_agent(tenant, agent_id)
if agent is None: return None                                   # A04 answers 404 agent_not_found
elig = await resolver.resolve(tenant, user)
if agent.status != "active" or agent.lifecycle != "published" or not elig.intersects(agent.assignment_keys):
    return MAError(AGENT_NOT_FOUND, "agent not found")
env_id = data.get("environment_id") or agent.default_environment_id or "local"
env = await state.registry.get_environment(tenant, env_id)
if env is not None and env.type == "desktop_worker" and env.id not in elig.environment_ids():
    return MAError(ENVIRONMENT_NOT_FOUND, "environment not found")
return None
```

（`AGENT_NOT_FOUND` 同样从 `agenticx.managed.errors` 导入。）

- `_error(send, err)`：写 `err.http_status`、`content-type: application/json`、body `json.dumps(err.to_dict())`。
- `_buffer_body(receive, limit)`：循环收集 `http.request` 消息直到 `more_body=False`；超出 `limit` → 返回 `(None, replay)` 并让 `_check_desktop_create` 得到 `None`（交给 A04 校验）；返回一个新的 `receive`，第一次调用返回完整 body，之后委托原 `receive`（用于 `http.disconnect`）。
- 注意：A04 路由层的 principal 依赖会再次调用 `authenticator.authenticate`（命中 30 秒缓存，不产生额外内省请求）。
- `contextvars` 在 Starlette 纯 ASGI 中间件 → 端点 / `StreamingResponse` 生成器中可见（与 E03 `OnBehalfOfMiddleware` 相同前提）；`inbox/stream` 的生成器在 `await app(...)` 返回前迭代完毕，所以 `finally: reset` 时机正确。实施时用 FR-B6 验证。

**`build_work_environments_router`**：`GET /ma/v1/work/environments`；从 `Authorization` 取 principal（复用 A04 的 principal 依赖，以实际实现为准；若不可复用，按中间件同样方式认证，失败 401）；`require_scope(principal, "ma:worker")`；`elig = await resolver.resolve(...)`；返回 `{"data": [{"id": e["id"], "name": e["name"]} for e in elig.environments]}`。

#### 5.2.5 `worker_wiring.py` 与 `app.py`

- `wire_worker_plane(app, work_queue, *, resolver)`：在 E03 原有接线**之前**追加 `app.include_router(build_work_environments_router(lambda: app.state.ma, resolver))`（必须在 A05 的 `work/{work_id}/...` 路由之前注册，避免 `environments` 被当成 `work_id` 吃掉——A05 只有 POST `work/{id}/<action>`，GET `/work/environments` 无冲突，但仍按此顺序以防将来变化）。
- `build_app`（E03 §5.10 第 10 步附近）：

```python
resolver = EligibilityResolver(client, cache_seconds=settings.eligibility_cache_seconds)
work_queue = PgWorkQueue(sync_engine) if settings.desktop_worker_enabled else None
if work_queue is not None:
    wire_worker_plane(app, work_queue, resolver=resolver)
if settings.desktop_worker_enabled or settings.desktop_pat_enabled:
    app.add_middleware(DesktopAccessMiddleware, state_getter=lambda: app.state.ma, resolver=resolver,
                       work_queue=work_queue, enforce_worker_rules=settings.desktop_worker_enabled,
                       enforce_desktop_sessions=settings.desktop_pat_enabled)
```

`PatIntrospectionAuthenticator(client, cache_seconds=..., desktop_pat_enabled=settings.desktop_pat_enabled)`。

中间件顺序：Starlette `add_middleware` 后加的在外层；`DesktopAccessMiddleware` 与 `OnBehalfOfMiddleware` 互不依赖，顺序无要求。

### 5.3 桌面后端 `agenticx/runtime/enterprise_worker.py`（在 A05 之上追加）

#### 5.3.1 新 import（放在 A05 新增 import 之后）

```python
from agenticx.managed.gateway_llm import GatewayLLMFactory
from agenticx.runtime.session_boundary import sessions_root
```

并把 A05 的 `from agenticx.managed.llm import LocalConfigLLMFactory` **删除**（本文后不再使用；删除前 `rg -n LocalConfigLLMFactory agenticx/runtime/enterprise_worker.py` 确认只有 `_ma_worker_for` 一处）。

#### 5.3.2 新模块级常量与函数

```python
_WORKER_PROTOCOLS = ("legacy", "ma", "dual")          # replaces A05's ("legacy", "ma")
MA_ENV_DISCOVERY_TTL_S = 300
INTERACTIVE_ENV_TTL_S = 1800
_ENV_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def worker_protocol() -> str:
    """'ma' or 'dual' when enterprise.worker.protocol matches (case-insensitive); otherwise 'legacy'."""


def _ma_environment_mode() -> str:
    """'auto' only when enterprise.worker.ma_environment_mode is exactly 'auto' (case-insensitive); else 'manual'."""


def _ma_gateway_url(default_base: str) -> str:
    """enterprise.worker.gateway_url when non-empty, else f"{default_base.rstrip('/')}/v1"; trailing '/' stripped."""


def _login_settings() -> tuple[str, str] | None:
    """(token, base_url) when enterprise.enabled is True and token/base_url are non-empty; ignores worker.enabled."""
```

`worker_protocol()` 替换 A05 同名函数（A05 FR-15/19 测试仍成立：缺省 / `grpc` → `legacy`）。

#### 5.3.3 `_ma_worker_for(token, base, env_ids)`（替换 A05 实现）

```python
    def _ma_worker_for(self, token: str, base: str, env_ids: list[str]) -> MAWorker:
        gateway = _ma_gateway_url(base)
        key = (token, _ma_base_url(base), gateway, tuple(env_ids))
        if self._ma_worker is None or self._ma_worker_key != key:
            client = MAWorkerClient(_ma_base_url(base), token, http=self._client())
            device_id = self._ensure_device_id()
            runner = _TrackedRunner(
                owner=self,
                client=client,
                device_id=device_id,
                llm_factory=GatewayLLMFactory(base_url=gateway, token=token),
                workdir_root=sessions_root(),
                enterprise_policy_loader=load_enterprise_agent_policy,
            )
            self._ma_worker = MAWorker(client=client, environment_ids=env_ids, device_id=device_id, runner=runner)
            self._ma_worker_key = key
            self._ma_client = client
        return self._ma_worker
```

`_ma_worker_key` 类型注解随之改为 `tuple[str, str, str, tuple[str, ...]] | None`。

Before：Near 内 MA Worker 用本机 provider 配置、工作目录 `~/.agenticx/enterprise_worker/ma_sessions/<sid>/work`。After：经企业网关、`~/.agenticx/sessions/<sid>/work`。

#### 5.3.4 运行中任务追踪

```python
class _TrackedRunner(WorkItemRunner):
    """Records the active MA work item on the owning EnterpriseWorker for status()."""

    def __init__(self, *, owner: "EnterpriseWorker", **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._owner = owner

    async def run(self, assignment: WorkAssignment) -> None:
        self._owner._ma_work_started(assignment)
        try:
            await super().run(assignment)
        finally:
            self._owner._ma_work_finished(assignment.work.id)
```

`WorkAssignment` 从 `agenticx.managed.worker.client` 导入。`EnterpriseWorker.__init__` 追加：`self._ma_work: dict[str, dict[str, Any]] = {}`、`self._ma_client: MAWorkerClient | None = None`、`self._ma_env_cache: tuple[float, list[dict[str, str]]] | None = None`、`self._interactive_envs: dict[str, float] = {}`（env_id → monotonic 到期时间）。

`_ma_work_started(a)`：写入 `{"work_id", "session_id", "agent_id", "agent_version", "environment_id", "started_at": _utc_stamp(), "workdir": "~/.agenticx/sessions/<sid>/work", "interactive": a.work.environment_id in self._interactive_envs}`；`_ma_work_finished(work_id)`：`pop`。

#### 5.3.5 环境集合解析

```python
    async def _ma_environments(self, token: str, base: str) -> list[dict[str, str]]:
        if _ma_environment_mode() != "auto":
            return [{"id": e, "name": e} for e in _ma_environment_ids()]
        now = time.monotonic()
        if self._ma_env_cache is not None and now - self._ma_env_cache[0] < MA_ENV_DISCOVERY_TTL_S:
            return self._ma_env_cache[1]
        client = self._ma_client or MAWorkerClient(_ma_base_url(base), token, http=self._client())
        envs = await client.list_eligible_environments()          # may raise WorkerAuthError / MAWorkerError
        self._ma_env_cache = (now, envs)
        return envs
```

`MAWorkerError`（非鉴权）时：保留旧缓存（若有）并把 `self._last_error = "托管环境列表获取失败"`，返回旧缓存或 `[]`。

#### 5.3.6 `run_once` / `run_forever` 分发（替换 A05 插入的两行；其余行不动）

`run_forever`（:278–304）中 `if not worker_enabled():` 改为：

```python
                    if not worker_enabled() and not self._interactive_active():
```

`run_once`（:306–340）开头改为：

```python
        handled_interactive = await self._run_once_interactive()
        if handled_interactive:
            return True
        settings = _enterprise_settings()
        if settings is None:
            return False
        token, base = settings
        proto = worker_protocol()
        if proto == "ma":
            return await self._run_once_ma(token, base)
        if proto == "dual" and await self._run_once_ma(token, base):
            return True
        # ... original legacy body continues unchanged (heartbeat_due computation onward)
```

新增方法：

```python
    def _interactive_active(self) -> bool:
        now = time.monotonic()
        self._interactive_envs = {k: v for k, v in self._interactive_envs.items() if v > now}
        return bool(self._interactive_envs)

    def add_interactive_environment(self, environment_id: str) -> None:
        if not _ENV_ID_RE.match(environment_id):
            raise ValueError("invalid environment id")
        self._interactive_envs[environment_id] = time.monotonic() + INTERACTIVE_ENV_TTL_S

    async def _run_once_interactive(self) -> bool:
        if not self._interactive_active():
            return False
        settings = _login_settings()
        if settings is None or time.monotonic() < self._claim_pause_until:
            return False
        token, base = settings
        worker = self._ma_worker_for(token, base, sorted(self._interactive_envs))
        try:
            return await worker.run_once(max_wait_seconds=0)
        except WorkerAuthError:
            self._pause_for_auth()
            return False
```

`_run_once_ma`（A05）中 `env_ids = _ma_environment_ids()` 改为：

```python
        envs = await self._ma_environments(token, base)
        env_ids = [e["id"] for e in envs]
        if not env_ids:
            if _ma_environment_mode() == "manual":
                self._last_error = MA_ENV_MISSING
            return False
```

（交互式与常规共用 `_ma_worker_for` 的单实例缓存：环境集合变化即重建 `MAWorker`；同一时刻只跑一个 Work Item，与 legacy「一次一个任务」一致。）

#### 5.3.7 `status()` 追加键

```python
            "protocol": worker_protocol(),
            "ma_enabled": worker_protocol() in ("ma", "dual"),
            "ma_environment_mode": _ma_environment_mode(),
            "ma_environments": list(self._ma_env_cache[1]) if self._ma_env_cache else
                               [{"id": e, "name": e} for e in _ma_environment_ids()],
            "ma_work": [dict(v) for v in self._ma_work.values()],
            "interactive_environments": sorted(k for k, v in self._interactive_envs.items() if v > time.monotonic()),
```

原有键与取值不变。

### 5.4 `agenticx/managed/worker/client.py`（A05，只追加）

```python
    async def list_eligible_environments(self) -> list[dict[str, str]]:
        """GET /ma/v1/work/environments -> [{"id", "name"}]; error mapping identical to other methods."""
```

解析：`body["data"]` 必须是列表，元素取 `str(id)`、`str(name or id)`，过滤空 id；结构不符 → `MAWorkerError(200, "invalid_response", "invalid environments response")`。

### 5.5 `agenticx/studio/enterprise_worker_routes.py`

```python
class EnterpriseWorkerToggle(BaseModel):
    enabled: Optional[bool] = None
    ma_enabled: Optional[bool] = None


class InteractiveEnvironmentRequest(BaseModel):
    environment_id: str = Field(min_length=1, max_length=64)
```

`put_enterprise_worker`：两键都为 None → `HTTPException(400, "enabled or ma_enabled is required")`；按 §4.5 写配置；其余不变。新增 `POST /api/enterprise-worker/interactive-environments`（`check_token` 同其它路由），按 §4.5 处理；`ValueError` → 400 `detail="invalid environment id"`。从 `agenticx.runtime.enterprise_worker` 追加导入 `_login_settings`（若不愿导入私有名，在 `enterprise_worker.py` 加公开别名 `enterprise_login_settings = _login_settings` 并导入它——二选一，推荐别名）。

### 5.6 Desktop

#### 5.6.1 `desktop/src/settings-tab.ts`

`SETTINGS_TAB_IDS` 中 `"account",` 之后插入 `"enterprise_worker",`。

#### 5.6.2 `desktop/src/components/SettingsPanel.tsx`

1. `TAB_DEFS`（:1092）`{ id: "account", icon: User },` 之后插入 `{ id: "enterprise_worker", icon: Laptop },`（`Laptop` 从 `lucide-react` 导入，加入该文件已有的 lucide import 列表）。
2. 组件内新增状态 `const [enterpriseLoggedIn, setEnterpriseLoggedIn] = useState(false);` 与 effect：挂载时 `window.agenticxDesktop.loadEnterpriseAccount()` → `setEnterpriseLoggedIn(Boolean(r.ok && r.loggedIn))`；订阅 `onEnterpriseAccountChanged(p => setEnterpriseLoggedIn(Boolean(p.loggedIn)))`，卸载时取消。
3. `tabs` 的 `useMemo`（:5022）改为先 `TAB_DEFS.filter((def) => def.id !== "enterprise_worker" || enterpriseLoggedIn)` 再 map；依赖数组加 `enterpriseLoggedIn`。
4. 若当前 `tab === "enterprise_worker"` 且 `!enterpriseLoggedIn`：effect 内 `setTab("account")`。
5. 渲染：`{tab === "account" && <AccountTab />}`（:7220）之后插入 `{tab === "enterprise_worker" && <EnterpriseWorkerPanel />}`。

#### 5.6.3 `enterprise-worker-status.ts`（新建，纯函数）

```ts
export type EnterpriseWorkerStatus = {
  enabled: boolean;
  running: boolean;
  maEnabled: boolean;
  environments: Array<{ id: string; name: string }>;
  work: Array<{ workId: string; sessionId: string; agentId: string; agentVersion: number;
                environmentId: string; startedAt: string; workdir: string; interactive: boolean }>;
  lastHeartbeatAt: string;
  lastError: string;
  legacyAgents: string[];          // from status.agents displayName/slug/id
};

/** Defensive parse of GET /api/enterprise-worker/status; unknown / missing fields fall back to empty values. */
export function parseEnterpriseWorkerStatus(raw: unknown): EnterpriseWorkerStatus;
/** "运行中" | "已暂停" | "未运行" decided from enabled/running. */
export function workerStateLabelKey(s: Pick<EnterpriseWorkerStatus, "enabled" | "running">): "running" | "paused" | "stopped";
```

`workerStateLabelKey`：`!enabled` → `paused`；`enabled && running` → `running`；否则 `stopped`。

#### 5.6.4 `EnterpriseWorkerPanel.tsx`（新建）

结构（全部中文经 i18n，命名空间 `settings`，键见 §5.6.6）：

1. 标题区：`enterpriseWorker.title`「企业 Worker」+ 说明 `enterpriseWorker.intro`。
2. 卡片 A「接单」：左侧文案 `enterpriseWorker.acceptTitle`「让这台电脑承接企业智能体任务」+ 状态 `enterpriseWorker.state.<key>`；右侧 `SettingsSwitch checked={status.enabled}`。切换即 `PUT /api/enterprise-worker {enabled}`；**乐观 UI**：先改本地状态，失败回滚并在卡片内显示 `enterpriseWorker.saveFailed`（带 HTTP 状态码）。这个开关就是「暂停 / 恢复」（关闭显示「已暂停接单，进行中的任务会继续跑完」）。
3. 卡片 B「托管智能体任务」：`SettingsSwitch checked={status.maEnabled}`，`PUT {ma_enabled}`，乐观 UI 同上；说明 `enterpriseWorker.maHint`「开启后按企业新协议领取任务：模型经企业网关调用，每个任务使用独立工作目录」。
4. 卡片 C「所属环境」：列 `environments`（名称），空时 `enterpriseWorker.noEnvironments`「暂无可承接的执行环境，请联系管理员把你加入环境的执行名单」；`maEnabled=false` 时整卡显示 `enterpriseWorker.maOff`。
5. 卡片 D「运行中的任务」：表格列：智能体（`agentId` 前 8 位 + `v{agentVersion}`）、开始时间（本地时间格式化）、来源（`interactive ? 本机对话 : 企业分派`）、工作目录（等宽字体，`title` 显示完整路径）。空时 `enterpriseWorker.noWork`。
6. 状态行：最近心跳、最近错误（`text-amber-500`，与 AccountTab 现状一致）；旧协议可承接智能体名单（`legacyAgents`）放在折叠的「旧版任务」小节里（默认折叠）。
7. 轮询：可见时每 5 秒 `GET /api/enterprise-worker/status`；用 `useRef` 世代号防止开关保存期间被旧轮询覆盖（照抄 AccountTab `workerSaveGen` 写法 :107、:308–324、:336–384）。
8. 请求统一走 `studioFetch(path, { apiToken })`（`desktop/src/utils/studio-fetch.ts`），`apiToken` 来自 `useAppStore((s) => s.apiToken)`。
9. 主题 token：卡片 `rounded-lg border border-border bg-surface-card`；不得硬编码颜色；无「保存」按钮（开关即时生效）。

#### 5.6.5 `AccountTab.tsx`

删除：Worker 相关 state（:100–107）、状态轮询 effect（:257–334）、`onWorkerToggle`（:336–384）、`WorkerStatus` 类型与 `formatHeartbeat`（:15–28，若无其它引用）、企业已登录分支中的 Worker 卡片（:477–510）。在企业账号卡片之后插入一行：

```tsx
<button type="button" className="mt-3 text-xs text-text-subtle underline-offset-2 hover:underline"
        onClick={() => useAppStore.getState().openSettings("enterprise_worker")}>
  {t("account.manageWorker")}
</button>
```

`openSettings` 签名为 `(tab?: SettingsTab, focus?: SettingsFocus) => void`（`desktop/src/store.ts:1059`）。AccountTab 本身就在设置面板内，调用后面板切到新 tab。

#### 5.6.6 文案（`desktop/locales/zh/settings.json` 与 `en/settings.json` 同步新增；下表为中文）

| 键 | 中文 |
|---|---|
| `tabs.enterprise_worker` | 企业 Worker |
| `account.manageWorker` | 在「企业 Worker」中管理本机承接任务 |
| `enterpriseWorker.title` | 企业 Worker |
| `enterpriseWorker.intro` | 让这台电脑为企业执行智能体任务。任务在本机运行，模型调用经企业网关。 |
| `enterpriseWorker.acceptTitle` | 让这台电脑承接企业智能体任务 |
| `enterpriseWorker.state.running` | 运行中 |
| `enterpriseWorker.state.paused` | 已暂停接单，进行中的任务会继续跑完 |
| `enterpriseWorker.state.stopped` | 未运行 |
| `enterpriseWorker.maTitle` | 承接托管智能体任务 |
| `enterpriseWorker.maHint` | 开启后按企业新协议领取任务：模型经企业网关调用，每个任务使用独立工作目录 |
| `enterpriseWorker.environments` | 所属环境 |
| `enterpriseWorker.noEnvironments` | 暂无可承接的执行环境，请联系管理员把你加入环境的执行名单 |
| `enterpriseWorker.maOff` | 开启「承接托管智能体任务」后显示 |
| `enterpriseWorker.work` | 运行中的任务 |
| `enterpriseWorker.noWork` | 当前没有运行中的任务 |
| `enterpriseWorker.col.agent` / `col.startedAt` / `col.source` / `col.workdir` | 智能体 / 开始时间 / 来源 / 工作目录 |
| `enterpriseWorker.source.interactive` / `source.dispatched` | 本机对话 / 企业分派 |
| `enterpriseWorker.lastHeartbeat` | 最近心跳 |
| `enterpriseWorker.lastError` | 最近错误 |
| `enterpriseWorker.legacy` | 旧版任务 |
| `enterpriseWorker.legacyAgents` | 可承接智能体 |
| `enterpriseWorker.none` | 暂无 |
| `enterpriseWorker.saveFailed` | 保存失败（{{status}}） |

英文按语义翻译（`Enterprise Worker` 等）。

---

## 6. Before / After

| 场景 | Before | After |
|---|---|---|
| 设备 PAT 调 agent-runtime 会话面 | 403 `forbidden_scope` | `MA_RUNTIME_DESKTOP_PAT_ENABLED=1` 时可用，仅限本人会话 |
| Worker 领取 | 任一 `ma:worker` token 领任一 `desktop_worker` 环境 | 环境 + Agent `worker_keys` 命中、桌面会话只归创建者 |
| 租约后续调用 | 只比 `device_id` | 另比 `claimed_by_user_id` |
| Near MA Worker 模型 | 本机 provider（A05） | 企业网关 + 设备 PAT |
| Near MA 工作目录 | `~/.agenticx/enterprise_worker/ma_sessions/<sid>/work`（A05） | `~/.agenticx/sessions/<sid>/work`，跨会话拒绝生效 |
| 协议 | `legacy` \| `ma` | 增加 `dual`（面板开关写入） |
| 设置页 | Worker 卡片在「账号」tab | 独立「企业 Worker」tab；账号 tab 一行跳转 |
| 未登录企业 | 无 Worker | 不变：tab 隐藏，`run_forever` 空转同前 |

---

## 7. FR / NFR / AC

agent-runtime 测试约定沿用 E03 §7（`conftest.py` 的 sqlite 参数化存储、`FakeAdminConsole`、`build_app(... admin_transport=...)`）。`FakeAdminConsole` 追加：`worker_eligibility: dict[(tenant, user), dict]`，处理 `GET /api/internal/ma/worker-eligibility`，未配置的组合返回 `{"user_id":u,"assignment_keys":[],"environments":[]}`；PAT 表里加 `agx-pat-dev-a`（user `UA`，scopes `["workspace:chat","desktop:managed"]`）与 `agx-pat-dev-b`（user `UB`，同 scopes）。

| ID | 需求 | AC（文件 :: 用例 → 断言） |
|---|---|---|
| FR-A1 | 内部 eligibility 路由 | `admin-console/.../__tests__/worker-eligibility-route.test.ts`（vi.mock `@agenticx/iam-core`，参照同目录 `internal-routes.test.ts` 的 mock 写法）：`returns 401 without internal token`；`rejects bad tenant_id`（400 `invalid_request`）；`rejects non-ULID user_id`；`returns empty for disabled user`（`getAdminUser` → `{status:"disabled"}` → `assignment_keys` 与 `environments` 均 `[]`，`resolveAssignmentKeysForUser` 未调用）；`filters environments by worker_keys intersection`（keys `["all","U1","dept:D1"]`；环境 E1 `worker_keys:["dept:D1"]`、E2 `["dept:D2"]`、E3 `[]` → 只返回 E1，且为 6 键记录）；`queries only active desktop_worker environments`（断言 `listMaEnvironments` 第二参 `{type:"desktop_worker",status:"active"}`）；`sets cache-control no-store` |
| FR-B1 | 设备 PAT scope 映射与开关 | `agent-runtime/tests/test_desktop_access.py::test_desktop_pat_mapping_respects_flag`：`desktop_pat_enabled=False` → `authenticate("agx-pat-dev-a").scopes == {"workspace:chat","desktop:managed"}`；`True` → 额外含 `ma:sessions:read`、`ma:sessions:write`、`ma:worker`，且**不含** `ma:admin`、`ma:sessions:on_behalf` |
| FR-B2 | 桌面主体建会话校验 | `test_desktop_access.py::test_desktop_create_session_rules`（`desktop_pat_enabled=True` 的 app，ASGITransport）：agent A（published、active、`assignment_keys:["dept:D1"]`、cloud）；UA eligibility keys 含 `dept:D1`：`source:"desktop"` → 201 且 `created_by_user_id == UA`；`source:"api"` → 400 `invalid_request`；UB（keys 无 D1）→ 404 `agent_not_found`；A 改为 `lifecycle:"draft"` → UA 404；`environment_id` 指向 UA 不可承接的 desktop_worker 环境 → 404 `environment_not_found` |
| FR-B3 | 桌面主体只能访问自己的会话 | `test_desktop_access.py::test_desktop_session_isolation`：UA 建会话 S；UB 的 PAT `GET /ma/v1/sessions/S` → 404 `session_not_found`；`GET .../events` → 404；`POST .../events` → 404；`GET .../events/stream` → 404；UA 本人 → 200。服务 PAT（无 `desktop:managed`）访问 S → 不受此限制（200） |
| FR-B4 | 领取：环境授权 | `test_desktop_access.py::test_poll_requires_eligible_environment`（`desktop_worker_enabled=True`）：环境 W1（UA 可承接）、W2（不可）；UA poll W2 → 404 `environment_not_found`；UA poll W1（无任务、`max_wait_seconds=0`）→ 200 `{"work": null}`；`GET /ma/v1/work/environments`（UA）→ `data == [{"id":"W1","name":...}]` |
| FR-B5 | 领取：Agent worker_keys 与桌面会话归属 | `test_desktop_access.py::test_claim_filters_agent_and_desktop_owner`：W1 上排队 3 个会话：S1（agent X，`worker_keys:["dept:D9"]`，UA 不命中，source api）、S2（agent Y，`worker_keys:[]`，source desktop，创建者 UB）、S3（agent Y，source api）；UA poll → 领到 S3 的工作项；`ma_work_items.claimed_by_user_id == UA`（直接查表） |
| FR-B6 | 租约用户校验 | `test_desktop_access.py::test_lease_bound_to_user`：UA 领到工作项 w（device `dev-aaaaaaaa`）；UB 用同一 `device_id` 调 `work/w/ack` → 409 `work_lease_lost`；UB 调 `sessions/<sid>/events:ingest`（work_id=w）→ 409；UA 调 ack → 200；UA 打开 `inbox/stream` 能收到客户端事件（证明 contextvar 在流式响应中可见） |
| FR-B7 | 关闭开关回到 E03 行为 | `test_desktop_access.py::test_flags_off_keeps_e03_behaviour`：两开关都为 False：设备 PAT 建会话 → 403 `forbidden_scope`；`/ma/v1/environments/<id>/work/poll` → 404（路由不存在）；E03 全部既有测试 `python -m pytest -o addopts="" -o asyncio_mode=auto enterprise/apps/agent-runtime/tests -q` 全绿 |
| FR-B8 | 缓存 | `test_desktop_access.py::test_eligibility_cache_ttl`：可控 clock，30 秒内同一用户两次 poll 只产生 1 次 eligibility 请求；+31 秒后第 2 次 |
| FR-C1 | 协议取值 | `tests/test_enterprise_worker_d01.py::test_worker_protocol_values`：缺省 → `legacy`；`MA` → `ma`；`Dual` → `dual`；`grpc` → `legacy`（`ConfigManager.set_value`，辅助函数照抄 `tests/test_enterprise_worker.py:31-42`） |
| FR-C2 | dual 分发 | `test_enterprise_worker_d01.py::test_dual_runs_ma_then_legacy`：`protocol: dual`、`ma_environment_ids:["W1"]`；`monkeypatch.setattr(MAWorker, "run_once", fake_returns_False)`；`httpx.MockTransport` 记录请求 → `run_once()` 先调用 fake 一次（`max_wait_seconds == 0`），随后仍请求 `/api/desktop/worker/heartbeat` 与 `/tasks/claim`；fake 返回 True 时不再发 legacy 请求 |
| FR-C3 | 网关 LLM 工厂与工作目录 | `test_enterprise_worker_d01.py::test_ma_worker_uses_gateway_and_session_root`：`HOME` 指向 tmp；`enterprise.base_url: https://portal.example`、token `agx-pat-x`；调用 `worker._ma_worker_for("agx-pat-x", "https://portal.example", ["W1"])`；断言 runner 的 `llm_factory` 是 `GatewayLLMFactory` 且 `base_url == "https://portal.example/v1"`、`repr` 不含 token；`workdir_root == sessions_root()`；再设 `enterprise.worker.gateway_url: http://127.0.0.1:8088/v1/` → 新 worker 的 `base_url == "http://127.0.0.1:8088/v1"`（缓存键变化导致重建） |
| FR-C4 | 环境自动发现 | `test_enterprise_worker_d01.py::test_auto_environment_discovery_cached`：`ma_environment_mode: auto`；`MAWorkerClient.list_eligible_environments` 替身返回 `[{"id":"W1","name":"研发"}]` 并计数；连续两次 `_run_once_ma` → 替身只调用 1 次；`status()["ma_environments"] == [{"id":"W1","name":"研发"}]`；替身返回 `[]` 时 `last_error` **不**被设为 `MA_ENV_MISSING` |
| FR-C5 | manual 保持 A05 语义 | A05 `tests/test_enterprise_worker_ma_protocol.py` 全部用例不改一行仍全绿（特别是 `test_ma_protocol_without_environments`） |
| FR-C6 | 交互式环境 | `test_enterprise_worker_d01.py::test_interactive_environment_runs_without_worker_switch`：`enterprise.enabled: true`、token、base_url，**不**设 `worker.enabled`；`add_interactive_environment("W9")`；fake `MAWorker.run_once` 记录构造时的 `environment_ids` → `run_once()` 返回 fake 的结果且 `environment_ids == ["W9"]`；无任何 `/api/desktop/worker/*` 请求；`_interactive_active()` 在 clock 前进 1801 秒后为 False；`add_interactive_environment("bad/id")` → `ValueError` |
| FR-C7 | 运行中任务追踪 | `test_enterprise_worker_d01.py::test_tracked_runner_reports_work`：构造 `_TrackedRunner`，把 `WorkItemRunner.run` 替身为 `await asyncio.sleep(0.2)`；运行期间 `status()["ma_work"]` 含该 work_id、`workdir` 以 `~/.agenticx/sessions/` 开头；完成后为空 |
| FR-C8 | status 追加键不破坏旧键 | `test_enterprise_worker_d01.py::test_status_keeps_legacy_keys`：`status()` 同时包含 `enabled, running, device_id, agents, last_heartbeat_at, current_task_id, last_error` 与新增 6 键 |
| FR-C9 | 客户端发现方法 | `tests/managed/test_worker_sdk.py::test_list_eligible_environments`（追加用例，`httpx.MockTransport`）：200 `{"data":[{"id":"W1","name":"x"},{"id":""}]}` → `[{"id":"W1","name":"x"}]`；401 → `WorkerAuthError`；`{"data": 3}` → `MAWorkerError` code `invalid_response` |
| FR-D1 | Studio 路由 | `tests/test_enterprise_worker_routes_d01.py`（参照 `tests/test_enterprise_worker_routes.py` 的 app 构造）：`test_put_ma_enabled_writes_dual_and_auto`（`ma_enabled:true` → 配置 `protocol == "dual"`、`ma_environment_mode == "auto"`；`false` → `legacy`）；`test_put_requires_a_field`（`{}` → 400）；`test_put_enabled_unchanged_behaviour`（`{"enabled":true}` → `enterprise.worker.enabled is True`，与现状一致）；`test_interactive_requires_login`（未登录 → 409 `enterprise_login_required`）；`test_interactive_registers_env`（已登录、`app.state.enterprise_worker` 为真实 `EnterpriseWorker` → 200，`status()["interactive_environments"] == ["W9"]`）；`test_status_includes_ma_keys` |
| FR-E1 | 状态解析 | `desktop/src/components/settings/enterprise/enterprise-worker-status.test.ts`：`parses full payload`（§4.5 示例 → 字段一一对应、`agentVersion` 为 number）；`tolerates missing ma keys`（只给旧键 → `maEnabled=false`、`environments=[]`、`work=[]`）；`workerStateLabelKey`（三种组合） |
| FR-E2 | 面板交互 | `EnterpriseWorkerPanel.test.tsx`（vitest + Testing Library，mock `studioFetch`）：`renders environments and running work`；`toggle accept switch is optimistic and rolls back on failure`（PUT 返回 500 → 开关回到原值，出现「保存失败（500）」）；`toggle ma switch sends ma_enabled`（断言 PUT body `{"ma_enabled":true}`）；`uses SettingsSwitch`（`getAllByRole("switch")` 长度 2） |
| FR-E3 | tab 可注册 | 现有 `desktop/src/settings-tab.test.ts::only lists tabs that the settings panel can open` 会断言 `SettingsPanel.tsx` 含 `{ id: "enterprise_worker",`（§5.6.2 第 1 步满足）；在同文件追加 `it("knows the enterprise worker tab")`：`isSettingsTab("enterprise_worker") === true` |
| FR-E4 | 文案对齐 | `desktop/src/i18n/message-parity.test.ts` 全绿（中英键一致） |
| NFR-1 | 既有测试不回归 | `pytest tests/test_enterprise_worker.py tests/test_enterprise_worker_routes.py tests/test_enterprise_worker_ma_protocol.py tests/managed -q --no-cov` 全绿 |
| NFR-2 | `agx serve` 冷启动 smoke | §8 smoke：进程不崩溃，`/api/session`、`/api/avatars`、`/api/sessions` 均 200 |
| NFR-3 | `server.py` 零改动 | `git diff --quiet -- agenticx/studio/server.py` |
| NFR-4 | 不泄露凭证 | FR-C3 `repr` 断言；`rg -n "logger\.(info|warning|error|exception).*token" agenticx/runtime/enterprise_worker.py enterprise/apps/agent-runtime/ma_agent_runtime/desktop_access.py` 无把 token 变量写进日志 |
| NFR-5 | Desktop 类型与构建 | `npm -C desktop run build` 通过（含 `tsc -p electron/tsconfig.json`） |

---

## 8. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
# admin-console
pnpm -C enterprise --filter @agenticx/app-admin-console test -- src/app/api/internal/ma
pnpm -C enterprise --filter @agenticx/app-admin-console typecheck
# agent-runtime
python -m pytest -o addopts="" -o asyncio_mode=auto enterprise/apps/agent-runtime/tests -q
# framework / desktop backend
pytest tests/test_enterprise_worker.py tests/test_enterprise_worker_routes.py \
  tests/test_enterprise_worker_ma_protocol.py tests/test_enterprise_worker_d01.py \
  tests/test_enterprise_worker_routes_d01.py tests/managed -q --no-cov
python -c "import agenticx.studio.server; import agenticx.runtime.enterprise_worker; print('imports ok')"
git diff --quiet -- agenticx/studio/server.py && echo "server.py untouched"
# desktop
npm -C desktop test -- src/components/settings/enterprise src/settings-tab.test.ts src/i18n/message-parity.test.ts
npm -C desktop run build
```

**`agx serve` 冷启动 smoke（`server.py:74` 顶层导入 `enterprise_worker`，强制）：**

```bash
PORT=18765; TOKEN=smoke-$(date +%s)
agx serve --host 127.0.0.1 --port $PORT --token $TOKEN > /tmp/agx-serve-smoke.log 2>&1 &
PID=$!; sleep 12
for p in /api/session /api/avatars /api/sessions /api/enterprise-worker/status; do
  curl --noproxy '*' -s -o /dev/null -w "$p %{http_code}\n" -H "x-agx-desktop-token: $TOKEN" "http://127.0.0.1:$PORT$p"
done
kill $PID
```

期望四行均为 200（`/api/session` 若需 query 参数按 `server.py` 现有约定补齐）。

**Desktop 重启要求**：本文不改 `desktop/electron/**`；但 Python 后端变更需完全退出 Near（⌘Q）或重启 `npm run dev` 让内置 `agx serve` 重新加载。

**W3 门演示（本文负责的部分；需 E01/E02/E03/A04/A05 已合入，PG 已起）：**

```bash
cd /Users/damon/myWork/AgenticX/enterprise
MA_RUNTIME_DESKTOP_WORKER_ENABLED=1 MA_RUNTIME_DESKTOP_PAT_ENABLED=1 \
  bash scripts/start-dev-with-infra.sh --with-agent-runtime --ui=stream
# 1) admin-console /admin 执行环境：新建 desktop_worker 环境「研发桌面」，执行名单选自己；
#    某 Agent 运行方式改为员工桌面执行、默认环境选「研发桌面」，发布。
# 2) Near：设置 → 账号 登录企业（门户 http://localhost:3000）；
#    ~/.agenticx/config.yaml 追加 enterprise.worker.ma_base_url: http://127.0.0.1:8092
#    与 enterprise.worker.gateway_url: http://127.0.0.1:8088/v1；⌘Q 重启 Near。
# 3) 设置 → 企业 Worker：打开两个开关，「所属环境」出现「研发桌面」。
# 4) 用门户服务 PAT 代表另一位用户建会话并发消息（模拟门户发起，见 §12 Q3）：
SVC=$(cat .local-secrets/ma_portal_service.pat)
SID=$(curl --noproxy '*' -s -X POST http://127.0.0.1:8092/ma/v1/sessions -H "Authorization: Bearer $SVC" \
  -H "X-AgenticX-On-Behalf-Of: <你的用户 ULID>" -H 'content-type: application/json' \
  -d '{"agent_id":"<agent id>","source":"api"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl --noproxy '*' -s -X POST http://127.0.0.1:8092/ma/v1/sessions/$SID/events -H "Authorization: Bearer $SVC" \
  -H 'content-type: application/json' -d '{"events":[{"type":"user.message","content":[{"type":"text","text":"在工作目录写 hello.txt"}]}]}'
curl --noproxy '*' -N -s http://127.0.0.1:8092/ma/v1/sessions/$SID/events/stream -H "Authorization: Bearer $SVC"
# 期望：Near 面板「运行中的任务」出现该会话；流里看到 tool_use / message / status_idle(end_turn)；
#      ~/.agenticx/sessions/$SID/work/hello.txt 存在；网关审计按 session_id 可查到模型调用（属主为你的设备 PAT 用户）。
```

---

## 9. 回滚

- Near：`enterprise.worker.protocol` 删除或设 `legacy` → 与 A05 默认一致（MA 路径不进入）；`ma_environment_mode` 无影响。交互式环境集合仅内存态，重启即清空。
- agent-runtime：`MA_RUNTIME_DESKTOP_PAT_ENABLED=0`（设备 PAT 重回 403）、`MA_RUNTIME_DESKTOP_WORKER_ENABLED=0`（Worker 面不接线，中间件不装），行为回到 E03。
- admin-console：内部路由无人调用即无影响；删除目录即回滚。
- 代码：删除 §3.1 新建文件，`git checkout` 修改文件。

---

## 10. 不变量

1. 未登录企业：设置页不出现「企业 Worker」tab；`EnterpriseWorker.run_forever` 每 5 秒空转，与现状一致；`/api/chat`、`messages.json`、确认门、本地凭证路径零改动。
2. `enterprise.worker.protocol` 缺省或 `legacy`：心跳、领取、执行、确认拒绝、完成 / 失败上报的请求路径与载荷不变；`tests/test_enterprise_worker.py` 不改一行仍全绿。
3. `status()` 旧键与取值不变（只追加）。
4. agent-runtime 两开关为 0 时，E03 全部测试与行为不变；`current_claim_scope` 为 None 时 `PgWorkQueue` 行为逐字节等同 E03。
5. 设备 PAT 永不获得 `ma:admin`、`ma:sessions:on_behalf`、`ma:agents:*`。
6. `agenticx/studio/server.py` 零改动；设置页无重复「保存」按钮，开关一律 `SettingsSwitch`。
7. 日志、异常、`repr` 中不出现 PAT。

---

## 11. 风险

1. **新授权面**：中间件逻辑错误会导致越权或误拒。FR-B2–B6 覆盖主要路径；合入前须强推理档审查 `desktop_access.py` 与 `pg_work_queue.py` 改动。
2. **contextvar 传播假设**：若 A04 / A05 在独立 task 中迭代 SSE 生成器，`current_claim_scope` 不可见 → `require_lease` 退化为不校验用户。FR-B6 必须真跑 inbox 流验证；不通过则改为把 `ClaimScope` 写入 `scope["state"]` 并在 PgWorkQueue 中经 contextvar 回退读取（实施者在 PR 描述里说明采用了哪种）。
3. **Agent 过滤的时效**：poll 期间新进入队列的其它 Agent 任务本轮被跳过（D5），最多延迟一个 3 秒轮次。
4. **网关地址推断**：`{base_url}/v1` 依赖生产 nginx 把 `/v1/` 转网关；本地开发必须显式配 `gateway_url`，否则模型调用 404，表现为会话 `retries_exhausted`。面板「最近错误」会显示上游错误摘要。
5. **网关计量属主**：设备 PAT 调用在网关记为员工本人（与 master §12「托管会话按服务 PAT 计量」不同，对 desktop_worker 反而更准确）；用户级网关配额会作用到他人分派给本机的任务。
6. `~/.agenticx/sessions/<ULID>/work` 与个人会话同根：依赖「无 `messages.json` 即跳过」的现状（证据 1.2）；若将来会话扫描逻辑改变需同步排除 ULID 目录。

---

## 12. 待确认问题

- **Q1（栈规则）**：本子规划含 admin-console 1 个内部只读路由（TS），超出 master §0 规则 1「最多两栈」。替代方案是把该路由拆成独立小子规划（例如 MA-E13「Worker 资格内部接口」）先行合入。是否接受在本子规划内完成，并在 master §12 登记？
- **Q2（契约扩展）**：新增 `GET /ma/v1/work/environments`（agent-runtime，`ma:worker`）不在 master §6.3 表中。是否接受作为会话面扩展端点并登记 master §12？
- **Q3（W3 门「门户发起 desktop_worker 任务」）**：MA-E04 约定门户的 `desktop_worker` Agent 仍走旧队列，W3 门这一步目前没有任何子规划负责把门户切到 MA desktop_worker 环境。本文演示用 API 模拟。需要另起 MA-E04 的后续子规划，还是放宽 W3 门表述？
- **Q4**：`dual` 是对 A05 冻结取值 `legacy|ma` 的扩展（A05 未实施）。若希望 A05 实施时直接包含 `dual`，可把 §5.3.2 / §5.3.6 前移到 A05。
