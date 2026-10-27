# MA-A10 记忆整理（Dream）：记忆库 + 历史会话 + 指令 → 独立的新记忆库，管理员审核后才可挂载

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W6，编号 MA-A10）
Depends-on: MA-E07（记忆库控制面，已在工作区实施，以实际实现为准）、MA-A07（pending：`agenticx/managed/memory.py` 的 `validate_memory_path` 与挂载校验，以实际实现为准，实施前核对）、MA-E03（已实施）
可选复用：MA-E12 的 `enterprise/apps/admin-console/src/lib/ma/runtime-internal-client.ts`（若已合入直接复用，否则按 §4.6 新建同名同内容文件）
栈：Python（框架整理逻辑 + agent-runtime 任务执行与接口 + 迁移）+ TS（admin-console：3 个内部接口、记忆库校验接口一处改动、记忆库页面的发起与审核入口）

> 风险等级：中。整理结果写入**新的独立记忆库**，不修改输入记忆库；新库在管理员审核通过前不能挂载到任何会话。全部能力默认关闭（`MA_RUNTIME_DREAMS_ENABLED`）。

---

## 0. 一句话目标

给定一个输入记忆库、1–100 个历史托管会话和一段整理指令，agent-runtime 在后台用指定模型（经企业网关）把「已有记忆 + 会话中的稳定结论」合并、去重、按主题重组，产出一个**新的记忆库**（与输入库互相独立，带来源标记、默认「待审核」）；管理员在管理台记忆库页面查看整理结果后选择「通过审核」（之后才可挂载到会话）或「丢弃」（归档）。

---

## 1. 根因 / 动机与证据链

### 1.1 来自 master 的约束

| master 位置 | 内容 | 本文落点 |
|---|---|---|
| §3.3 缺口表「记忆整理（Dream）」 | 火山有；框架有 learning 子系统 | 本文 |
| §9 MA-A10 行 | 「输入 Memory Store + 1–100 个历史会话 + 指令，后台产出新的 Memory Store（与输入独立），复用 `agenticx/learning/`」 | §2 D1–D4 |
| §2.3 + §12「记忆表 admin-console 单一物理写入方 + CAS，agent-runtime 经内部接口读写」 | agent-runtime 不直连记忆表 | 输出库的创建与写入走 admin-console 新内部接口（§4.5） |
| §12 记忆限额 | 每库 2000 条 / 20 MiB / 单条 100 KiB | 整理结果另设更小的 v1 上限（§2 D7） |
| §4 决策 3 | 模型调用经网关 | 用 agent-runtime 的 `GatewayLLMFactory` |
| master §0 规则 1 | 最多两个栈 | Python + TS；admin-console 改动为内部接口与记忆库页面的小入口，须登记 §12（同 MA-D01 的例外写法） |

### 1.2 调研语义（`research/managed-agents/volcengine/dream-overview.md`）

- L10–18：用途——定期整理、从历史会话冷启动、提炼主题、跨用户沉淀（剥离身份）。
- L19–21：不适合改一条记忆或会话中实时记录。
- L24–29：输入记忆库（可为空库）、1～100 个历史会话、Instructions、后台执行、**输出记忆库与输入互相独立**。
- L31–33 与流程图：验收通过后挂载到新会话，未通过时删除输出。
- L44–46：若 Instructions 未要求剥离身份信息，输出可能保留。
- L107：任务处于 pending / running 时不能读取、修改或挂载输出库。
- L113–121：状态 pending / running / completed / failed / canceled；最长执行时长后 failed，`error.type=timeout`。

### 1.3 现状代码证据（2026-10-25 核对，实施前重新核对行号）

| 文件 | 行 | 现状 | 结论 |
|---|---|---|---|
| `enterprise/packages/iam-core/src/repos/ma-memory.ts` | 47–53、634–672、968–995、1080–1110 | `MaMemoryStore.metadata: Record<string,string>`；`createMemoryStore(tenant, {name, description, metadata}, actor)`；`applyMemoryWrite(tenant, store, op, actor)`；`snapshotMemoryStore`；`validateMemoryStoreIds` 返回 `active|archived|missing` | 输出库用 `metadata` 标记来源与审核态；批量导入复用 `applyMemoryWrite` |
| `enterprise/packages/iam-core/src/repos/ma-memory-path.ts` | 21–28 | `MemoryActor = {kind:"user", userId} | {kind:"agent", userId, sessionId}` | 整理写入以「发起人」`kind:"user"` 记录（没有会话可挂） |
| `enterprise/apps/admin-console/src/app/api/internal/ma/memory-stores/` | `validate/route.ts`、`[storeId]/snapshot`、`[storeId]/writes` | 快照与写入都要求「会话挂载了该库」 | 整理任务没有会话 → 需要新的内部导出 / 创建 / 完成接口 |
| `.cursor/plans/pending/2026-10-25-ma-a07-memory-mount.plan.md` | §5.1 L209–262 | `validate_memory_path(raw)`、`MEMORY_CONTENT_MAX_BYTES=102400`；挂载前调 `validate_store_ids` | 路径规则复用；挂载校验遇到非 `active` 状态即拒绝（以实际实现为准） |
| `agenticx/learning/session_review_hook.py` | 124–143 | `_truncate_content` / `_truncate_history`：会话复盘前截断历史 | 同一截断思路（本文自带常量，不 import 私有函数） |
| `agenticx/learning/skill_quality_gate.py` | 136–149、171–200 | 质量门禁：guard 扫描、大小限制 | 输出记忆逐条过门禁（§4.1 `gate_memories`） |
| `agenticx/skills/guard.py` | 85–97、176–210 | `scan_skill_markdown_text(text, source=...)`、`should_allow(result, source)` | 复用为「疑似泄露凭证 / 注入内容」拦截 |
| `agenticx/learning/gepa_proposer.py` | 82–113 | 模型返回 JSON 的容错解析 | 同一解析模式 |
| `enterprise/apps/agent-runtime/ma_agent_runtime/pg_event_store.py` | 345–368 | agent-runtime 是会话事件唯一写入方，可直接读 | 历史会话文本在 agent-runtime 进程内读取 |
| `enterprise/apps/agent-runtime/ma_agent_runtime/app.py` | 38–129 | 应用装配；`app.state.ma.startup_hooks` / `shutdown_hooks` | 挂整理执行器 |
| `enterprise/deploy/nginx/gateway.conf` | 95–112 | `/ma/v1/(agents|environments|vaults|memory_stores|schedules|channels)` → admin-console，其余 `/ma/v1/` → agent-runtime | `/ma/v1/memory_dreams` 自然落到 agent-runtime，nginx 无需改 |

