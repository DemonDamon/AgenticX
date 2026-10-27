# MA-A08 Multi-agent 线程：Manifest `multiagent`、会话内线程、`list_agents` / `send_to_agent` / `advisor`、线程事件与 API

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W6，编号 MA-A08）
Depends-on: **MA-A09**（复用其 `TurnContinuation`、`PlatformToolResolver`、权限来源 `platform`、`spec.PLATFORM_TOOL_NAMES`；未合入不得开工）、MA-E03（已实施）、MA-E02（已实施，iam-core 保存路径）
栈：Python（框架 + agent-runtime PG 事件存储）+ TS（`core-api` 校验器、`iam-core` 保存时固化成员版本）

> 风险等级：高。改冻结契约 §5.1（`multiagent` 结构）、改托管宿主回合循环与事件可见性；合入前建议强推理档只读审查。全部运行时能力由开关 `threads_enabled`（默认关）控制；Manifest 校验器的放宽对 `multiagent: null` 的既有 Manifest 无任何影响（规范化结果与 hash 不变）。

---

## 0. 一句话目标

Agent Manifest 的 `multiagent` 从「必须为 null」放开为 `{type:"coordinator", agents:[self | agent | advisor]}`（Python / TS 两份校验器同语义 + 共享 fixture）；协调者会话里每个成员在**同一会话、同一工作目录**中以独立上下文的**线程**运行；主线程自动获得 `list_agents`、`send_to_agent`（异步投递，成员完成后自动回报并唤醒主线程）与可选 `advisor`（一次性顾问咨询）；线程生命周期与跨线程消息落为 `session.thread_*` / `agent.thread_message_sent|received` 事件（复用 `ma_session_events.thread_id` 列，无迁移）；会话事件流只展示主线程活动与线程摘要，线程完整活动经新接口 `GET /ma/v1/sessions/{id}/threads*` 读取；`user.interrupt` 支持 `thread_id` 定向打断。

---

## 1. 根因 / 动机与证据链

### 1.1 来自 master 的约束

| master 位置 | 内容 | 本文落点 |
|---|---|---|
| §5.1 | 「`multiagent` 在 MA-A08 之前必须为 `null`；结构由 MA-A08 定义并回写本节」 | §6.1 定义结构与校验规则，§11 列回写文本 |
| §5.2 Event | `thread_id`（主线程为 null） | 主线程事件 `thread_id` 恒 null；成员线程事件带线程 ULID |
| §6.1 | `user.interrupt` 带 `thread_id?`；`session.thread_*`、`agent.thread_message_sent/received` 由 MA-A08 启用 | §6.2 定义 6 种事件 |
| §6.3 | 会话事件 / SSE 接口 | 新增线程接口，会话接口加可见性过滤（§2 D6） |
| §4 决策 2 | 两种执行位置一套协议 | v1 仅 `cloud` 环境支持（§2 D9） |
| §9 MA-A08 行 | 「定义 `multiagent` 结构（coordinator + self / agent / advisor），把现有委派映射为线程与线程事件」 | §2 D1 说明**不复用** `delegate_to_avatar` 的代码、只沿用语义 |
| master §0 规则 1 | 一个子规划最多两个栈 | Python + TS（core-api 与 iam-core 同为 enterprise TS 包） |
| 契约备忘 MA-A02 | `append_events` 读每条事件的 `thread_id`；状态机每会话一份 | 线程不进状态机，会话状态仍由主线程循环驱动（§2 D5） |

### 1.2 调研语义

- `research/managed-agents/zhipu/multiagent.md` L13：一个 Session 内多个独立上下文的 Thread；L43–45：`agent` 条目省略 version 时**保存时固定**到成员最新版本；`self` 用会话当前主 Agent 版本；L47–49：主线程自动获得 `list_agents`、`send_to_agent`，后者返回 `thread_id`、**不等待**成员完成，默认复用成员最新未归档 Thread，可指定 `thread_id` 或 `new_thread:true`；L49：子线程看不到主线程完整对话，同一 Session 共享文件系统；L53–57：Advisor 一次性咨询、不进 `list_agents`、只有主线程可用；L61–65：只允许一层委派（成员自身带 multiagent → 保存 400）；≤ 20 个不同 Agent；未归档普通线程（含主线程）≤ 25，Advisor 豁免；修改 multiagent 生成新版本。
- `research/managed-agents/zhipu/threads.md` L18–21：Session 流 = 主 Agent 全部活动 + 子线程生命周期与跨线程消息摘要；Thread 流 = 该线程完整活动；L29：主线程 `parent_thread_id` 为 null；L48–51：`sent/received` 相对所读线程；L55–63：线程状态 running/idle/rescheduling/terminated，Session 状态由线程聚合；L65：归档仅支持 idle 子线程，不能归档主线程，重复归档幂等；L67–73：定向打断经 Session events 发 `user.interrupt` 带线程 id，省略则打断所有活跃线程；普通 `user.message` 只进主线程。
- `research/managed-agents/bailian/managed-agents-multiagent.md`、`volcengine/multi-agent.md`：同类协调者-成员模型，无与上述冲突的约束。

### 1.3 现状代码证据（2026-10-25 核对，实施前重新核对行号）

| 文件 | 行 | 现状 | 结论 |
|---|---|---|---|
| `agenticx/managed/manifest.py` | 29、109、425–426、511 | `TOP_LEVEL_KEYS` 含 `multiagent`；载体 `multiagent: None = None`；规则 `manifest.multiagent: must be null`；规范化固定写 `"multiagent": None` | 放开为对象；null 时规范化与 hash 不变 |
| `enterprise/packages/core-api/src/managed-agents.ts` | 356、454、890–892、968 | 同上 TS 镜像 | 同步改 |
| `tests/fixtures/managed_agents/manifest_cases.json` | 515–522 | case `multiagent_not_null`：输入 `{}`，期望 `["manifest.multiagent: must be null"]` | 期望值改变（§6.1.4） |
| `enterprise/packages/iam-core/src/repos/agent-version-core.ts` | 158–174 | `prepareManifestWithOps`：validate → `pinTenantSkillVersions` → validate | 在同一位置固化成员版本 |
| `enterprise/packages/iam-core/src/repos/agent-version-ops.ts` | 44–79、~255（PG）、~390（内存）；`repos/mysql/agent-version-ops.ts` ~175 | `AgentVersionOps` 已有 `findVersion`，无「查多个 Agent 最新版本」 | 新增 `findAgentsLatestVersions` |
| `enterprise/packages/iam-core/src/repos/agent-versions.ts` | 94–147、149–156 | `createAgentVersion` 有 `agentId`；`previewAgentManifest` 无 | 给 `prepareManifestWithOps` 加可选 `selfAgentId` |
| `enterprise/apps/admin-console/src/lib/ma/manifest-form.ts` | 215–284 | `formToManifest` 以 `...base` 为底 | 管理台表单编辑不会丢失 `multiagent`，本文不改 UI |
| `agenticx/managed/spec.py` | 66–111、229–270 | `AgentSpec` 无 multiagent；`compile_spec(agent_id, …)` 已知自身 id | 增字段与自引用语义校验 |
| `agenticx/managed/host/actor.py` | 122–283、286–445 | 每会话一个 `SessionActor`、一个 `RuntimeEventAdapter`、一个 bundle | 成员线程各自一个 adapter + bundle，挂在 actor 上的 `ThreadManager` |
| `agenticx/managed/builder.py` | 99–158 | `build(spec, context=…)`：`ensure_session_workdir(context.session_id)`；`StudioSession.session_id = context.session_id` | 成员 bundle 用同一 `session_id` → 同一工作目录 |
| `agenticx/cli/agent_tools.py` | 5268–5276 | 文件工具跨会话拒绝用 `session.session_id` | 成员共享工作目录不受影响 |
| `agenticx/runtime/effect_guard.py` | 110–117 | `resolve_session_id` 先取 `_session_id` | 成员 `StudioSession._session_id` 设为 `<sid>.<tid>`，防止两线程相同写操作被当作重放而预填（§4.6） |
| `agenticx/managed/events/state_machine.py` | 73–77、216–224 | `InterruptTurn(dropped_pending)`；running 中 interrupt 只产生效果、不改状态 | `InterruptTurn` 增 `thread_id` 默认 None |
| `agenticx/managed/events/store.py`、`sqlite_store.py` L247–270、`enterprise/apps/agent-runtime/ma_agent_runtime/pg_event_store.py` L345–368 | — | `list_events(…, types)` 无线程过滤；`thread_id` 列已存在（`ma-sessions.ts` L43、`tables.py` L62） | 加 `thread_filter`，无迁移 |
| `agenticx/managed/host/routes.py` | 99–186 | 会话 SSE：先订阅后回放，按 seq 去重 / 补洞 | 抽成内部函数供线程流复用并加过滤 |
| `agenticx/managed/llm.py` | 15–21 | `LLMCallContext(tenant_id, session_id, agent_id, agent_version, user_id)` | 增 `thread_id`、`thread_role` |
| `agenticx/managed/gateway_llm.py` | 21–30 | 网关关联头 | 有线程时加 `X-AgenticX-Thread-Id` |
| `agenticx/managed/testing.py` | 83–98 | `PerSessionScriptFactory` 按 `session_id` 缓存 | 新增按线程分流的测试工厂 |
| `agenticx/runtime/meta_tools.py` | 1877–1915、2065–2110 | `delegate_to_avatar`：`session_manager.create(...)` 建**独立 Studio 会话**、写分身 `workspace_dir`、`persist()` 到 `~/.agenticx/sessions/`、后台 asyncio 跑 `AgentRuntime` | 见 §2 D1 |
| `agenticx/runtime/team_manager.py` | 160–186、480–507 | `AgentTeamManager` 并发上限、归档快照 | 只借鉴「并发上限 + 结果回报」语义 |

---