---

## 2. 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **执行方式 = agent-runtime 后台任务**（新表 `ma_memory_dreams`，agent-runtime 唯一写入），不是托管会话 | 会话需要真实 Agent（`ma_sessions.agent_id` 外键到 `enterprise_agents`），为整理伪造系统 Agent 会污染 Agent 列表；整理不需要工具循环 |
| D2 | **算法 = 分批增量合并**：工作集初始为输入库全部记忆；会话按文本量切批（每批 ≤ 60000 字符）；每批调用一次模型，输入「指令 + 当前工作集 + 本批会话」，要求返回**完整的新工作集** JSON；最后一批结果过门禁后一次性写入输出库 | 单次上下文可控；「返回完整工作集」便于去重与重组；全有或全无写入，失败不留半成品 |
| D3 | **复用 learning 模式**：截断策略（同 `session_review_hook`）、逐条质量门禁（同 `skill_quality_gate`：大小、去重、`agenticx.skills.guard` 扫描）、JSON 容错解析（同 `gepa_proposer`） | master §9 要求复用 `agenticx/learning/`；但不 import 其私有函数，避免把个人模式配置（`learning:` 节）带进企业运行时 |
| D4 | **输出库独立**：创建任务时即由 admin-console 新建输出库（`metadata`：`agx.origin=dream`、`agx.dream_id=<id>`、`agx.review=running`），返回其 id；完成时导入并把 `agx.review` 改为 `pending`；失败 / 取消时归档并标 `failed` / `cancelled`；输入库零写入 | 调研 L24–29、L107 |
| D5 | **审核闸门**：admin-console 的 `validateMemoryStoreIds` 对 `agx.review ∈ {running, pending, failed, cancelled}` 的库返回新状态 `pending_review`；A07 的挂载校验把非 `active` 视为不可挂载 → 审核通过前任何会话都挂不上。「通过审核」= 把 `agx.review` 改为 `approved`；「丢弃」= 归档 | 调研流程图「验收通过后挂载」；把闸门放在唯一的挂载校验入口，不必改 A07 |
| D6 | **身份与隐私**：不自动脱敏；指令输入框给默认提示「删除姓名、邮箱、手机号、订单号等个人身份信息」；guard 扫描命中凭证类内容的条目直接拒绝并记入报告 | 调研 L44–46；凭证类必须拦 |
| D7 | **v1 上限**：会话 1–100 个；指令 1–8000 字符；输入库 ≤ 300 条且总 ≤ 200 KiB（超出 → 任务失败 `input_too_large`）；输出 ≤ 300 条、单条 ≤ 100 KiB、总 ≤ 200 KiB；每会话文本 ≤ 20000 字符（单条消息 ≤ 4000）；总时长 `MA_DREAM_TIMEOUT_SECONDS`（默认 7200） | 工作集要整份放进每次提示词；更大规模需要检索式整理，列入后续 |
| D8 | 历史会话只读**主线程**的 `user.message` / `agent.message` 文本（`thread_id` 为空）；不存在 / 不属于本租户的会话记入 `report.sessions_missing` 并跳过；全部不可用 → 失败 `no_sessions` | 工具结果噪声大且可能含敏感数据 |
| D9 | 接口：公开 `/ma/v1/memory_dreams*`（PAT：创建需 `ma:memory:write` + `ma:sessions:read`，查询需 `ma:memory:read`）；管理台经 agent-runtime 内部接口 `/internal/ma/memory-dreams`（`MA_INTERNAL_TOKEN`）发起 | 与 MA-E12 内部接口同模式；不新增 PAT scope |
| D10 | 多副本与重启：`FOR UPDATE SKIP LOCKED` 领取；15 秒心跳；心跳过期 120 秒的 running 任务退回 pending 从头重跑（输出库此时仍为空，重跑安全） | 全有或全无写入使重跑幂等 |
| D11 | 取消：pending → 立即 cancelled 并归档输出库；running → 置取消标记，在下一批之前停止 | 调研 L113–121 |

---

## 3. In scope / Out of scope

### 3.1 In scope（只能创建或修改这些文件）

框架（Python）：
- 新建 `agenticx/managed/memory_dream.py`
- 新建 `tests/managed/test_memory_dream.py`

agent-runtime（Python）：
- 新建 `enterprise/apps/agent-runtime/ma_agent_runtime/memory_dreams.py`
- 修改 `ma_agent_runtime/tables.py`（1 张表）、`ma_agent_runtime/config.py`（3 个环境变量）、`ma_agent_runtime/app.py`（`if settings.dreams_enabled: wire_dreams(...)` 一段）
- 新建 `enterprise/apps/agent-runtime/tests/test_memory_dreams.py`；修改 `tests/test_tables_parity.py`（`_WANTED` 加表、读本迁移文件）、`tests/test_config.py`

db-schema（迁移，随本子规划）：
- 新建 `enterprise/packages/db-schema/drizzle/<PG>_ma_memory_dreams.sql`、`drizzle-mysql/<MY>_ma_memory_dreams.sql`；修改两份 `meta/_journal.json`
- 新建 `src/schema/ma-memory-dreams.ts`、`src/mysql-schema/ma-memory-dreams.ts`；两份 `index.ts` 各加一行
- 修改 `src/__tests__/schema-parity.test.ts`、`migration-inventory.test.ts`、`ma-schema.test.ts`

iam-core（TS）：
- 修改 `enterprise/packages/iam-core/src/repos/ma-memory.ts`：`validateMemoryStoreIds` 增加 `pending_review` 状态（§4.5.4）；新增 `exportMemoryStoreForDream`、`createDreamOutputStore`、`finishDreamOutputStore`、`setDreamReviewDecision`（§4.5）
- 新建 `enterprise/packages/iam-core/src/repos/ma-memory-dreams-read.ts`（只读 `ma_memory_dreams`）；修改 `src/index.ts`
- 修改 `src/repos/__tests__/`下记忆库测试文件（与 E07 同文件，追加用例；文件名以 E07 实际为准）

admin-console（TS）：
- 新建内部接口：`src/app/api/internal/ma/memory-stores/[storeId]/export/route.ts`、`src/app/api/internal/ma/memory-stores/dream-output/route.ts`（POST 创建输出库）、`src/app/api/internal/ma/memory-stores/[storeId]/dream-finish/route.ts`
- 修改 `src/app/api/internal/ma/memory-stores/validate/route.ts`（透传新状态，若该路由直接返回 `validateMemoryStoreIds` 结果则无需改代码，只补测试）
- 新建管理台接口：`src/app/api/admin/ma-memory-stores/[storeId]/dreams/route.ts`（GET 列表 / POST 发起）、`src/app/api/admin/ma-memory-stores/[storeId]/review/route.ts`（POST 审核决定）、`src/app/api/admin/ma-memory-dreams/[dreamId]/cancel/route.ts`
- 新建（或复用 MA-E12 的）`src/lib/ma/runtime-internal-client.ts`
- 修改 `src/app/admin/_sections/agent-memory.tsx`（三处 UI 入口，§4.7）；新建 `src/components/agent-memory/DreamDialog.tsx`、`DreamHistory.tsx`、`DreamReviewBanner.tsx`
- 修改 `messages/zh.json`、`messages/en.json`（`agentMemory.dream.*` 键块）
- 新建测试：`src/app/api/internal/ma/__tests__/memory-dream-internal-routes.test.ts`、`src/app/api/admin/ma-memory-stores/__tests__/dreams-route.test.ts`、`src/components/agent-memory/DreamReviewBanner.test.tsx`

文档：
- 修改 `docs/managed-agents/protocol.md`（追加「记忆整理（MA-A10）」一节）

### 3.2 Out of scope

- 超出 D7 上限的检索式 / 分片式整理；定时自动整理（可由 MA-E08 调度后续接入）。
- 自动脱敏、跨租户整理、按用户 / 部门限定输入范围。
- 修改输入记忆库、修改 A07 挂载代码、修改 E07 公共 `/api/ma/v1/memory_stores*` 行为（仅 `validate` 内部接口多一个状态值）。
- Near 桌面任何改动；本机个人记忆（`~/.agenticx/workspace`）的整理。
- 不 import `agenticx/learning/*` 的私有函数，不读取 `learning:` 配置节。

---

## 4. 精确落点

### 4.1 新建 `agenticx/managed/memory_dream.py`

```python
MAX_DREAM_SESSIONS = 100
MAX_INSTRUCTIONS_CHARS = 8000
MAX_DREAM_MEMORIES = 300
MAX_DREAM_TOTAL_BYTES = 204800
MAX_MEMORY_CONTENT_BYTES = 102400
MAX_MESSAGE_CHARS = 4000
MAX_SESSION_CHARS = 20000
BATCH_CHARS = 60000
DEFAULT_INSTRUCTIONS_HINT = (
    "保留稳定的偏好、约定与已验证的结论；删除重复、过期和互相矛盾的内容；"
    "删除姓名、邮箱、手机号、订单号等个人身份信息；按主题组织为若干文件。"
)


@dataclass(frozen=True)
class DreamMemory:
    path: str
    content: str


@dataclass(frozen=True)
class SessionTranscript:
    session_id: str
    title: str | None
    text: str               # "user: ...\nassistant: ..." lines, <= MAX_SESSION_CHARS


@dataclass
class DreamOutcome:
    memories: list[DreamMemory]
    rejected: list[dict[str, str]]       # [{"path", "reason"}]
    notes: str
    batches: int


class DreamError(Exception):
    def __init__(self, error_type: str, message: str) -> None: ...


def transcript_from_events(session_id: str, title: str | None,
                           events: Sequence[Mapping[str, Any]]) -> SessionTranscript | None: ...
def batch_transcripts(transcripts: Sequence[SessionTranscript]) -> list[list[SessionTranscript]]: ...
def check_input_memories(memories: Sequence[DreamMemory]) -> None: ...          # raises DreamError("input_too_large", ...)
def build_dream_messages(*, instructions: str, memories: Sequence[DreamMemory],
                         batch: Sequence[SessionTranscript], batch_index: int, batch_count: int) -> list[dict[str, str]]: ...
def parse_dream_response(text: str) -> tuple[list[DreamMemory], str] | None: ...
def gate_memories(memories: Sequence[DreamMemory]) -> tuple[list[DreamMemory], list[dict[str, str]]]: ...
async def consolidate(*, memories: Sequence[DreamMemory], transcripts: Sequence[SessionTranscript],
                      instructions: str, invoke: Callable[[list[dict[str, str]]], Awaitable[str]],
                      should_stop: Callable[[], bool]) -> DreamOutcome: ...
```

实现规则（逐条）：
- `transcript_from_events`：只取 `type ∈ {user.message, agent.message}` 且 `thread_id` 为空（缺失视为空）；文本 = content 中 `type=="text"` 块拼接；每条截 `MAX_MESSAGE_CHARS`；行格式 `user: <text>` / `assistant: <text>`；累计超 `MAX_SESSION_CHARS` 时**保留最后**的部分（从最旧行开始丢弃）；无任何行 → None。
- `batch_transcripts`：顺序装箱，一批累计 `len(text)` ≤ `BATCH_CHARS`；单个会话本身已 ≤ 20000，不拆分。
- `check_input_memories`：条数 > 300 或 UTF-8 总字节 > 204800 → `DreamError("input_too_large", "input memory store exceeds the dream limit (300 memories / 200 KiB)")`。
- `build_dream_messages` 返回 `[{"role":"system", …}, {"role":"user", …}]`，system 文本逐字：

```
You consolidate long-term memory for an AI agent team.
You receive the current memory files, a batch of past conversations, and instructions.
Return the COMPLETE new set of memory files as JSON and nothing else:
{"memories": [{"path": "/topic/name.md", "content": "markdown text"}], "notes": "one paragraph on what changed"}
Rules:
- Follow the instructions exactly. Keep only stable, reusable knowledge.
- Merge duplicates, drop outdated or conflicting items (prefer newer conversations), group by topic.
- Paths start with "/", use lowercase words separated by "-" or "/", end with ".md".
- Never include passwords, tokens, API keys, or other secrets.
- At most 300 files; each file under 100 KB.
```

  user 文本逐字模板：