## 2. 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **不复用 `delegate_to_avatar` / `spawn_subagent` 代码，只沿用其「真委派、结果回报、全程透明」语义**。成员线程由新的 `ThreadManager` 在托管宿主内实现 | `delegate_to_avatar` 绑定 Studio 的 `SessionManager`、本机分身注册表与 `~/.agenticx/sessions/<id>/messages.json`，为每次委派**新建独立会话**、无租户维度、按本机分身配置选模型；MA 要求成员在**同一 MA 会话**内、事件进 `ma_session_events`、成员是**企业 Agent 的固定版本**、权限按成员 Manifest 评估。`agenticx/managed` 不得依赖 Studio 会话管理（MA-A01 约束）。复用代码会把个人模式的会话模型带进托管面，违反 master §4 决策 9 |
| D2 | Manifest `multiagent` 结构见 §6.1；`agent.version` 省略时**在企业保存路径**（iam-core `prepareManifestWithOps`）固化为成员当时 `latest_version`，并在同处做租户内存在性、一层委派、自引用校验；这些依赖数据库的错误只在 TS 侧，不进共享 fixture | 调研 L43；与 tenant skill 版本固化同一位置 |
| D3 | 线程 = 成员在本会话内的独立上下文：独立 `StudioSession`（独立 `agent_messages`）、独立 `RuntimeEventAdapter`、成员自己的模型 / 系统提示 / 工具与权限；共享会话工作目录。主线程事件 `thread_id=null`，成员线程事件 `thread_id=<线程 ULID>` | 调研 L49；master §5.2 |
| D4 | `send_to_agent` 只投递不等待：返回 `thread_id`；成员一轮结束后把最后一条 `agent.message` 文本作为回报，经 `TurnContinuation`（MA-A09）唤醒主线程开下一回合 | 调研 L47；与 A09 同一唤醒机制，避免两套循环 |
| D5 | **会话状态仍由主线程循环驱动**：主线程回合以 `end_turn` 结束而仍有成员在跑 / 有未处理回报时，不发 `status_idle`（A09 D4 的同一循环）。成员线程**不进** `SessionStateMachine` | 契约备忘：状态机一会话一份，不改状态机即可保证 E04 门户「收到 idle 即结束」的语义正确 |
| D6 | **事件可见性**：会话级 `GET …/events` 与 `…/events/stream` 只返回「`thread_id IS NULL`」或「type ∈ 4 种 `session.thread_*`」的事件；成员线程完整活动只经线程接口读取。所有事件共用会话 `seq`（线程流 seq 不连续） | 调研 threads L18–21；对没有成员线程的会话过滤恒为真，既有行为不变 |
| D7 | **成员线程不支持审批与自定义工具**：成员 Manifest 中 `always_ask`（含企业 ask）的工具在成员线程里直接拒绝（`ERROR: tool "<x>" requires approval, which member threads do not support`）；成员的自定义工具不进其工具表，调用也拒绝；成员线程不注入 task_* 与线程工具 | 状态机一会话一份、`requires_action` 只能挂主线程；调研 L182–184 同样限制子 Agent。审批进成员线程列入后续候选 |
| D8 | 只允许一层：成员（含 self 副本）没有 `list_agents` / `send_to_agent` / `advisor`；成员版本 Manifest 自带非 null `multiagent` → 保存时拒绝，运行时也视为不可用 | 调研 L61 |
| D9 | v1 范围：仅 `cloud` 环境；带 `multiagent` 的会话**不支持** `vault_ids` / `resources`（建会话 400） | 桌面 Worker 执行模型不同；Vault / 记忆挂载（A06 / A07）的回合扩展只挂在主线程 bundle 上，成员共享工作目录却绕过只读挂载钩子会写坏只读记忆——宁可先拒绝。共享 Vault / 记忆列入后续子规划 MA-A08b（§11） |
| D10 | 上限：Manifest `agents` 1–20 项；会话内非 terminated 的普通线程（含主线程）≤ 25，advisor 不计；单条 `send_to_agent.message` ≤ 32000 字符 | 调研 L63 |
| D11 | **用量**：成员与 advisor 的 `span.model_request_end` 照常落库（E03 PG 存储据此写 `ma_session_usage` 行，按会话 id 关联）；会话级 `usage`（`ma_sessions.usage_totals` 与主线程 `session.usage` 事件）= 主线程累计 + 全部线程累计。成员线程自己的 `session.usage`（`thread_id` 非空）是该线程累计 | 计量不丢；会话总量单一来源 |
| D12 | **定向打断**：`user.interrupt` 带成员线程 id → 只停该线程当前回合（回报文本为 `[member thread interrupted by user]`），会话状态不变；不带 → 停主线程与全部成员线程，不再回报。`thread_id` 等于会话 id 或未知 → 整批 400；`user.message` / resolution 带非 null `thread_id` → 整批 400 | 调研 threads L67–73 |
| D13 | **重启**：线程上下文在内存中，重启后丢失。首次加载 `ThreadManager` 时，对非 terminated 的成员线程补 `session.thread_status_terminated(reason="context_lost")`；之后向同一成员 `send_to_agent` 会新建线程 | 如实处理，不伪造续接 |
| D14 | 开关：`HostConfig.threads_enabled`（默认 False）/ agent-runtime `MA_RUNTIME_THREADS_ENABLED`。关闭时带非 null `multiagent` 的 Agent 建会话返回 400 `multiagent is not enabled on this host`，其它 Agent 不受影响 | 显式失败优于静默降级成单 Agent |

---

## 3. In scope / Out of scope

### 3.1 In scope（只能创建或修改这些文件）

框架（Python）：
- 修改 `agenticx/managed/manifest.py`（§4.1）
- 修改 `agenticx/managed/protocol.py`（§4.2：6 种事件）
- 修改 `agenticx/managed/errors.py`（新增 `THREAD_NOT_FOUND`）
- 修改 `agenticx/managed/spec.py`（`AgentSpec.multiagent`、语义校验、`PLATFORM_TOOL_NAMES` 追加 3 项）
- 修改 `agenticx/managed/builder.py`（只加公开只读属性 `llm_factory`，§4.6 第 5 点）
- 修改 `agenticx/managed/llm.py`（`LLMCallContext` 两个可选字段）
- 修改 `agenticx/managed/gateway_llm.py`（线程头）
- 修改 `agenticx/managed/testing.py`（`ThreadScriptFactory`）
- 修改 `agenticx/managed/events/store.py`（`ThreadFilter`、`list_events` 参数）
- 修改 `agenticx/managed/events/sqlite_store.py`（`list_events` 过滤）
- 修改 `agenticx/managed/events/state_machine.py`（`InterruptTurn.thread_id` 与定向打断规划）
- 新建 `agenticx/managed/host/threads.py`
- 修改 `agenticx/managed/host/continuation.py`（MA-A09 新建；`wake_text` 增一个分支）
- 修改 `agenticx/managed/host/actor.py`（线程管理器挂载、用量合并、批量校验、定向打断）
- 修改 `agenticx/managed/host/service.py`（建会话校验、线程查询 / 归档、`list_events` 默认会话过滤）
- 修改 `agenticx/managed/host/routes.py`（会话流过滤、5 个线程接口）
- 修改 `agenticx/managed/host/config.py`（`threads_enabled`）
- 修改 `agenticx/cli/ma_commands.py`（`serve --enable-threads`）

企业（Python，agent-runtime）：
- 修改 `enterprise/apps/agent-runtime/ma_agent_runtime/pg_event_store.py`（`list_events` 过滤）
- 修改 `enterprise/apps/agent-runtime/ma_agent_runtime/config.py`、`app.py`（`MA_RUNTIME_THREADS_ENABLED`）

企业（TS）：
- 修改 `enterprise/packages/core-api/src/managed-agents.ts`（校验器、类型、6 种事件、`thread_not_found`）
- 修改 `enterprise/packages/iam-core/src/repos/agent-version-core.ts`（成员固化）
- 修改 `enterprise/packages/iam-core/src/repos/agent-manifest-legacy.ts`（新增纯函数 `pinMultiagentMembers`，与 `pinTenantSkillVersions` 同文件）
- 修改 `enterprise/packages/iam-core/src/repos/agent-version-ops.ts`、`repos/mysql/agent-version-ops.ts`（`findAgentsLatestVersions` 三处实现：PG、内存、MySQL）
- 修改 `enterprise/packages/iam-core/src/repos/agent-versions.ts`、`repos/agents.ts`（调用处传 `selfAgentId`）

测试、fixture 与文档：
- 修改 `tests/fixtures/managed_agents/manifest_cases.json`（§6.1.4）
- 修改 `tests/managed/test_manifest.py`、`test_fixture_parity.py`（`EXPECTED_HASHES` 增新 ok case）、`test_protocol.py`（L110 样例补 6 项）、`test_spec.py`、`test_state_machine.py`、`test_sqlite_store.py`
- 新建 `tests/managed/test_threads.py`、`tests/managed/test_thread_routes.py`
- 修改 `enterprise/packages/core-api/src/__tests__/managed-agents.test.ts`（`EXPECTED_HASHES` 同步）
- 修改 `enterprise/packages/iam-core/src/repos/__tests__/agent-versions.test.ts`（成员固化用例）
- 修改 `enterprise/apps/agent-runtime/tests/test_pg_event_store_contract.py`（过滤用例）、`tests/test_config.py`
- 修改 `docs/managed-agents/protocol.md`（「Multi-agent 与线程（MA-A08）」一节）

### 3.2 Out of scope

- 不改 `agenticx/runtime/meta_tools.py`、`team_manager.py`、`agent_runtime.py`、`agenticx/cli/agent_tools.py`、`agenticx/studio/*`。
- 成员线程的审批 / 自定义工具 / 后台任务 / Vault / 记忆挂载（D7、D9）→ 后续 MA-A08b。
- `desktop_worker` 环境的多智能体。
- 管理台 Manifest 表单的 multiagent 可视化编辑、观测台按线程分栏、Near 渲染线程（另起子规划；未知事件类型在 `ma-session-console.ts` 已有 `other` 兜底）。
- 成员线程 SSE 的增量预览帧（`event_deltas`）。
- 跨企业 / 跨租户引用成员 Agent。
- 多层编排、会话级预算。

---

## 4. 精确落点

### 4.1 `agenticx/managed/manifest.py`（Python 校验器）

1. 常量（`DEFAULT_MAX_TOOL_ROUNDS` 之后）：

```python
MULTIAGENT_TYPES = ("coordinator",)
MULTIAGENT_MEMBER_TYPES = ("self", "agent", "advisor")
MULTIAGENT_MAX_MEMBERS = 20
MEMBER_AGENT_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
MAX_ADVISOR_INSTRUCTIONS_BYTES = 8192
```

2. 载体模型（`RuntimeLimits` 之后）：

```python
class MultiagentSelf(_StrictModel):
    type: Literal["self"]

class MultiagentAgentRef(_StrictModel):
    type: Literal["agent"]
    id: str
    version: int | None = None

class MultiagentAdvisor(_StrictModel):
    type: Literal["advisor"]
    model: str
    instructions: str | None = None

MultiagentMember = Annotated[
    MultiagentSelf | MultiagentAgentRef | MultiagentAdvisor, Field(discriminator="type")
]

class MultiagentConfig(_StrictModel):
    type: Literal["coordinator"]
    agents: list[MultiagentMember]
```

`AgentManifest.multiagent: None = None`（L109）改为 `multiagent: MultiagentConfig | None = None`。

3. 校验：`_validate_fields` 中 L425–426 两行替换为 `_validate_multiagent(raw, errors)`，新函数规则与错误串见 §6.1.2（逐字）。
4. 规范化：`normalize_manifest` 中 `"multiagent": None,`（L511）替换为 `"multiagent": _normalize_multiagent(raw.get("multiagent")),`：

```python
def _normalize_multiagent(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    members: list[dict[str, Any]] = []
    for item in value["agents"]:
        kind = item["type"]
        if kind == "self":
            members.append({"type": "self"})
        elif kind == "agent":
            members.append({"type": "agent", "id": item["id"], "version": item.get("version", None)})
        else:
            members.append({"type": "advisor", "model": item["model"], "instructions": item.get("instructions", None)})
    return {"type": "coordinator", "agents": members}
```

`multiagent` 缺失或 null → null；hash 与改前一致（`test_manifest_hashes_match_ts` 的既有值不变是本项的验收）。

### 4.2 `agenticx/managed/protocol.py`（事件）

`SERVER_EVENT_TYPES` 末尾（在 MA-A09 追加的两项之后）追加，顺序逐字：

```python
    "session.thread_created",
    "session.thread_status_running",
    "session.thread_status_idle",
    "session.thread_status_terminated",
    "agent.thread_message_sent",
    "agent.thread_message_received",
```

（共 6 种；会话面「线程摘要类型」= 前 4 种，见 §4.5。）

新增模型（字段逐字，`extra="forbid"`）：

```python
class ThreadAgentRef(_StrictModel):
    type: Literal["self", "agent", "advisor"]
    agent_id: str | None = None
    agent_version: int | None = None
    name: str | None = None
    model: str | None = None

class SessionThreadCreated(EventBase):
    type: Literal["session.thread_created"]
    agent: ThreadAgentRef
    parent_thread_id: str | None = None      # null = primary thread

class SessionThreadStatusRunning(EventBase):
    type: Literal["session.thread_status_running"]

class SessionThreadStatusIdle(EventBase):
    type: Literal["session.thread_status_idle"]
    stop_reason: StopReason

class SessionThreadStatusTerminated(EventBase):
    type: Literal["session.thread_status_terminated"]
    reason: Literal["completed", "archived", "context_lost", "host_restarted", "session_closed"]

class AgentThreadMessageSent(EventBase):
    type: Literal["agent.thread_message_sent"]
    to_thread_id: str | None = None          # null = primary
    to_agent_name: str
    content: list[ContentBlock]

class AgentThreadMessageReceived(EventBase):
    type: Literal["agent.thread_message_received"]
    from_thread_id: str | None = None        # null = primary
    from_agent_name: str
    content: list[ContentBlock]
```

全部加入 `ServerEvent` 联合。`thread_id`（EventBase 信封字段）规则：`session.thread_*` 的 `thread_id` = 该成员线程 id；`agent.thread_message_*` 的 `thread_id` = 事件所属线程（主线程为 null）。

### 4.3 `agenticx/managed/spec.py`

1. `PLATFORM_TOOL_NAMES`（A09 新建）改为 `("task_list", "task_get", "task_kill", "list_agents", "send_to_agent", "advisor")`。
2. `AgentSpec` 在 `normalized_manifest` 字段之后追加 `multiagent: Mapping[str, Any] | None = None`（有默认值，放最后）。`compile_spec` 构造时传 `multiagent=normalized["multiagent"]`。
3. `_semantic_errors(normalized)` 改签名为 `_semantic_errors(normalized, agent_id: str)`（`compile_spec` 内调用处同步改），末尾追加：

```python
    multiagent = normalized.get("multiagent")
    if multiagent is not None:
        for index, member in enumerate(multiagent["agents"]):
            if member["type"] == "agent" and member["id"] == agent_id:
                errors.append(
                    f'manifest.multiagent.agents[{index}].id: use {{"type":"self"}} to reference this agent'
                )
```

### 4.4 `agenticx/managed/llm.py` / `gateway_llm.py` / `testing.py`

- `LLMCallContext` 追加 `thread_id: str | None = None`、`thread_role: Literal["self", "agent", "advisor"] | None = None`（均有默认值，既有构造不变）。
- `gateway_headers`：`context.thread_id` 非空时追加 `"X-AgenticX-Thread-Id": context.thread_id`；其余头不变。
- `testing.py` 新增并导出：

```python
class ThreadScriptFactory:
    """Scripted LLMs keyed by (session_id, role). role = "primary" | "self" | "agent:<agent_id>" | "advisor".

    One ScriptedLLM per (session_id, thread_id or "primary"); scripts are chosen by role.
    """

    def __init__(self, scripts: Mapping[str, Sequence[ScriptStep]], *, fallback_text: str = "done") -> None: ...
    def create(self, *, provider: str, model: str, context: LLMCallContext) -> ScriptedLLM: ...
    def llm_for(self, session_id: str, thread_id: str | None) -> ScriptedLLM | None: ...
```

角色解析：`thread_id is None` → `"primary"`；`thread_role == "agent"` → `f"agent:{context.agent_id}"`；否则 `thread_role`。未配置的角色用空脚本（只返回 `fallback_text`）。

### 4.5 事件存储过滤

`agenticx/managed/events/store.py` 追加并导出：

```python
SESSION_VISIBLE_THREAD_TYPES: frozenset[str] = frozenset({
    "session.thread_created", "session.thread_status_running",
    "session.thread_status_idle", "session.thread_status_terminated",
})

@dataclass(frozen=True)
class ThreadFilter:
    """mode="session": thread_id IS NULL or type in SESSION_VISIBLE_THREAD_TYPES.
    mode="thread": thread_id == self.thread_id (None selects the primary thread)."""

    mode: Literal["session", "thread"]
    thread_id: str | None = None

    def matches(self, event: StoredEvent) -> bool: ...
```

`EventStore.list_events` 抽象签名追加关键字参数 `thread_filter: ThreadFilter | None = None`（None = 不过滤，保持所有内部调用者行为）。

`SqliteEventStore.list_events`（L247–270）在 `types` 条件之后追加：

```python
        if thread_filter is not None:
            if thread_filter.mode == "session":
                marks = ", ".join("?" for _ in SESSION_VISIBLE_THREAD_TYPES)
                sql += f" AND (thread_id IS NULL OR type IN ({marks}))"
                params.extend(sorted(SESSION_VISIBLE_THREAD_TYPES))
            elif thread_filter.thread_id is None:
                sql += " AND thread_id IS NULL"
            else:
                sql += " AND thread_id = ?"
                params.append(thread_filter.thread_id)
```

`PgEventStore.list_events`（L345–368）等价地加 `or_(c.thread_id.is_(None), c.type.in_(sorted(...)))` / `c.thread_id.is_(None)` / `c.thread_id == tid`。不加索引（按会话扫描，`(session_id, seq)` 唯一索引已覆盖）。

### 4.6 新建 `agenticx/managed/host/threads.py`

```python
THREAD_TOOL_NAMES = ("list_agents", "send_to_agent")
ADVISOR_TOOL_NAME = "advisor"
MAX_ACTIVE_THREADS = 25            # including the primary thread; advisor threads excluded
MAX_THREAD_MESSAGE_CHARS = 32000
MAX_ADVISOR_QUESTION_CHARS = 8000
ADVISOR_HISTORY_MESSAGES = 20
ADVISOR_HISTORY_CHARS = 24000
REPORT_INTERRUPTED_TEXT = "[member thread interrupted by user]"
DEFAULT_ADVISOR_INSTRUCTIONS = (
    "You are a senior advisor consulted by a coordinating agent. Read the conversation so far "
    "and give concise, concrete advice: risks, missing steps, and the next best action. "
    "Do not call tools. Answer in the language of the conversation."
)


@dataclass
class MemberDescriptor:
    key: str                        # "self" or the member agent id
    kind: Literal["self", "agent"]
    agent_id: str
    agent_version: int
    name: str
    description: str | None
    available: bool
    unavailable_reason: str | None
    spec: AgentSpec | None          # None when unavailable


@dataclass
class ThreadState:
    thread_id: str
    member_key: str                 # "self", agent id, or "advisor"
    agent: dict[str, Any]           # ThreadAgentRef wire
    status: Literal["idle", "running", "terminated"]
    stop_reason: dict[str, Any] | None = None
    runner: "ThreadRunner | None" = None


class MemberPermissionEngine(PermissionEngine):
    """Member threads: ask -> deny, custom -> deny (D7)."""

    def evaluate(self, tool_name: str, arguments: Mapping[str, Any] | None) -> PermissionDecision: ...


class ThreadBroker:
    """ActionBroker for one member thread. request_action is never reached (MemberPermissionEngine)."""

    async def announce_tool_use(self, *, kind, name, input, evaluated_policy, mcp_server=None) -> str: ...
    async def request_action(self, event_id: str, kind: ActionKind) -> ClientEvent | None:  # returns None
        ...
    def custom_tool_use_id(self, name: str) -> str | None:  # returns None
        ...


class ThreadRunner:
    """Runs one member thread: its own bundle, adapter, and FIFO of coordinator messages."""

    def __init__(self, *, manager: "ThreadManager", state: ThreadState, member: MemberDescriptor) -> None: ...
    def enqueue(self, text: str, pending_key: str) -> bool:   # True when it was queued behind a running turn
        ...
    def interrupt(self, *, report: bool) -> None: ...
    async def close(self) -> None: ...


class ThreadManager:
    """Per-session member threads. Created by LocalTurnExecutor when spec.multiagent is not None."""

    def __init__(self, *, actor: "SessionActor", continuation: TurnContinuation) -> None: ...
    async def load(self) -> None:
        """Fold existing thread events once; mark non-terminated member threads context_lost (D13)."""
    def install(self, resolver: PlatformToolResolver) -> list[str]:
        """Register list_agents / send_to_agent (and advisor when configured). Returns names."""
    async def list_agents(self) -> str: ...
    async def send(self, arguments: dict[str, Any]) -> str: ...
    async def advise(self, arguments: dict[str, Any], primary_bundle: ManagedRuntimeBundle) -> str: ...
    def has_active(self) -> bool: ...
    def known_thread(self, thread_id: str) -> bool: ...        # member or advisor thread seen in this session
    async def interrupt_thread(self, thread_id: str) -> None: ...
    async def interrupt_all(self) -> None: ...
    async def archive(self, thread_id: str) -> None: ...       # raises MAError, see §6.4
    def take_usage_delta(self) -> Usage: ...                   # accumulated member/advisor usage since last take
    async def close(self) -> None: ...                         # terminate runners (reason "session_closed")
```