```
## Instructions
<instructions>

## Current memory files (<n> files)
--- <path> ---
<content>
...（无记忆时写 (empty)）

## Conversations (batch <batch_index+1> of <batch_count>)
=== session <session_id><若有 title：" · " + title> ===
<text>
...
```

- `parse_dream_response`：先 `json.loads`，失败取第一个 `{` 到最后一个 `}` 再解析；`memories` 必须是数组，元素需 `path`、`content` 为字符串，其余元素忽略；`notes` 缺省 `""`；整体失败 → None。
- `gate_memories`（拒绝原因字符串逐字）：路径经 A07 的 `agenticx.managed.memory.validate_memory_path`（若 A07 未合入，实施前须先合 A07——本文依赖它；不得复制一份路径规则）失败 → `invalid path`；内容去首尾空白后为空 → `empty content`；UTF-8 > 102400 → `content too large`；`agenticx.skills.guard.scan_skill_markdown_text(content, source="agent-created")` 后 `should_allow(result, source="agent-created")` 为 False → `blocked by safety scan`；同一规范化路径重复 → 保留最后一次、之前的记 `duplicate path`；按输出顺序累计，超过 300 条或总字节超 204800 之后的条目 → `over limit`。
- `consolidate`：`check_input_memories(memories)`；`transcripts` 为空 → `DreamError("no_sessions", "none of the sessions has usable text")`；`working = list(memories)`；对每批：`should_stop()` 为真 → `DreamError("cancelled", "dream cancelled")`；`text = await invoke(build_dream_messages(...))`；`parsed = parse_dream_response(text)`；为 None 时追加一条 user 消息 `Your previous reply was not valid JSON. Return ONLY the JSON object.` 重试一次；仍为 None → `DreamError("model_output_invalid", f"model returned invalid JSON at batch {i+1}")`；`working = parsed[0]`；最后 `kept, rejected = gate_memories(working)`；返回 `DreamOutcome(kept, rejected, notes=<最后一批的 notes>, batches=len(batches))`。

### 4.2 新建 `enterprise/apps/agent-runtime/ma_agent_runtime/memory_dreams.py`

```python
DREAM_STATUSES = ("pending", "running", "completed", "failed", "cancelled")
HEARTBEAT_SECONDS = 15
STALE_SECONDS = 120
CLAIM_INTERVAL_SECONDS = 2.0


class DreamStore:
    """Sync SQLAlchemy over ma_memory_dreams; call through asyncio.to_thread."""
    def __init__(self, engine: Engine) -> None: ...
    def create(self, row: Mapping[str, Any]) -> dict: ...
    def get(self, tenant_id: str, dream_id: str) -> dict | None: ...
    def list(self, tenant_id: str, *, input_memory_store_id: str | None, limit: int) -> list[dict]: ...
    def claim_next(self, worker_id: str) -> dict | None: ...          # FOR UPDATE SKIP LOCKED; pending -> running
    def requeue_stale(self) -> int: ...
    def heartbeat(self, dream_id: str, worker_id: str) -> bool: ...
    def request_cancel(self, tenant_id: str, dream_id: str) -> dict | None: ...   # pending -> cancelled; running -> cancel_requested=true
    def is_cancel_requested(self, dream_id: str) -> bool: ...
    def finish(self, dream_id: str, worker_id: str, *, status: str, report: Mapping, error: Mapping | None) -> None: ...


class DreamControlPlaneClient:
    """admin-console internal endpoints (§4.5). httpx.AsyncClient(trust_env=False); token never logged."""
    def __init__(self, base_url: str, internal_token: str, *, transport: httpx.AsyncBaseTransport | None = None) -> None: ...
    async def export_store(self, tenant_id: str, store_id: str) -> list[DreamMemory]: ...
    async def create_output_store(self, tenant_id: str, *, name: str, description: str | None,
                                  dream_id: str, created_by_user_id: str | None) -> str: ...
    async def finish_output_store(self, tenant_id: str, store_id: str, *, dream_id: str,
                                  outcome: Literal["completed", "failed", "cancelled"],
                                  memories: Sequence[DreamMemory], actor_user_id: str | None) -> None: ...
    async def aclose(self) -> None: ...


class DreamRunner:
    def __init__(self, *, store: DreamStore, events: EventStore, client: DreamControlPlaneClient,
                 llm_factory: LLMFactory, timeout_seconds: float, worker_id: str) -> None: ...
    async def start(self) -> None: ...
    async def stop(self) -> None: ...
    async def _run(self, dream: dict) -> None: ...


def build_public_router(*, state: "MAHostState", service: "DreamService") -> APIRouter: ...      # /ma/v1/memory_dreams*
def build_internal_router(*, service: "DreamService", internal_token: str) -> APIRouter: ...     # /internal/ma/memory-dreams*
def wire_dreams(app: FastAPI, *, sync_engine: Engine, llm_factory: LLMFactory, settings: Settings) -> None: ...
```

`DreamService.create(tenant_id, created_by_user_id, body)`（公开与内部接口共用）：
1. 校验请求体（§6.2，未知键拒绝；第一条错误作 400 `invalid_request` 的 message）。
2. `dream_id = new_ulid()`；`output_id = await client.create_output_store(...)`（admin-console 校验输入库存在：不存在 → 透传 404 `memory_store_not_found`）。
3. `store.create({... "status": "pending", "output_memory_store_id": output_id, ...})` → 201。若第 3 步失败，调 `finish_output_store(outcome="failed", memories=[])` 归档空输出库后再抛 500。