关键实现（逐条）：

1. **成员解析**（`load` 内一次，缓存）：遍历 `actor.spec.multiagent["agents"]`：
   - `self` → `key="self"`，`agent_id=actor.record.agent_id`、`agent_version=actor.record.agent_version`、`spec=actor.spec`、`name = (await registry.get_agent(...)).display_name`。
   - `agent` → `record = await registry.get_agent(tenant, id)`；`version = await registry.get_version(tenant, id, member["version"])`；不可用条件与 `unavailable_reason`（逐字）：记录不存在 → `"agent not found"`；`record.status != "active"` → `"agent is disabled"`；版本不存在 → `"version not found"`；`compile_spec` 抛错 → `"manifest invalid"`；编译后 `spec.multiagent is not None` → `"member is a coordinator"`。
   - `advisor` 不进成员表，存 `self._advisor = member`。
2. **成员线程 bundle**（`ThreadRunner` 首次运行时建）：

```python
context = LLMCallContext(
    tenant_id=actor.tenant_id, session_id=actor.session_id,
    agent_id=member.agent_id, agent_version=member.agent_version,
    user_id=actor.record.created_by_user_id,
    thread_id=state.thread_id, thread_role=member.kind,
)
auth = ToolAuthorization()
engine = MemberPermissionEngine(member.spec, actor.service.config.enterprise_policy)
hook = ManagedPermissionHook(engine=engine, broker=ThreadBroker(...), authorization=auth)
bundle = actor.service.builder.build(
    member.spec, context=context, confirm_gate=ManagedConfirmGate(auth),
    hooks=[hook], custom_tool_resolver=None, history=[],
)
bundle.tools[:] = [s for s in bundle.tools if s["function"]["name"] not in member.spec.custom_tool_names]
bundle.session._session_id = f"{actor.session_id}.{state.thread_id}"   # effect guard key only (§1.3)
```

   `bundle.session.session_id` 保持会话 id（同一工作目录、跨会话拒绝照常）。
3. **成员一轮**（`ThreadRunner._run_turn(text, pending_key)`）：
   - 落 `session.thread_status_running`（`thread_id=tid`）与 `agent.thread_message_received`（`thread_id=tid`，`from_thread_id=None`，`from_agent_name="coordinator"`，`content=[{"type":"text","text":text}]`）。
   - `adapter.begin_turn(self.usage)`；`async for ev in bundle.run_turn(text, should_stop=lambda: self._stop)`：`out = adapter.convert(ev)`，每条 `out.events` 设 `ev["thread_id"] = tid` 后 `actor.append`；不发预览帧。
   - `outcome = adapter.finish_turn()`（异常 / 取消分支与 `LocalTurnExecutor._run` 相同写法）；`outcome.events` 全部打上 `thread_id` 落库；`manager._usage_delta += (outcome.usage - self.usage)`；`self.usage = outcome.usage`。
   - 落 `session.thread_status_idle`（`thread_id=tid`，`stop_reason={"type": outcome.stop_type, "event_ids": []}`）。
   - 回报文本：本轮最后一条 `agent.message` 的文本（从本轮 `actor.append` 返回的事件里取）；无文本 → `f"[member thread stopped: {outcome.stop_type}]"`；被定向打断 → `REPORT_INTERRUPTED_TEXT`。
   - 回报事件：成员线程 `agent.thread_message_sent`（`thread_id=tid`，`to_thread_id=None`，`to_agent_name="coordinator"`）+ 主线程 `agent.thread_message_received`（`thread_id=None`，`from_thread_id=tid`，`from_agent_name=member.name`）。两条在**同一次** `actor.append` 中落库。
   - `continuation.resolve_pending(pending_key, WakeUp("thread", <主线程那条 received 的 StoredEvent>))`；`interrupt_all` 之后 → `resolve_pending(pending_key, None)` 且不落回报事件。
   - 队列中还有消息 → 继续下一轮；否则空闲。
4. **`send(arguments)`**（`send_to_agent` handler）：参数 `agent`（必填，`"self"` 或成员 agent id）、`message`（必填）、`thread_id`（可选）、`new_thread`（可选 bool）。返回值与错误串见 §6.3（逐字）。选线程：`thread_id` 给定 → 必须属于该成员且非 terminated；否则 `new_thread` 为 true 或该成员没有非 terminated 线程 → 新建（先检查 `MAX_ACTIVE_THREADS`）；否则复用该成员**最新创建**的非 terminated 线程。新建线程：`tid = new_ulid()`，落 `session.thread_created`（`thread_id=tid`，`agent={"type": kind, "agent_id", "agent_version", "name"}`，`parent_thread_id=None`）。投递：先落主线程 `agent.thread_message_sent`（`thread_id=None`，`to_thread_id=tid`，`to_agent_name=member.name`，`content=[text]`），`pending_key = f"thread:{tid}:{new_ulid()}"`，`continuation.register_pending(pending_key)`，`runner.enqueue(text, pending_key)`。
5. **`advise(arguments, primary_bundle)`**：仅当 `self._advisor` 存在才注册。参数 `question`（可选，≤ 8000 字符）。步骤：`tid = new_ulid()`；落 `session.thread_created(agent={"type":"advisor","model":<model>}, parent_thread_id=None)` + `session.thread_status_running`；取 `primary_bundle.session.agent_messages` 中 role 为 `user` / `assistant` 且 content 为 str 的最后 `ADVISOR_HISTORY_MESSAGES` 条，每条截 4000 字符，总长超 `ADVISOR_HISTORY_CHARS` 时从最旧丢弃，拼为 `"<role>: <content>"` 行；`provider, model = split_model_ref(advisor["model"])`；`llm = actor.service.builder.llm_factory.create(provider=provider, model=model, context=<见下>)`，其中 `llm_factory` 是本文在 `ManagedAgentBuilder` 上新增的公开只读属性（`@property def llm_factory(self) -> LLMFactory: return self._llm_factory`，不得在 threads.py 里访问 `_llm_factory`）；上下文 `thread_id=tid, thread_role="advisor"`；落 `span.model_request_start(model=advisor["model"])`；`resp = await asyncio.to_thread(llm.invoke, [{"role":"system","content": instructions or DEFAULT_ADVISOR_INSTRUCTIONS}, {"role":"user","content": transcript + ("\n\nQuestion: " + q if q else "")}])`；`text = str(getattr(resp, "content", "") or "").strip()`；用量取 `getattr(resp, "usage", None)` 的 `prompt_tokens` / `completion_tokens`（缺省 0）落 `span.model_request_end`，计入 `_usage_delta`；落 advisor 线程 `agent.message`（`thread_id=tid`）、主线程 `agent.thread_message_received(from_thread_id=tid, from_agent_name="advisor")`、advisor 线程 `session.thread_status_terminated(reason="completed")`；返回 `text`（空 → `"ERROR: advisor returned no advice"`）。异常 → 落 `span.model_request_end(is_error=True)` 与 `session.thread_status_terminated(reason="completed")`，返回 `f"ERROR: advisor failed: {type(exc).__name__}"`（不带异常消息）。advisor 是同步工具，不注册 pending、不唤醒。
6. **`list_agents()`** 返回 `json.dumps(..., ensure_ascii=False)`，形状见 §6.3。
7. **定向 / 全部打断**：`interrupt_thread(tid)`：成员线程 running → `runner.interrupt(report=True)`（置 `_stop`，3 秒宽限后取消该线程任务，回报 `REPORT_INTERRUPTED_TEXT`）；idle / terminated → 无操作。`interrupt_all()`：置 `self._suppress_reports=True`，所有 runner `interrupt(report=False)`，清空各 runner 队列并对每个未完成 `pending_key` 调 `resolve_pending(key, None)`。下一次主线程用户回合开始时（`LocalTurnExecutor._start_locked`）调 `manager.resume_reports()` 复位 `_suppress_reports`。

### 4.7 `agenticx/managed/host/continuation.py`（A09 文件，仅加分支）

`wake_text(event)` 增加 `agent.thread_message_received` 分支（模板逐字）：

```
[report from member <from_agent_name> (thread <from_thread_id>)]
<content 中 text 块用换行拼接>
```

### 4.8 `agenticx/managed/events/state_machine.py`

1. `InterruptTurn` 追加字段 `thread_id: str | None = None`（frozen dataclass，带默认值放最后）。
2. `plan_client_events` 的 `UserInterrupt` 分支最前面插入：

```python
            if isinstance(event, UserInterrupt) and event.thread_id is not None:
                effects.append(InterruptTurn((), thread_id=event.thread_id))
                continue
```

（不改 `sim_status` / `sim_pending`；`thread_id` 合法性由 actor 在规划前校验，§4.9 第 3 点。）

### 4.9 `agenticx/managed/host/actor.py`

1. `SessionActor.__init__` 追加 `self.threads: ThreadManager | None = None`。
2. `SessionActor.finish_turn_locked` 与 A09 的「继续前先落 outcome」处都改为先合并成员用量：新方法

```python
    def merge_thread_usage(self, outcome: TurnOutcome) -> TurnOutcome:
        """Add the member/advisor usage delta to the outcome and to its trailing session.usage event."""
```

   实现：`delta = self.threads.take_usage_delta() if self.threads else Usage()`；delta 全 0 → 原样返回；否则 `usage = outcome.usage + delta`（逐字段相加），把 `outcome.events` 中**最后一条** `type=="session.usage"` 的 `usage` 替换为 `usage.model_dump()`，返回新 `TurnOutcome`。`LocalTurnExecutor` 在每次 `actor.append(outcome.events)` / `finish_turn_locked(outcome)` 之前调用它。
3. `handle_client_batch`（L177–219）在 `events = parse_client_events(raw)` 之后、`async with self.lock` 之前插入批量校验（任一失败整批 0 写入）：

```python
        for index, event in enumerate(events):
            tid = getattr(event, "thread_id", None)
            if tid is None:
                continue
            if not isinstance(event, UserInterrupt):
                raise MAError(INVALID_EVENT_BATCH, f"events[{index}]: only user.interrupt may target a thread",
                              details={"index": index})
            if self.threads is None or tid == self.session_id or not self.threads.known_thread(tid):
                raise MAError(INVALID_EVENT_BATCH, f"events[{index}]: unknown thread", details={"index": index})
```

   效果分发处：`elif isinstance(effect, InterruptTurn):` 改为

```python
                elif isinstance(effect, InterruptTurn):
                    if effect.thread_id is not None and self.threads is not None:
                        await self.threads.interrupt_thread(effect.thread_id)
                    else:
                        await self.executor.interrupt(effect.dropped_pending)
```

4. `LocalTurnExecutor.__init__`（A09 已加 continuation 段）改为：

```python
        wants_threads = actor.spec.multiagent is not None and getattr(cfg, "threads_enabled", False)
        if (getattr(cfg, "tasks_enabled", False) or wants_threads) and actor.environment.type == "cloud":
            self.continuation = TurnContinuation()
        # tasks block from A09 unchanged (guarded by tasks_enabled)
        if wants_threads and self.continuation is not None:
            actor.threads = ThreadManager(actor=actor, continuation=self.continuation)
```

5. `_ensure_bundle`：在 A09 的 `self.tasks.install(...)` 之后、`self._bundle.tools.extend(self.platform.schemas())` 之前：

```python
            if self.actor.threads is not None:
                await self.actor.threads.load()
                names = self.actor.threads.install(self.platform, primary_bundle_getter=lambda: self._bundle)
```

   `PermissionEngine(... platform_tools=...)` 的集合改为 `TASK_TOOL_NAMES`（若 tasks 开）∪ 线程工具名（若 threads 开）。因为 engine 在 build 前构造，而线程工具名只取决于 manifest（`advisor` 是否存在），直接按 `actor.spec.multiagent` 计算：`{"list_agents", "send_to_agent"} | ({"advisor"} if any(m["type"]=="advisor" ...) else set())`。`install` 签名相应为 `install(resolver, *, primary_bundle_getter: Callable[[], ManagedRuntimeBundle])`（advisor 需要读主线程历史）。
6. A09 的循环条件 `self.continuation.has_pending` 不变（成员在跑 = 有 pending key）。
7. `interrupt()`：在 A09 追加的 continuation / tasks 处理之后追加 `if self.actor.threads is not None: asyncio.create_task(self.actor.threads.interrupt_all())`。
8. `_start_locked`：`if self.actor.threads is not None: self.actor.threads.resume_reports()`。
9. `close()`：`if self.actor.threads is not None: await self.actor.threads.close()`。

### 4.10 `agenticx/managed/host/service.py`

1. `create_session`：在 `compile_spec(agent.id, version.version, version.manifest)` 一行改为 `spec = compile_spec(...)`，紧接着插入：

```python
        if spec.multiagent is not None:
            if not getattr(self.config, "threads_enabled", False):
                raise MAError(INVALID_REQUEST, "multiagent is not enabled on this host")
            if environment.type != "cloud":
                raise MAError(INVALID_REQUEST, "multiagent agents require a cloud environment")
            if req.vault_ids or req.resources:
                raise MAError(INVALID_REQUEST, "multiagent sessions do not support vault_ids or resources yet")
```

   放在现有 `vault_ids` / `resources` 拒绝逻辑（或 A06 / A07 的校验器）**之前**执行（若 A06 已把那两段移到后面，则本段放在 `compile_spec` 之后、`create_validators` 调用之前；以实际实现为准，实施前核对）。
2. `list_events(...)` 增加关键字参数 `thread_filter: ThreadFilter | None = ThreadFilter("session")`，传给 store。
3. 线程查询（全部先 `get_session` 校验租户）：

```python
    async def list_threads(self, principal, session_id, *, include_archived: bool) -> list[dict]: ...
    async def get_thread(self, principal, session_id, thread_id) -> dict: ...       # 不存在 -> THREAD_NOT_FOUND
    async def list_thread_events(self, principal, session_id, thread_id, *, after_seq, limit, types) -> tuple[list[StoredEvent], bool]: ...
    async def archive_thread(self, principal, session_id, thread_id) -> dict: ...
```

   线程记录由事件折叠（`types` = 4 种 `session.thread_*`，分页读全），主线程由会话记录合成；JSON 见 §6.4。`archive_thread` 经 `actor_for` → `actor.threads.archive(tid)`；`actor.threads is None` 且 tid 非主线程 → `THREAD_NOT_FOUND`。
4. `agenticx/managed/errors.py` 追加 `THREAD_NOT_FOUND = MAErrorCode("thread_not_found", 404)` 并入 `ALL_ERROR_CODES`（TS `MA_ERROR_CODES` 同步）。

### 4.11 `agenticx/managed/host/routes.py`

1. 把 `stream_events` 的 `generate()` 主体抽成模块级 `async def _sse_stream(state, principal, session_id, *, cursor, want_previews, thread_filter, archived, request, subscription)`，行为与现有逐字一致，另加：回放用 `store.list_events(..., thread_filter=thread_filter)`；实时项 `item.event` 若 `not thread_filter.matches(event)` → 只把 `replay_cursor = max(replay_cursor, event.seq)` 后 `continue`（不 yield）；补洞 `gap` 读取同样带过滤。预览帧只在会话流且 `want_previews` 非空时转发（线程流传空集合）。
2. 会话流调用 `_sse_stream(..., thread_filter=ThreadFilter("session"))`；会话 `list_events` 路由不改（服务层默认值已是会话过滤）。
3. 新路由（`ma:sessions:read`，写操作 `ma:sessions:write`）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/sessions/{session_id}/threads?include_archived=false` | `{"data":[Thread]}` |
| GET | `/sessions/{session_id}/threads/{thread_id}` | `{"thread": Thread}` |
| GET | `/sessions/{session_id}/threads/{thread_id}/events?after_seq=&limit=&types=` | `{"data","has_more","next_after_seq"}`；`thread_id == session_id` → 主线程（`ThreadFilter("thread", None)`） |
| GET | `/sessions/{session_id}/threads/{thread_id}/events/stream` | SSE；`Last-Event-ID` / `after_seq` 同会话流；不支持 `event_deltas[]` |
| POST | `/sessions/{session_id}/threads/{thread_id}/archive` | `{"thread": Thread}` |

### 4.12 配置与 CLI

- `HostConfig` 追加 `threads_enabled: bool = False`。
- `agx ma serve` 增 `--enable-threads`（构造 `HostConfig(threads_enabled=...)`，只加这一参数）。
- agent-runtime `Settings.threads_enabled` ← `MA_RUNTIME_THREADS_ENABLED`（恰为 `"1"` 才启用），`app.py` 传入 `HostConfig`。

### 4.13 TS：`enterprise/packages/core-api/src/managed-agents.ts`

1. 类型：

```ts
export type MultiagentMember =
  | { type: "self" }
  | { type: "agent"; id: string; version: number | null }
  | { type: "advisor"; model: string; instructions: string | null };
export interface MultiagentConfig { type: "coordinator"; agents: MultiagentMember[] }
```

   `AgentManifest.multiagent: null`（L356）改为 `multiagent: MultiagentConfig | null`。
2. `collectErrors` 中 L890–892 替换为 `validateMultiagent(raw, errors)`，规则与错误串与 §6.1.2 **逐字一致**；`normalizeManifestRecord` 中 `multiagent: null,`（L968）替换为 `multiagent: normalizeMultiagent(raw.multiagent)`（与 Python `_normalize_multiagent` 同义：缺失 / null → null）。
3. 6 种事件的 interface 与 `ServerEvent` 联合；`SERVER_EVENT_TYPES` 同序追加；`MA_ERROR_CODES` 追加 `thread_not_found: 404`。对联合类型的 `switch` 补分支并保持 `never` 检查。
4. 常量 `MULTIAGENT_MAX_MEMBERS = 20`、`MAX_ADVISOR_INSTRUCTIONS_BYTES = 8192` 导出（`as const`）。

### 4.14 TS：iam-core 保存时固化成员

1. `agent-manifest-legacy.ts` 新增纯函数（与 `pinTenantSkillVersions` 并列导出）：

```ts
export type MemberAgentInfo = {
  latestVersion: number;
  /** version -> 该版本规范化 manifest 的 multiagent 是否非 null */
  isCoordinatorAt: (version: number) => Promise<boolean | null>;   // null = version not found
};