`DreamRunner._run(dream)`（逐步）：
1. `memories = await client.export_store(tenant, dream["input_memory_store_id"])`（413 / 409 `memory_store_limit` → `DreamError("input_too_large", …)`）。
2. 对每个 `session_id`：`record = await events.get_session(tenant, sid)`；None → 记入 `sessions_missing`；否则分页 `events.list_events(tenant, sid, after_seq=…, limit=500, types=["user.message", "agent.message"])` 读全，`transcript_from_events(sid, record.title, [e.to_wire() for e in rows])`，None → 记入 `sessions_empty`。
3. `llm = llm_factory.create(provider, model, context=LLMCallContext(tenant_id=tenant, session_id=dream_id, agent_id="ma.memory_dream", agent_version=1, user_id=dream["created_by"]))`；`invoke = lambda msgs: asyncio.to_thread(lambda: str(llm.invoke(msgs).content or ""))`。
4. `outcome = await asyncio.wait_for(consolidate(..., should_stop=lambda: store.is_cancel_requested(dream_id)), timeout=timeout_seconds)`；超时 → `DreamError("timeout", "dream exceeded the time limit")`。
5. 成功 → `finish_output_store(outcome="completed", memories=outcome.memories, actor_user_id=dream["created_by"])` → `store.finish(status="completed", report=…)`。
6. `DreamError("cancelled")` → `finish_output_store(outcome="cancelled", memories=[])`、`status="cancelled"`；其它 `DreamError` / 异常 → `finish_output_store(outcome="failed", memories=[])`、`status="failed"`、`error={"type": e.error_type 或 "internal_error", "message": e.message 或 type(exc).__name__}`。`finish_output_store` 本身失败只记日志（输出库保持 `agx.review=running`，管理员可手动归档），任务仍按结果落终态。
7. 心跳协程每 15 秒 `store.heartbeat`；返回 False（被接管）→ 取消本次执行，不写终态。

`report` 形状（逐字键名）：`{"input_memories": int, "sessions_requested": int, "sessions_used": int, "sessions_missing": [id], "sessions_empty": [id], "batches": int, "output_memories": int, "rejected": [{"path","reason"}], "notes": str}`（`rejected` 最多保留 100 条）。

公开路由（PAT，`current_principal` 与 `require_scope` 复用 `agenticx.managed.host.auth` 与 host 路由同一写法；挂在 `create_ma_app` 生成的 app 上，前缀 `/ma/v1`）：

| 方法 | 路径 | scope | 响应 |
|---|---|---|---|
| POST | `/ma/v1/memory_dreams` | `ma:memory:write` **且** `ma:sessions:read` | 201 `{"memory_dream": Dream}` |
| GET | `/ma/v1/memory_dreams?memory_store_id=&limit=` | `ma:memory:read` | 200 `{"data":[Dream]}`（`created_at` 倒序，limit 1–100 默认 20） |
| GET | `/ma/v1/memory_dreams/{dream_id}` | `ma:memory:read` | 200 `{"memory_dream"}`；404 `memory_dream_not_found` |
| POST | `/ma/v1/memory_dreams/{dream_id}/cancel` | `ma:memory:write` | 200 `{"memory_dream"}`（终态原样） |

内部路由（`MA_INTERNAL_TOKEN`，前缀 `/internal/ma`，供 admin-console）：`POST /internal/ma/memory-dreams`（请求同公开创建，另带 `tenant_id`、`created_by_user_id`）、`POST /internal/ma/memory-dreams/{dream_id}/cancel`（`{"tenant_id"}`）。鉴权失败 401。

错误码 `memory_dream_not_found` 404 为 agent-runtime 局部码（直接 `JSONResponse`，不进 `ALL_ERROR_CODES`），须登记 §12。

`config.py`：`MA_RUNTIME_DREAMS_ENABLED`（恰为 `"1"`，默认关）、`MA_DREAM_TIMEOUT_SECONDS`（300–86400，默认 7200）、`MA_DREAM_MAX_CONCURRENT`（1–4，默认 1）。`app.py` 在 `return app` 前追加：

```python
    if settings.dreams_enabled:
        wire_dreams(app, sync_engine=sync_engine, llm_factory=llm_factory, settings=settings)
```

`wire_dreams` 使用 `settings.admin_url` / `settings.internal_token` 构造 `DreamControlPlaneClient`，`app.state.ma.store` 作为 `events`，注册两个 router 与 startup / shutdown hook（shutdown 先停 runner 再 `client.aclose()`）。

### 4.3 迁移 `<NNNN>_ma_memory_dreams.sql`

编号：实施时取末项 +1（当前末项 PG `0064_ma_memory_stores` / MySQL `0038_ma_memory_stores`）；与 MA-E12 并行时先合入者取小号，journal `idx` 连续。

PG（逐字）：

```sql
-- Managed Agents 记忆整理任务。唯一写入方：agent-runtime；admin-console 只读。
-- 输出记忆库本身仍由 admin-console 写入（经 /api/internal/ma/memory-stores/* 内部接口）。
CREATE TABLE IF NOT EXISTS "ma_memory_dreams" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "input_memory_store_id" varchar(26) NOT NULL,
  "output_memory_store_id" varchar(26) NOT NULL,
  "session_ids" jsonb NOT NULL,
  "instructions" text NOT NULL,
  "model" varchar(160) NOT NULL,
  "report" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error" jsonb,
  "cancel_requested" boolean DEFAULT false NOT NULL,
  "created_by" varchar(26),
  "claimed_by" varchar(64),
  "heartbeat_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_memory_dreams_tenant_created_idx" ON "ma_memory_dreams" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_memory_dreams_status_created_idx" ON "ma_memory_dreams" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_memory_dreams_tenant_input_idx" ON "ma_memory_dreams" ("tenant_id", "input_memory_store_id", "created_at");
```

MySQL：同表同列，按 `drizzle-mysql/0037_ma_vaults.sql` 写法翻译（`json` + `DEFAULT (JSON_OBJECT())`、`datetime(6) … DEFAULT (UTC_TIMESTAMP(6))`、`boolean NOT NULL DEFAULT false`、`instructions` 用 `text`、约束与索引写在 `CREATE TABLE` 内，名称与 PG 一致）。drizzle schema 两份与 DDL 一一对应；agent-runtime `tables.py` 增 `ma_memory_dreams`（SQLAlchemy Core，`JSONType`、`TS` 复用文件内现有定义）。

### 4.4 iam-core `ma-memory.ts` 新函数（双方言，写法同文件内既有函数）

常量（文件内导出）：

```ts
export const DREAM_META_ORIGIN = "agx.origin";
export const DREAM_META_ID = "agx.dream_id";
export const DREAM_META_REVIEW = "agx.review";
export const DREAM_REVIEW_BLOCKING = ["running", "pending", "failed", "cancelled"] as const;
export const DREAM_EXPORT_MAX_ITEMS = 300;
export const DREAM_EXPORT_MAX_BYTES = 204800;
```