export async function pinMultiagentMembers(
  normalized: Record<string, unknown>,
  lookup: (agentId: string) => Promise<MemberAgentInfo | null>,
  selfAgentId: string | null,
): Promise<{ manifest: Record<string, unknown>; errors: string[] }>;
```

   规则（错误串逐字）：`multiagent` 为 null → 原样；对每个 `type==="agent"` 成员 `i`：
   - `selfAgentId !== null && id === selfAgentId` → `manifest.multiagent.agents[<i>].id: use {"type":"self"} to reference this agent`
   - `lookup(id)` 为 null → `manifest.multiagent.agents[<i>].id: unknown agent "<id>"`
   - `version` 为 null → 固化为 `latestVersion`
   - `isCoordinatorAt(version)` 为 null → `manifest.multiagent.agents[<i>].version: agent "<id>" has no version <version>`；为 true → `manifest.multiagent.agents[<i>].id: agent "<id>" is a coordinator; only one level of delegation is allowed`
2. `AgentVersionOps` 追加 `findAgentsLatestVersions(tenantId: string, ids: readonly string[]): Promise<Map<string, number>>`（同租户 `enterprise_agents.id ∈ ids` 的 `latest_version`；ids 为空直接返回空 Map），在 PG（`agent-version-ops.ts` 的 drizzle 实现）、内存实现（同文件 `state.agents`）、MySQL（`repos/mysql/agent-version-ops.ts`）三处实现。
3. `prepareManifestWithOps(ops, tenantId, manifest, opts?: { selfAgentId?: string | null })`：在 `pinTenantSkillVersions` 之后、第二次 `validateManifest` 之前：

```ts
  const ids = memberAgentIds(pinned.manifest);          // type==="agent" 的 id 去重
  const latest = await ops.findAgentsLatestVersions(tenantId, ids);
  const members = await pinMultiagentMembers(
    pinned.manifest,
    async (id) => {
      const lv = latest.get(id);
      if (lv === undefined) return null;
      return {
        latestVersion: lv,
        isCoordinatorAt: async (v) => {
          const row = await ops.findVersion(tenantId, id, v);
          if (!row) return null;
          const m = row.manifest.multiagent;
          return m !== null && m !== undefined;
        },
      };
    },
    opts?.selfAgentId ?? null,
  );
  const errors = [...pinned.errors, ...members.errors];
  if (errors.length > 0) return { ok: false, errors: errors.sort() };
```

   原 `if (pinned.errors.length > 0) return …` 一行由上面合并后的判断取代；第二次 `validateManifest` 改为校验 `members.manifest`。
4. 调用处：`agent-versions.ts` `createAgentVersion` 传 `{ selfAgentId: agentId }`；`agents.ts` `createAgentWithInitialVersion` 传 `{ selfAgentId: id }`；`previewAgentManifest` 增加可选第三参 `opts?: { selfAgentId?: string | null }` 并透传。其余调用不变。

---

## 5. Before / After

| 场景 | Before | After（`threads_enabled=True`） |
|---|---|---|
| 保存 `multiagent: {type:"coordinator", agents:[{type:"self"}]}` | 400 `manifest.multiagent: must be null` | 保存成功；规范化后 `agents:[{type:"self"}]` |
| 保存 `agents:[{type:"agent", id:"<B>"}]` | 400 | `version` 被固化为 B 的 `latest_version` |
| 主线程调用 `send_to_agent{"agent":"self","message":"调研 X，写到 out/x.md"}` | 无此工具 | 立即返回 `{"delivered":true,"thread_id":…}`；成员线程独立运行，会话保持 running；完成后主线程收到 `[report from member …]` 并继续；最后才 `status_idle` |
| `GET /sessions/{id}/events` | 全部事件 | 主线程事件 + 4 种 `session.thread_*`；成员完整活动在 `/threads/{tid}/events` |
| `user.interrupt{"thread_id":"<tid>"}` | 被忽略（按全会话打断处理） | 只停该成员线程，主线程收到中断回报 |
| 非 multiagent Agent | — | 事件、接口、状态与改前一致 |

---

## 6. 数据与协议

### 6.1 Manifest `multiagent`

#### 6.1.1 结构

```json
{
  "multiagent": {
    "type": "coordinator",
    "agents": [
      { "type": "self" },
      { "type": "agent", "id": "01JB0000000000000000000ABC", "version": 2 },
      { "type": "advisor", "model": "zhipu/glm-5", "instructions": "关注风险与遗漏" }
    ]
  }
}
```

#### 6.1.2 校验规则与错误串（Python 与 TS 逐字一致；`<i>` 为下标，`<v>` 为原值 JSON 表示）

| # | 条件 | 错误串 |
|---|---|---|
| M1 | `multiagent` 存在、非 null 且不是对象 | `manifest.multiagent: must be null or an object`（其余 M 规则不再检查） |
| M2 | 对象出现 `type` / `agents` 之外的键 | `manifest.multiagent.<k>: unknown field` |
| M3 | `type` 不等于 `coordinator`（含缺失） | `manifest.multiagent.type: must be "coordinator"` |
| M4 | `agents` 缺失或不是数组 | `manifest.multiagent.agents: must be an array`（M5–M17 不再检查） |
| M5 | `agents` 长度为 0 或 > 20 | `manifest.multiagent.agents: must contain 1-20 items`（M6–M17 不再检查） |
| M6 | `agents[i]` 不是对象 | `manifest.multiagent.agents[<i>]: must be an object` |
| M7 | `agents[i].type` 不在 `[self,agent,advisor]`（缺失时 `<v>` 为 `null`） | `manifest.multiagent.agents[<i>].type: must be one of [self,agent,advisor], got <v>`（该条其余字段不再检查） |
| M8 | `self` 条目出现 `type` 之外的键 | `manifest.multiagent.agents[<i>].<k>: unknown field` |
| M9 | 第二个及之后的 `self` | `manifest.multiagent.agents[<i>].type: duplicate self entry` |
| M10 | `agent` 条目出现 `type/id/version` 之外的键 | `manifest.multiagent.agents[<i>].<k>: unknown field` |
| M11 | `agent.id` 缺失或不是非空字符串 | `manifest.multiagent.agents[<i>].id: is required` |
| M12 | `agent.id` 不匹配 `^[A-Za-z0-9._-]{1,64}$` | `manifest.multiagent.agents[<i>].id: must match ^[A-Za-z0-9._-]{1,64}$` |
| M13 | `agent.id` 与之前某个 `agent` 条目相同 | `manifest.multiagent.agents[<i>].id: duplicate agent "<id>"` |
| M14 | `agent.version` 存在、非 null 且不是 ≥1 的整数（布尔不算） | `manifest.multiagent.agents[<i>].version: must be null or an integer >= 1` |
| M15 | `advisor` 条目出现 `type/model/instructions` 之外的键 | `manifest.multiagent.agents[<i>].<k>: unknown field` |
| M16 | `advisor.model` 缺失 → `…model: is required`；不是字符串或不匹配 `MODEL_RE` → `manifest.multiagent.agents[<i>].model: must be "<providerId>/<modelName>"` | 见左 |
| M17 | `advisor.instructions` 存在、非 null 且不是字符串 → `manifest.multiagent.agents[<i>].instructions: must be a string`；UTF-8 字节数 > 8192 → `manifest.multiagent.agents[<i>].instructions: exceeds 8192 bytes`；第二个及之后的 advisor → `manifest.multiagent.agents[<i>].type: duplicate advisor entry` | 见左 |
| M18 | 数组内没有任何「是对象且 `type` 为 `self` 或 `agent`」的条目 | `manifest.multiagent.agents: must include at least one self or agent entry` |

M12 只在 M11 通过时检查；M13 只在 M12 通过时检查。「整数」判定同 MA-00（Python `isinstance(x,int) and not isinstance(x,bool)`；fixture 禁用 `2.0`）。

#### 6.1.3 规范化

`null` / 缺失 → `null`；对象 → `{"type":"coordinator","agents":[...]}`，成员按原序：`{"type":"self"}`、`{"type":"agent","id","version":<int|null>}`、`{"type":"advisor","model","instructions":<str|null>}`。

#### 6.1.4 共享 fixture 变更（`tests/fixtures/managed_agents/manifest_cases.json`）

- 改：原 case `multiagent_not_null`（L515–522）重命名为 `multiagent_empty_object`，期望 `["manifest.multiagent.agents: must be an array", "manifest.multiagent.type: must be \"coordinator\""]`。
- 新增 ok case（必须给完整 `normalized`；hash 由实施者先跑 Python 得出，再把同一份值写进 `tests/managed/test_fixture_parity.py` 与 `managed-agents.test.ts` 的 `EXPECTED_HASHES`）：
  - `multiagent_ok`：`agents` 为 §6.1.1 三项。
  - `multiagent_agent_version_omitted_ok`：`[{"type":"agent","id":"member.a"}]` → normalized `version: null`。
- 新增错误 case（`errors` 以 Python `sorted()` 结果为准写入，下列为期望集合）：
  - `multiagent_not_object`：`"multiagent": "x"` → `manifest.multiagent: must be null or an object`
  - `multiagent_bad_type_and_unknown_key`：`{"type":"swarm","agents":[{"type":"self"}],"x":1}` → `manifest.multiagent.type: must be "coordinator"`、`manifest.multiagent.x: unknown field`
  - `multiagent_agents_empty`：`{"type":"coordinator","agents":[]}` → `manifest.multiagent.agents: must contain 1-20 items`
  - `multiagent_too_many_agents`：21 个 `{"type":"agent","id":"m01"}` … `"m21"` → 同上一条
  - `multiagent_bad_entries`：`agents = ["x", {"type":"team"}, {"type":"agent"}, {"type":"agent","id":"bad id!","version":0}, {"type":"advisor"}, {"type":"advisor","model":"gpt"}, {"type":"self","name":"x"}]` → `agents[0]: must be an object`；`agents[1].type: must be one of [self,agent,advisor], got "team"`；`agents[2].id: is required`；`agents[3].id: must match ^[A-Za-z0-9._-]{1,64}$`；`agents[3].version: must be null or an integer >= 1`；`agents[4].model: is required`；`agents[5].model: must be "<providerId>/<modelName>"`；`agents[5].type: duplicate advisor entry`；`agents[6].name: unknown field`（每条前缀 `manifest.multiagent.`）
  - `multiagent_duplicates`：`[{"type":"self"},{"type":"self"},{"type":"agent","id":"A1"},{"type":"agent","id":"A1","version":2}]` → `manifest.multiagent.agents[1].type: duplicate self entry`、`manifest.multiagent.agents[3].id: duplicate agent "A1"`
  - `multiagent_no_delegate`：`[{"type":"advisor","model":"a/b"}]` → `manifest.multiagent.agents: must include at least one self or agent entry`
  - `multiagent_advisor_instructions_bad`：`[{"type":"self"},{"type":"advisor","model":"a/b","instructions":5}]` → `manifest.multiagent.agents[1].instructions: must be a string`
  - 另由两端测试代码动态生成 `multiagent_advisor_instructions_oversize`（8193 个 `a`）→ `…instructions: exceeds 8192 bytes`

### 6.2 事件（全部落库占 seq）

| type | 信封 `thread_id` | 关键字段 | 会话流可见 |
|---|---|---|---|
| `session.thread_created` | 新线程 id | `agent{type, agent_id?, agent_version?, name?, model?}`、`parent_thread_id`（v1 恒 null） | 是 |
| `session.thread_status_running` | 成员线程 id | — | 是 |
| `session.thread_status_idle` | 成员线程 id | `stop_reason{type, event_ids:[]}` | 是 |
| `session.thread_status_terminated` | 成员 / advisor 线程 id | `reason` ∈ `completed` / `archived` / `context_lost` / `host_restarted` / `session_closed` | 是 |
| `agent.thread_message_sent` | 发送方所在线程（主线程 null） | `to_thread_id`、`to_agent_name`、`content[]` | 仅主线程发出的那条 |
| `agent.thread_message_received` | 接收方所在线程 | `from_thread_id`、`from_agent_name`、`content[]` | 仅主线程收到的那条 |

示例（主线程委派）：

```json
{"seq": 41, "type": "agent.thread_message_sent", "to_thread_id": "01JB8...T1", "to_agent_name": "调研助手",
 "content": [{"type": "text", "text": "调研 X，结论写到 out/x.md"}]}
{"seq": 42, "type": "session.thread_created", "thread_id": "01JB8...T1",
 "agent": {"type": "agent", "agent_id": "01JB0...ABC", "agent_version": 2, "name": "调研助手"}, "parent_thread_id": null}
```

（实现中 `thread_created` 先于 `thread_message_sent` 落库；上例仅示意字段。）

### 6.3 平台工具（主线程）

`list_agents` → 无参数。返回：

```json
{"agents": [
  {"agent": "self", "type": "self", "name": "协调者", "description": null, "available": true,
   "threads": [{"thread_id": "01J...", "status": "idle"}]},
  {"agent": "01JB0...ABC", "type": "agent", "name": "调研助手", "version": 2, "description": "...",
   "available": false, "unavailable_reason": "agent is disabled", "threads": []}
 ],
 "advisor_available": true}
```

`send_to_agent` schema：

```json
{"type": "function", "function": {"name": "send_to_agent",
  "description": "Delegate a task to a member agent. Returns immediately with a thread_id; the member works in its own context, shares the session files, and reports back automatically. Give input paths, constraints, and the expected output.",
  "parameters": {"type": "object", "properties": {
    "agent": {"type": "string", "description": "\"self\" or a member agent id from list_agents."},
    "message": {"type": "string"},
    "thread_id": {"type": "string", "description": "Follow up on an existing thread of this member."},
    "new_thread": {"type": "boolean", "description": "Start another copy instead of reusing the latest thread."}},
   "required": ["agent", "message"]}}}
```

成功返回：`{"delivered": true, "thread_id": "<tid>", "agent": "<key>", "queued": <bool>, "note": "The member will report back automatically. Continue other work or end your turn; do not poll."}`

错误返回（逐字，`ERROR:` 前缀的纯文本）：
- `ERROR: unknown agent "<agent>"; call list_agents first`
- `ERROR: agent "<agent>" is not available (<unavailable_reason>)`
- `ERROR: message is required` / `ERROR: message exceeds 32000 characters`
- `ERROR: thread <tid> does not belong to agent "<agent>"`
- `ERROR: thread <tid> is terminated`
- `ERROR: thread limit reached (25 active threads per session); archive idle threads first`

`list_agents` schema：`{"type":"function","function":{"name":"list_agents","description":"List member agents you can delegate to, with their threads.","parameters":{"type":"object","properties":{},"required":[]}}}`。

`advisor` schema：`{"type":"function","function":{"name":"advisor","description":"Ask the advisor for a one-off review of the conversation so far. Returns advice text.","parameters":{"type":"object","properties":{"question":{"type":"string"}},"required":[]}}}`。

### 6.4 线程接口 JSON

```json
{"id": "<thread id; primary = session id>", "session_id": "01J...", "is_primary": false,
 "parent_thread_id": "<session id>",
 "agent": {"type": "agent", "agent_id": "01JB0...ABC", "agent_version": 2, "name": "调研助手"},
 "status": "idle", "stop_reason": {"type": "end_turn", "event_ids": []},
 "terminated_reason": null, "archived_at": null, "created_at": "2026-11-02T08:00:00.000Z"}