函数：
- `exportMemoryStoreForDream(tenantId, storeId)` → `{ store, memories: {path, content}[] }`；库不存在 → `MaMemoryStoreNotFoundError`；条数或总字节超限 → `MaMemoryStoreLimitError`（已有类）。
- `createDreamOutputStore(tenantId, {inputStoreId, name, description, dreamId, createdBy})`：先 `getMemoryStore(tenantId, inputStoreId)`（不存在抛 NotFound）；再 `createMemoryStore(tenantId, {name, description, metadata: {"agx.origin":"dream","agx.dream_id":dreamId,"agx.review":"running","agx.dream_input":inputStoreId}}, createdBy)`；同名冲突沿用 `createMemoryStore` 既有行为。
- `finishDreamOutputStore(tenantId, storeId, {dreamId, outcome, memories, actorUserId})`：库 `metadata["agx.dream_id"] !== dreamId` 或 `metadata["agx.review"] !== "running"` → `MaMemoryStoreNotFoundError`（不暴露差异）；`completed`：逐条 `applyMemoryWrite(tenant, storeId, {op:"create", path, content}, {kind:"user", userId: actorUserId})`，任一失败 → 抛 `MaMemoryValidationError("dream import failed at <path>: <code>")`（已写入的条目保留，随后把 review 置为 `failed` 并归档——由调用方 catch 后调用本函数的 `failed` 分支实现）；全部成功后 `updateMemoryStore(... metadata: {...metadata, "agx.review": "pending"})`；`failed` / `cancelled`：`updateMemoryStore(... "agx.review": outcome)` 后 `archiveMemoryStore`。
- `setDreamReviewDecision(tenantId, storeId, decision: "approve" | "discard", actorUserId)`：库须 `metadata["agx.origin"] === "dream"` 且 `agx.review === "pending"`，否则抛 `MaMemoryValidationError("memory store is not awaiting review")`；approve → `agx.review = "approved"`；discard → `agx.review = "discarded"` 并 `archiveMemoryStore`。
- `validateMemoryStoreIds`（L1089–1110）返回类型的 `status` 增加 `"pending_review"`：查询列追加 `metadata`；`status !== "archived"` 且 `DREAM_REVIEW_BLOCKING.includes(metadata["agx.review"])` → `"pending_review"`。其它分支不变。

`ma-memory-dreams-read.ts`：`listMemoryDreams(tenantId, {inputStoreId?, limit<=100})`、`getMemoryDream(tenantId, id)`，返回 §6.3 形状（snake_case）。

### 4.5 admin-console 内部接口（`isMaInternalAuthorized`，失败 401；错误体 `maError(...)`）

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/internal/ma/memory-stores/:storeId/export?tenant_id=` | — | 200 `{"memory_store":{id,name,status},"memories":[{path,content}]}`；404 `memory_store_not_found`；超限 409 `memory_store_limit` |
| POST | `/api/internal/ma/memory-stores/dream-output` | `{tenant_id, input_memory_store_id, name (1–255), description?, dream_id, created_by_user_id?}` | 201 `{"memory_store"}`；输入库不存在 404 |
| POST | `/api/internal/ma/memory-stores/:storeId/dream-finish` | `{tenant_id, dream_id, outcome:"completed"\|"failed"\|"cancelled", memories:[{path,content}] (≤300), actor_user_id?}` | 200 `{"memory_store"}`；不匹配 404；导入失败 400 `invalid_request`（message 含路径与 code，已按 failed 归档） |

管理台接口（`requireAdminScope`：读 `["kb:read"]`，写 `["kb:update"]`，与 E07 记忆库页一致；响应 `{code:"00000",message:"ok",data}`）：
- `GET /api/admin/ma-memory-stores/:storeId/dreams` → `listMemoryDreams(tenant, {inputStoreId: storeId})`。
- `POST /api/admin/ma-memory-stores/:storeId/dreams` `{session_ids, instructions, model, output_memory_store_name, output_memory_store_description?}` → `runtimeInternal("POST", "/internal/ma/memory-dreams", {tenant_id, created_by_user_id: adminUserId, input_memory_store_id: storeId, ...})`；运行时不可达 → 503「记忆整理服务不可达，请确认 agent-runtime 已启动并开启该功能」。
- `POST /api/admin/ma-memory-stores/:storeId/review` `{decision}` → `setDreamReviewDecision`；非待审核 → 409「该记忆库不在待审核状态」。
- `POST /api/admin/ma-memory-dreams/:dreamId/cancel` → 内部 cancel。

### 4.6 `src/lib/ma/runtime-internal-client.ts`

与 MA-E12 §4.6 定义完全一致（`runtimeInternal(method, path, body)`、`MaRuntimeUnavailableError`、`MaRuntimeRequestError`，环境变量 `MA_RUNTIME_INTERNAL_URL`，默认 `http://127.0.0.1:8092`，15 秒超时）。若 E12 已合入则不改该文件；本文先合入则新建，E12 实施时复用。

### 4.7 `agent-memory.tsx` 三处入口（样式与 E07 页面一致，文案不含实现细节）

1. **记忆库详情顶部**按钮「整理记忆」（输入库为任何未归档、且非待审核的库）→ `DreamDialog`：会话选择（文本框粘贴会话 ID，每行一个，1–100；下方提示「可在日志中心的托管会话页复制会话 ID」）、整理指令（textarea，默认填 `DEFAULT_INSTRUCTIONS_HINT` 的中文原文）、模型（下拉，来源与评分标准同一模型列表接口）、输出记忆库名称（默认「<原名>-整理-<YYYYMMDD>」）、描述；提交后 toast「已开始整理，完成后可在新记忆库中审核结果」。
2. **整理记录**（详情页下方 `DreamHistory`）：列「状态（等待 / 进行中 / 已完成 / 失败 / 已取消）、会话数、输出记忆库（链接）、记忆条数、被拦截条数、开始时间、操作（取消）」；进行中每 5 秒刷新；失败行展开显示错误类型与说明、报告中的缺失会话。
3. **审核横幅**（`DreamReviewBanner`，输出库详情顶部，`metadata["agx.origin"]==="dream"` 时显示）：
   - `running`：「正在整理，完成前不能查看或挂载。」
   - `pending`：「该记忆库由记忆整理生成，请检查内容后决定。审核通过前不能挂载到会话。」+ 主按钮「通过审核」+ 次按钮「丢弃」（主题化确认对话框：「丢弃后该记忆库会被归档，不会影响原记忆库。」）
   - `approved`：「已审核通过，可以挂载到会话。」（不显示按钮）
   - `failed` / `cancelled` / `discarded`：「整理未完成，该记忆库已归档。」
   列表页中待审核的库名后显示 `Badge`「待审核」。