```

- 主线程：`id = session_id`、`is_primary: true`、`parent_thread_id: null`、`agent: {"type": "primary", "agent_id": <session.agent_id>, "agent_version": <session.agent_version>}`，`status` 由会话状态映射（`running`/`rescheduling` → `running`；`idle` → `idle`；`terminated`/`archived` → `terminated`），`stop_reason` = 会话 `stop_reason`。
- `archived_at` = `reason=="archived"` 那条 terminated 事件的 `created_at`；`include_archived=false` 时不返回 archived 线程（其它 terminated 线程照常返回）。
- 归档：主线程 → 400 `invalid_request`（`primary thread cannot be archived`）；running → 400 `invalid_request`（`thread must be idle to archive`）；已 terminated → 200 原样（幂等）；advisor 线程同成员线程规则。
- 未知线程 → 404 `thread_not_found`；跨租户 / 不存在的会话 → 404 `session_not_found`。

---

## 7. FR / NFR / AC

| ID | 需求 | AC（测试文件 :: 用例 :: 断言） |
|---|---|---|
| FR-1 | Python 校验 | `tests/managed/test_manifest.py::test_manifest_cases`（参数化，含 §6.1.4 全部新 case）通过；`::test_multiagent_instructions_oversize` |
| FR-2 | TS 校验同语义 | `managed-agents.test.ts` 的 `manifest cases` 通过；`hash matches python` 中新 ok case 两端 hash 相同；新增 `multiagent instructions oversize` |
| FR-3 | null 不变 | `test_fixture_parity.py::test_manifest_hashes_match_ts` 中**既有** case 的 hash 值未改动（diff 只新增键） |
| FR-4 | 自引用 | `tests/managed/test_spec.py::test_multiagent_self_reference_rejected`（`compile_spec("A", 1, m)`，m 含 `{"type":"agent","id":"A"}` → `details.errors` 含 `manifest.multiagent.agents[0].id: use {"type":"self"} to reference this agent`）；`::test_custom_tool_conflicts_with_list_agents` |
| FR-5 | 保存固化 | `iam-core/src/repos/__tests__/agent-versions.test.ts`：`pins member version to latest`（内存 ops：B latest=3 → 保存后 manifest `agents[0].version===3`）；`rejects unknown member`；`rejects coordinator member`（B v3 的 manifest `multiagent` 非 null → 错误串逐字）；`rejects missing member version`（`version:9`）；`rejects self reference on createAgentVersion`；`previewAgentManifest without selfAgentId does not report self reference` |
| FR-6 | 线程委派与回报 | `tests/managed/test_threads.py::test_send_to_agent_runs_member_and_reports_back`（`create_ma_app` + `ThreadScriptFactory`，`HostConfig(threads_enabled=True)`，dev agents：协调者 C（`multiagent` 含 `self` 与成员 B）；primary 脚本：step1 `send_to_agent{"agent":"B","message":"write hi to out/b.txt"}`、step2 文本 `waiting`、step3 文本 `all done`；`agent:B` 脚本：step1 `file_write{"path":"out/b.txt","content":"hi"}`、step2 文本 `wrote it`。断言：工具结果 JSON `delivered==true`；会话工作目录下 `out/b.txt` 内容为 `hi`（共享工作目录）；会话流事件类型顺序包含 `agent.thread_message_sent` → `session.thread_created` → `session.thread_status_running` → `session.thread_status_idle` → `agent.thread_message_received`（`from_agent_name` 为 B 的 display_name）→ `agent.message("all done")` → `session.status_idle(end_turn)`；会话流中**没有** `thread_id` 非空的 `agent.tool_use`；只有一条 `session.status_running`；primary 第三次 LLM 调用的最后 user 消息以 `[report from member` 开头且含 `wrote it`） |
| FR-7 | 线程接口 | `tests/managed/test_thread_routes.py::test_threads_list_get_events`（同上会话：`GET /threads` 返回 2 条，主线程 `id==session_id`、`is_primary`；成员线程 `agent.agent_id=="B"`、`status=="idle"`；`GET /threads/{tid}/events` 含 `agent.tool_use(name=file_write)` 且每条 `thread_id==tid`；`GET /threads/{session_id}/events` 不含 `thread_id` 非空事件；`GET /threads/bogus` → 404 `thread_not_found`） |
| FR-8 | 线程 SSE | `::test_thread_stream_replays_and_filters`（`after_seq=0` 打开成员线程流：收到的每帧 `data.thread_id==tid`，帧 `id` 为会话 seq；`Last-Event-ID` 续流不重复；会话流同时打开时不出现成员内部事件） |
| FR-9 | 复用 / 新建 / 定向 | `test_threads.py::test_reuse_latest_thread_and_new_thread`（两次 send 给 `self` → 同一 tid；第三次 `new_thread:true` → 新 tid；`thread_id` 指向 B 的线程但 `agent:"self"` → 错误串逐字） |
| FR-10 | 线程上限 | `::test_thread_limit`（把 `MAX_ACTIVE_THREADS` monkeypatch 为 2：第二个新线程返回 `ERROR: thread limit reached (25 active threads per session); archive idle threads first`——文本中的 25 为常量文案，测试断言前缀 `ERROR: thread limit reached`） |
| FR-11 | 成员不可用 | `::test_disabled_member_unavailable`（B `status=disabled` → `list_agents` 中 `available==false`、`unavailable_reason=="agent is disabled"`；send → `ERROR: agent "B" is not available (agent is disabled)`） |
| FR-12 | 成员权限 | `::test_member_ask_tool_denied_and_custom_hidden`（B 的 manifest `bash_exec: always_ask` 且有 custom 工具 `lookup`：B 的 LLM 收到的工具名不含 `lookup`；B 调 `bash_exec` → 成员线程 `agent.tool_result.is_error==true`，文本含 `requires approval, which member threads do not support`；会话状态从未出现 `requires_action`） |
| FR-13 | 一层委派 | `::test_self_copy_has_no_delegation_tools`（self 线程 LLM 收到的工具名不含 `list_agents` / `send_to_agent` / `advisor` / `task_list`） |
| FR-14 | advisor | `::test_advisor_one_shot`（primary 调 `advisor{"question":"risks?"}`，advisor 脚本返回 `check inputs`：工具结果为 `check inputs`；出现 advisor 线程的 `session.thread_created(agent.type=="advisor")`、`session.thread_status_terminated(reason=="completed")`；主线程 `agent.thread_message_received(from_agent_name=="advisor")`；`list_agents` 不列出 advisor；advisor 线程不计入上限） |
| FR-15 | 定向打断 | `::test_interrupt_member_thread_only`（B 脚本 step1 `bash_exec{"command":"sleep 5"}` → 主线程发 `user.interrupt{"thread_id": tid}`：B 线程 `status_idle`；主线程收到回报文本 `[member thread interrupted by user]` 并开下一回合；会话未出现中间 `session.status_idle`） |
| FR-16 | 全部打断 | `::test_interrupt_all_stops_members_no_report`（不带 thread_id → 会话 `status_idle(end_turn)`；之后 1 秒内无 `agent.thread_message_received` 与新的 `session.status_running`） |
| FR-17 | 批量校验 | `::test_thread_targeting_validation`（`user.message` 带 thread_id → 400 `invalid_event_batch` 且消息 `events[0]: only user.interrupt may target a thread`、零写入；interrupt 带未知 / 会话 id → `events[0]: unknown thread`） |
| FR-18 | 建会话限制 | `::test_create_session_rejections`（`threads_enabled=False` → 400 `multiagent is not enabled on this host`；`desktop_worker` 环境 → 400 `multiagent agents require a cloud environment`；带 `vault_ids` → 400 `multiagent sessions do not support vault_ids or resources yet`；非 multiagent Agent 在 `threads_enabled=False` 时照常 201） |
| FR-19 | 用量合并 | `::test_session_usage_includes_members`（primary 每次调用 10/5 tokens、B 每次 7/3，脚本 FakeUsage：`ma_sessions` 记录 `usage.input_tokens` = 主线程累计 + B 累计；最后一条主线程 `session.usage` 与记录一致；成员线程 `session.usage` 的 `thread_id==tid`） |
| FR-20 | 重启 | `::test_load_marks_member_threads_context_lost`（预置 `session.thread_created` 无 terminated 的会话，新 actor 首回合 → 出现 `session.thread_status_terminated(reason=="context_lost")`） |
| FR-21 | 归档 | `test_thread_routes.py::test_archive_rules`（主线程 400；running 400；idle → 200 且 `archived_at` 非空；重复 200；`include_archived=false` 列表不含它） |
| FR-22 | effect guard 隔离 | `test_threads.py::test_member_effect_guard_key_isolated`（成员 bundle `session.session_id == sid` 且 `session._session_id == f"{sid}.{tid}"`；`effect_guard.resolve_session_id(session) == f"{sid}.{tid}"`） |
| FR-23 | 存储过滤 | `tests/managed/test_sqlite_store.py::test_list_events_thread_filter`（三种过滤结果集合）；`enterprise/apps/agent-runtime/tests/test_pg_event_store_contract.py::test_list_events_thread_filter`（同断言，PG 实库用例按该文件既有 skip 规则） |
| FR-24 | 状态机 | `tests/managed/test_state_machine.py::test_targeted_interrupt_effect_keeps_state`（running / requires_action 两种状态下，带 thread_id 的 interrupt → `effects == (InterruptTurn((), thread_id="T"),)`，`final.status` 与 pending 不变） |
| FR-25 | 协议常量 | `test_protocol.py` L110 样例补 6 项后通过；`test_constants_match_ts_source` 通过（含 `thread_not_found`） |
| NFR-1 | 既有行为不变 | `pytest tests/managed -q` 全绿（含 `test_w1_gate_e2e.py`、`test_w1_gate_worker_e2e.py`、`test_host_sse.py`）；`pytest tests/test_studio_server.py -q`（三个既有失败除外） |
| NFR-2 | 门户兼容 | 不改 `enterprise/apps/web-portal`；`pnpm -C enterprise --filter @agenticx/web-portal test` 全绿 |

集成测试统一 `AGX_EFFECT_GUARD=0`（FR-22 除外，它只断言键值不跑工具）、`tmp_path` 数据目录、单用例 ≤ 10 秒。

---

## 8. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
pytest tests/managed/test_manifest.py tests/managed/test_fixture_parity.py tests/managed/test_spec.py tests/managed/test_state_machine.py tests/managed/test_sqlite_store.py -q
AGX_EFFECT_GUARD=0 pytest tests/managed/test_threads.py tests/managed/test_thread_routes.py -q
pytest tests/managed -q
pnpm -C enterprise --filter @agenticx/core-api test && pnpm -C enterprise --filter @agenticx/core-api typecheck
pnpm -C enterprise --filter @agenticx/iam-core test && pnpm -C enterprise --filter @agenticx/iam-core typecheck
pnpm -C enterprise --filter @agenticx/admin-console typecheck
pnpm -C enterprise --filter @agenticx/web-portal test
(cd enterprise/apps/agent-runtime && PYTHONPATH="/Users/damon/myWork/AgenticX:$PWD" pytest tests -q)

# 手工演示（dev 宿主）
D=$(mktemp -d); agx ma serve --dev --enable-threads --enable-tasks --data-dir "$D" --agents-file agents.multi.yaml --port 18092 --token dev-token &
# 建 C 的会话，发「请让 self 副本调研 A、成员 B 调研 B，最后汇总」；分别订阅 /events/stream 与 /threads/<tid>/events/stream 对照
```

---

## 9. 回滚

- 运行时开关：`HostConfig.threads_enabled` / `MA_RUNTIME_THREADS_ENABLED`（默认关）。关闭后：不创建 `ThreadManager`，带 multiagent 的 Agent 建会话 400，其余会话行为不变（会话流过滤对无线程事件的会话恒为真）。
- 校验器放宽无开关：回滚需 `git revert` 本子规划的 manifest / fixture / iam-core 改动；已保存的协调者版本会在回滚后的校验器下变为非法（只影响编辑与建会话，读历史版本不受影响），回滚说明中写明需先把这些 Agent 发布一个 `multiagent: null` 的新版本。
- 代码回滚：删除 `threads.py`、两个新测试文件，`git checkout` 其余修改文件。

---

## 10. 不变量

1. `multiagent` 为 null / 缺失的 Manifest：校验结果、规范化输出与 `manifest_hash` 与改前逐字相同。
2. 非 multiagent 会话：`/events`、`/events/stream`、状态序列与改前一致。
3. 每个 running 区间只有一条 `session.status_running`；`session.status_idle` 发出时没有运行中的成员线程、没有未处理的回报。
4. 成员线程事件的 `thread_id` 恒非 null；主线程事件恒为 null。
5. 成员线程永远不会让会话进入 `requires_action`。
6. Near 个人模式（`/api/chat`、委派、分身）与 `agenticx/runtime/meta_tools.py` 不变。
7. 成员与 advisor 的每次模型调用仍经 `LLMFactory`（企业部署即网关），并带 `X-AgenticX-Thread-Id`。

---

## 11. 须回写 master / 登记 §12 / 待用户确认

- **回写 master §5.1**：把「`multiagent` 在 MA-A08 之前必须为 `null`；结构由 MA-A08 定义并回写本节」替换为：「`multiagent` 为 `null` 或 `{type:"coordinator", agents:[…]}`，`agents` 1–20 项，成员为 `{type:"self"}`（至多一个）、`{type:"agent", id, version?}`（id 不重复；`version` 省略时由企业保存路径固化为该 Agent 当时最新版本；成员不得自身为协调者；不得引用自身，自身用 `self`）、`{type:"advisor", model, instructions?}`（至多一个，instructions ≤ 8 KiB）；至少一个 `self` 或 `agent`。校验规则与错误串见 MA-A08 §6.1.2」，并把 §5.1 JSON 示例中的 `"multiagent": null` 旁注「或见上」。
- **登记 §12**：① §6.1 事件表新增 6 种线程事件与字段（MA-A08 §6.2）；② 会话级事件接口与 SSE 只返回主线程事件 + 4 种线程摘要，成员线程活动经新增的 5 个 `/threads*` 接口读取；③ 新错误码 `thread_not_found` 404；④ `user.interrupt.thread_id` 只允许指向成员线程，其它客户端事件带 `thread_id` 整批 400；⑤ v1 限制：仅 cloud 环境、成员线程不支持审批 / 自定义工具 / 后台任务、multiagent 会话不支持 `vault_ids` / `resources`；⑥ 共享 fixture `multiagent_not_null` 改名为 `multiagent_empty_object` 且期望值变化；⑦ 不复用 `delegate_to_avatar` 代码的理由（§2 D1）；⑧ 依赖 MA-A09。
- **待确认**：Q1 v1 拒绝 multiagent 会话挂 Vault / 记忆（D9），是否接受并另起 MA-A08b；Q2 成员线程直接拒绝 `always_ask` 工具（D7）而不是把审批升级到主线程，是否接受；Q3 管理台本轮不提供 multiagent 的表单编辑（只能经 API / JSON），是否接受。