---

## 5. Before / After

| 场景 | Before | After |
|---|---|---|
| 记忆库积累了重复 / 冲突内容 | 管理员逐条手改 | 发起整理，得到一个新库，审核后替换会话的挂载 |
| 从历史会话冷启动 | 无 | 以空库为输入、选 1–100 个会话 |
| 新库未审核就被挂载 | — | 挂载校验返回 `pending_review`，会话创建失败 |
| 输入库 | — | 零写入 |
| `MA_RUNTIME_DREAMS_ENABLED` 未设 | — | 无执行器与 `/ma/v1/memory_dreams`（404）；管理台发起返回 503 |

---

## 6. 数据与协议

### 6.1 输出记忆库 `metadata`

| 键 | 值 |
|---|---|
| `agx.origin` | `dream` |
| `agx.dream_id` | 整理任务 id |
| `agx.dream_input` | 输入记忆库 id |
| `agx.review` | `running` → `pending` → `approved` / `discarded`；或 `failed` / `cancelled` |

`agx.review ∈ {running, pending, failed, cancelled}` 时 `validateMemoryStoreIds` 返回 `pending_review`（`discarded` 时库已归档，返回 `archived`）。

### 6.2 创建请求

```json
{
  "input_memory_store_id": "01JB...",
  "session_ids": ["01JA...", "01JA..."],
  "instructions": "保留稳定偏好和已验证结论；删除重复、过期和个人身份信息；按主题组织。",
  "model": "zhipu/glm-5",
  "output_memory_store_name": "项目知识-整理-20261102",
  "output_memory_store_description": "记忆整理生成"
}
```

校验（错误消息逐字）：`input_memory_store_id` 26 位 ULID → `input_memory_store_id: must be a ULID`；`session_ids` 1–100 个、去重后 → `session_ids: must contain 1-100 unique ids`；`instructions` 1–8000 字符 → `instructions: must be 1-8000 characters`；`model` 匹配 `^[^/\s]+/\S+$` → `model: must be "<providerId>/<modelName>"`；`output_memory_store_name` 1–255 → `output_memory_store_name: must be 1-255 characters`；`output_memory_store_description` 可选 ≤ 1024 → `output_memory_store_description: must be at most 1024 characters`；未知键 → `<k>: unknown field`。

### 6.3 `Dream` 记录

```json
{"id": "01JC...", "tenant_id": "T", "status": "completed",
 "input_memory_store_id": "01JB...", "output_memory_store_id": "01JC...",
 "session_ids": ["01JA..."], "model": "zhipu/glm-5",
 "instructions": "...",
 "report": {"input_memories": 42, "sessions_requested": 10, "sessions_used": 9, "sessions_missing": ["01JA..."],
            "sessions_empty": [], "batches": 2, "output_memories": 18,
            "rejected": [{"path": "/creds.md", "reason": "blocked by safety scan"}], "notes": "合并了 ..."},
 "error": null, "created_by": "U", "started_at": "...", "finished_at": "...", "created_at": "..."}
```

`error`：`{"type": "input_too_large" | "no_sessions" | "model_output_invalid" | "timeout" | "internal_error", "message": "..."}`。

---

## 7. FR / NFR / AC

| ID | 需求 | AC（测试文件 :: 用例 :: 断言） |
|---|---|---|
| FR-1 | 会话文本提取 | `tests/managed/test_memory_dream.py::test_transcript_primary_thread_only`（含 `thread_id` 非空的 agent.message 被忽略；工具事件被忽略；超长保留尾部，`len(text) <= 20000`） |
| FR-2 | 分批 | `::test_batch_transcripts_respects_budget`（5 个 20000 字会话 → 3 批：2/2/1） |
| FR-3 | 输入上限 | `::test_input_too_large`（301 条 → `DreamError.error_type=="input_too_large"`） |
| FR-4 | 增量合并 | `::test_consolidate_uses_previous_batch_output`（两批；伪 invoke 记录第二次调用的 user 文本，含第一批返回的路径 `/a.md`；结果为第二批返回的集合） |
| FR-5 | JSON 容错与重试 | `::test_parse_wrapped_json`；`::test_retry_once_then_fail`（两次都非 JSON → `model_output_invalid`，invoke 调用 2 次） |
| FR-6 | 质量门禁 | `::test_gate_memories`（非法路径、空内容、超 100 KiB、重复路径保留后者、超 300 条、含 `AKIA` 风格密钥或 guard 判定拒绝的条目 → 对应 `reason`；用 monkeypatch 让 `should_allow` 对特定内容返回 False 以免依赖 guard 细节） |
| FR-7 | 取消 | `::test_should_stop_between_batches`（第一批后 `should_stop` 返回 True → `error_type=="cancelled"`，invoke 只调用 1 次） |
| FR-8 | 任务端到端 | `enterprise/apps/agent-runtime/tests/test_memory_dreams.py::test_dream_end_to_end`（SQLite 引擎 + `create_all`；`httpx.MockTransport` 扮演 admin-console 三个内部接口并记录请求；预置 2 个会话事件；`StaticLLMFactory(ScriptedLLM)` 返回合法 JSON：`POST /ma/v1/memory_dreams`（token 含 `ma:memory:write`、`ma:sessions:read`）→ 201，`output_memory_store_id` 为 mock 返回值；runner 跑完后 `status=="completed"`、`report.output_memories==N`；`dream-finish` 请求体 `outcome=="completed"` 且 `memories` 与模型输出一致；网关上下文 `agent_id=="ma.memory_dream"`） |
| FR-9 | 失败与归档 | `::test_missing_sessions_and_no_sessions`（全部会话不存在 → `status=="failed"`、`error.type=="no_sessions"`，`dream-finish` 以 `failed` 调用且 `memories==[]`）；`::test_timeout`（`timeout_seconds=0.2` + 慢 LLM → `error.type=="timeout"`） |
| FR-10 | 鉴权与校验 | `::test_public_routes_scopes_and_validation`（缺 `ma:sessions:read` → 403 `forbidden_scope`；`session_ids=[]` → 400 且 message `session_ids: must contain 1-100 unique ids`；他租户 dream → 404 `memory_dream_not_found`；内部路由错 token → 401） |
| FR-11 | 续跑 | `::test_stale_running_requeued`（running 且心跳过期 → `requeue_stale()==1`、再次被领取） |
| FR-12 | 内部接口 | `admin-console/src/app/api/internal/ma/__tests__/memory-dream-internal-routes.test.ts`（`vi.mock("@agenticx/iam-core")`）：export 超限 → 409 `memory_store_limit`；dream-output 创建时 metadata 四个键；dream-finish `dream_id` 不匹配 → 404；completed → `finishDreamOutputStore` 以 `completed` 调用；无 token → 401 |
| FR-13 | 审核闸门 | iam-core 记忆库测试：`validateMemoryStoreIds` 对 `agx.review="pending"` 的库返回 `pending_review`、`approved` 返回 `active`；`setDreamReviewDecision` 对非 dream 库或非 pending 抛错；approve 后 metadata `agx.review=="approved"`；discard 后库 `archived` |
| FR-14 | 管理台接口 | `src/app/api/admin/ma-memory-stores/__tests__/dreams-route.test.ts`：POST 组装的内部请求体含 `input_memory_store_id=storeId`、`created_by_user_id`；运行时不可达 → 503 文案；review 非待审核 → 409 文案 |
| FR-15 | 审核横幅 | `DreamReviewBanner.test.tsx`：五种 `agx.review` 对应文案；只有 `pending` 显示两个按钮；点「丢弃」先出确认对话框 |
| FR-16 | 表结构 | db-schema 三项测试计数 +1 / 表数 +1；`ma-schema.test.ts` 列集合双方言一致；agent-runtime `test_tables_parity.py` 新表一致 |
| NFR-1 | 输入库零写入 | `test_dream_end_to_end`：mock 记录中对输入库 id 只有 `export` 请求 |
| NFR-2 | 默认关闭 | `test_config.py::test_dream_settings_defaults`；`test_memory_dreams.py::test_not_wired_when_disabled`（`/ma/v1/memory_dreams` 404） |
| NFR-3 | 不泄露令牌 | `DreamControlPlaneClient.__repr__` 不含 token；`test_memory_dreams.py::test_client_errors_hide_token` |
| NFR-4 | 既有行为不变 | `pytest tests/managed -q`、agent-runtime 全量、`pnpm -C enterprise --filter @agenticx/admin-console test`、`--filter @agenticx/iam-core test` 全绿 |

---

## 8. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
pytest tests/managed/test_memory_dream.py -q
(cd enterprise/apps/agent-runtime && PYTHONPATH="/Users/damon/myWork/AgenticX:$PWD" pytest tests -q)
pnpm -C enterprise --filter @agenticx/db-schema test
pnpm -C enterprise --filter @agenticx/iam-core test && pnpm -C enterprise --filter @agenticx/iam-core typecheck
pnpm -C enterprise --filter @agenticx/admin-console test && pnpm -C enterprise --filter @agenticx/admin-console typecheck
pytest tests/managed -q

# 实库演示（MA_RUNTIME_DREAMS_ENABLED=1 启动 agent-runtime；admin-console 已启动）
curl --noproxy '*' -s -X POST http://127.0.0.1:8092/ma/v1/memory_dreams -H "Authorization: Bearer $PAT" \
  -H 'Content-Type: application/json' -d '{"input_memory_store_id":"<S>","session_ids":["<sid1>","<sid2>"],"instructions":"按主题整理","model":"<p>/<m>","output_memory_store_name":"demo-dream"}'
# 轮询 GET /ma/v1/memory_dreams/<id> 到 completed；管理台记忆库页打开输出库 → 看到「待审核」横幅 → 用该库建会话应失败 → 通过审核后再建会话成功
```

---

## 9. 回滚

- 开关：`MA_RUNTIME_DREAMS_ENABLED`（默认关）。关闭后无执行器、无公开 / 内部路由；管理台「整理记忆」返回 503；已有输出库与审核横幅照常显示。
- `validateMemoryStoreIds` 的 `pending_review` 改动随代码回滚撤销；回滚后待审核库会变为 `active`（可挂载）——回滚说明中要求先把待审核库归档或审核。
- 代码回滚：删除新建文件，`git checkout` 修改文件；迁移为新增表，不回滚。

---

## 10. 不变量

1. 输入记忆库内容与版本不变。
2. 记忆表的物理写入方仍只有 admin-console（agent-runtime 只经内部接口）。
3. 未审核通过的整理输出库不能被挂载到任何会话。
4. 所有模型调用经网关（`GatewayLLMFactory`）。
5. E07 公共接口与既有内部接口（`snapshot` / `writes`）行为不变；`validate` 只新增一个状态值。
6. 管理台文案不出现仓库路径、表名、元数据键名。

---

## 11. 须登记 master §12 / 待用户确认

- **登记**：① 新表 `ma_memory_dreams`（agent-runtime 唯一写入）；② admin-console 新内部接口 `export` / `dream-output` / `dream-finish`（整理任务无会话，不走挂载校验），以及 `validate` 新增状态 `pending_review`（A07 挂载校验视为不可挂载）；③ 公开接口 `/ma/v1/memory_dreams*`（落 agent-runtime，scope 复用 `ma:memory:*` + `ma:sessions:read`）与 agent-runtime 内部接口 `/internal/ma/memory-dreams*`；④ 局部错误码 `memory_dream_not_found` 404；⑤ 输出库 `metadata` 的 `agx.*` 键约定；⑥ v1 上限（输入 / 输出各 300 条、200 KiB）；⑦ 本子规划含 admin-console 小改动，属第 0 节规则 1 的登记例外；⑧ 迁移编号与 MA-E12 先合入者取小号。
- **待确认**：Q1 v1 上限 300 条 / 200 KiB 是否可接受（更大规模需要另做检索式整理）；Q2 整理写入的版本记录以「发起人（用户）」为执行者，而非新增「整理任务」执行者类型，是否接受；Q3 管理台发起整理时会话 ID 需手工粘贴（不做会话选择器），是否接受。
