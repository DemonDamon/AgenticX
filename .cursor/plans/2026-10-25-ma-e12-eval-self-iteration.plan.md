# MA-E12 评测与自迭代：评测集、评分标准、固定版本批量评测、版本对比、候选版本（须人工发布）

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W6，编号 MA-E12）
Depends-on: MA-E03（已实施，agent-runtime）、MA-E02（已实施，版本与路由）、MA-E05（已实施，观测台会话详情页 `/ops/logs/managed/<id>`）、MA-E07（实施中，记忆库）、MA-A07（pending，只读挂载；未合入时评测不支持挂载记忆，见 §2 D8，以实际实现为准，实施前核对）
栈：TS（db-schema、core-api、iam-core、admin-console）+ Python（框架评分模块 + agent-runtime 执行器）

> 风险等级：高（新表 6 张、跨进程内部接口、自迭代产出版本）。合入前建议强推理档只读审查。所有能力默认关闭：agent-runtime `MA_RUNTIME_EVALS_ENABLED`、admin-console 导航项随 `MA_EVALS_UI_ENABLED` 显示。
>
> 体量较大，建议按三个可独立验收的 commit 实施：① `evals-schema`（迁移 + core-api 评分标准校验器 + Python 评分模块 + 共享 fixture）→ ② `evals-runtime`（agent-runtime 执行器与内部接口）→ ③ `evals-admin`（iam-core 仓储、管理台接口与页面）。每段跑完对应验证命令再进下一段。

---

## 0. 一句话目标

管理员在管理台建**评测集**（上传 JSON / JSONL / CSV、粘贴 JSON、从托管会话导入）和**评分标准**（规则检查 + 可选 LLM 裁判）；选定 Agent 的**固定版本**发起评测，由 **agent-runtime 的评测执行器**逐条以 `source=eval` 新建托管会话执行（挂载的记忆一律只读），对每条结果做规则检查与经企业网关的 LLM 裁判打分，生成总分 / 通过率 / 逐条明细；两次评测（同一评测集与评分标准内容）可出**版本对比报告**；**自迭代**根据低分用例让优化模型改写系统提示，只产出**候选**，管理员点「创建候选版本」后才生成新版本（且不改变当前生效版本），是否切换生效由管理员在「智能体 → 版本」里人工决定。

---

## 1. 根因 / 动机与证据链

### 1.1 来自 master 的约束

| master 位置 | 内容 | 本文落点 |
|---|---|---|
| §1.2 资源表 Eval 行 | 「固定版本 + 评测集 + 评分标准，比较前后版本」 | 本文 |
| §2.3 单一写入方 | 每张表一个写入进程 | 评测集 / 用例 / 评分标准：admin-console；评测任务 / 结果 / 候选：agent-runtime（§2 D2） |
| §4 决策 3 | 模型调用一律经企业网关 | 被测会话与 LLM 裁判、优化模型都经 agent-runtime 的 `GatewayLLMFactory` |
| §5.2 Session.source | 已含 `eval` | 评测会话 `source="eval"` |
| §8 最后一条 | 「评测会话强制记忆只读的开关（v1 由评测方显式传 `read_only`）」 | 评测执行器对所有记忆挂载强制传 `read_only`（§2 D8） |
| §9 MA-E12 行 | 「评测集（上传 / 从会话导入）、评分标准、在固定版本上批量跑（`source=eval`，记忆只读挂载）、版本对比报告；自迭代只产出候选版本，须人工发布」 | 本文全部 |
| §12「版本路由 `version_routing` / `pinned_version`」 | 新版本在 `follow_latest` 下立即生效 | 创建候选版本前先把已发布、跟随最新的 Agent 固定在当前生效版本（与 MA-D04 D5 同规则） |
| master §0 规则 1 | 一个子规划最多两个栈 | TS + Python（§0 已列）；admin-console → agent-runtime 的内部调用是新的跨进程接口，须登记 §12 |

### 1.2 调研语义（`research/managed-agents/zhipu/evaluation.md`）

- L12–16：评测不修改 Agent；自迭代「产生候选版本，确认应用后更新原 Agent」。
- L22–28：先建评测集与评分标准，再在指定 Agent、版本、环境上运行，看总分、通过率、逐条结果。
- L37–44：评测集来源：上传 JSON / CSV / XLSX、粘贴 JSON（`query` 必填，`expectedAnswer` / `expectedToolTrace` 可选）、AI 生成、从 Session 导入（保留来源会话，补标注）。
- L56–58：评分标准应写可检查规则；保存修改生成新版本，任务使用所选标准的最新版本。
- L64–70：评测时优先只读记忆，避免用例互相污染；Custom 工具可选到此结束或给 mock 结果。
- L72–79：自迭代：选定优化范围（System Prompt / Skills），回测比较基线与候选，核对内容差异，确认应用。
- L96–100：报告单列系统异常，异常不计入评分与通过率；AI 评分是辅助证据。

### 1.3 现状代码证据（2026-10-25 核对，实施前重新核对行号）

| 文件 | 行 | 现状 | 结论 |
|---|---|---|---|
| `agenticx/evaluation/llm_judge.py` | 109–207、330–388 | `LLMJudge(rubric, mode=BINARY|CONTINUOUS, llm_provider, include_input, include_expected, retry_count=2)`；`evaluate(output, expected, inputs) -> JudgeResult`；provider 协议只要 `async acomplete(prompt) -> str` | 直接复用作 LLM 裁判，provider 包一层网关 LLM |
| `agenticx/evaluation/evalset.py` | 15–64 | `ExpectedToolUse.matches`（name_only / partial / exact） | 规则 `expected_tool_trace` 只做「按顺序包含工具名」，不引入参数匹配 |
| `agenticx/learning/gepa_proposer.py` | 82–113、116–160 | GEPA 式「让模型返回 JSON 候选、容错解析」 | 自迭代沿用该模式，但改走网关（原实现直连 litellm，不可在企业侧使用） |
| `agenticx/managed/host/service.py` | 107–154、162–164 | `create_session(principal, CreateSessionRequest)`、`post_events(principal, sid, raw)` 进程内可直接调用 | 评测执行器在 agent-runtime 进程内直接驱动会话，不走 HTTP |
| `agenticx/managed/host/models.py` | 16–27 | `CreateSessionRequest(agent_id, agent_version, environment_id, vault_ids, resources, title, source)` | `source="eval"` |
| `agenticx/managed/host/config.py` | 41–46 | `Principal(tenant_id, user_id, scopes)`；`ma:admin` 放行全部 | 执行器以「发起评测的管理员」为会话创建者 |
| `agenticx/managed/gateway_llm.py` | 100–117 | `GatewayLLMFactory.create(provider, model, context)` | 裁判与优化模型复用 |
| `enterprise/apps/agent-runtime/ma_agent_runtime/app.py` | 38–129 | `build_app(settings)`：建 PG 引擎、注册表、网关工厂、`create_ma_app`；`app.state.ma.shutdown_hooks` | 在此挂评测执行器与内部路由 |
| `enterprise/apps/agent-runtime/ma_agent_runtime/pg_work_queue.py` | — | 同步引擎 `FOR UPDATE SKIP LOCKED` 领取 | 评测任务领取照此写法 |
| `enterprise/apps/agent-runtime/ma_agent_runtime/tables.py` + `tests/test_tables_parity.py` L16–60 | — | SQLAlchemy Core 表与 drizzle DDL 逐列比对（`_WANTED` 表集合，类型族 varchar/text/integer/bigint/boolean/jsonb/timestamptz） | 新表照此登记；分数用 `integer`（千分制）避免浮点类型 |
| `enterprise/apps/admin-console/src/lib/ma/internal-auth.ts` | 1–55 | `getMaInternalToken()` 读 `MA_INTERNAL_TOKEN(_FILE)` | admin-console 调 agent-runtime 用同一令牌 |
| `enterprise/packages/iam-core/src/repos/ma-sessions-read.ts` | 259–340 | `getMaSession`、`listMaSessionEvents` | 「从会话导入用例」读会话事件 |
| `enterprise/packages/iam-core/src/repos/agent-versions.ts` / `agents.ts` | 94–147；621–665 | `createAgentVersion(tenant, agent, {manifest, expectedLatestVersion, note, createdBy, source})`；`updateAgentMaSettings(tenant, id, {versionRouting, pinnedVersion})` | 「创建候选版本」复用 |
| `enterprise/apps/web-portal/src/lib/desktop-agent-publish.ts` | 160–200 | 已发布且 `follow_latest` → 先固定当前生效版本再追加版本 | 同一规则 |
| `enterprise/apps/admin-console/src/lib/admin-platform-sections.ts` | 2–16 | 平台配置子页 id 列表（E07 正在插入 `agent-memory`） | 插入 `agent-evals` |
| `enterprise/apps/admin-console/src/components/AppShell.tsx` | 114–123 | 平台配置导航（已有 `/admin/agent-memory`） | 追加导航项 |
| `enterprise/packages/db-schema/drizzle/meta/_journal.json` | 末项 | 当前末项 `0064_ma_memory_stores`（MySQL `0038_ma_memory_stores`） | 本文迁移编号见 §6.1 |

---

## 2. 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | **执行方 = agent-runtime 内的 `EvalRunner`**（后台协程，PG 表领取任务），进程内直接调 `SessionService` 建会话、发消息、读事件；不经公网 API、不占用户 PAT | 会话面唯一写入方本就是 agent-runtime；进程内调用免去鉴权与网络 |
| D2 | **写入方切分**：`ma_eval_datasets` / `ma_eval_dataset_items` / `ma_eval_rubrics` 由 admin-console 写；`ma_eval_runs` / `ma_eval_results` / `ma_eval_candidates` 由 agent-runtime 写，admin-console 只读（经 iam-core 只读仓储查 PG，与 E05 观测台同模式） | master §2.3 |
| D3 | 发起评测时，admin-console 把**评测集用例与评分标准内容快照**整体放进创建请求，agent-runtime 存进 `ma_eval_runs.config`；之后改评测集 / 评分标准不影响已有任务，也让 agent-runtime 不必反查控制面 | 结果可复现；省一个内部读接口 |
| D4 | admin-console → agent-runtime 新增**内部接口** `/internal/ma/eval-*`（不在 `/ma/v1` 前缀下，nginx 不对外暴露），Bearer = 共用的 `MA_INTERNAL_TOKEN`；admin-console 新增环境变量 `MA_RUNTIME_INTERNAL_URL`（默认 `http://127.0.0.1:8092`） | 管理台是 cookie 会话、没有 PAT；与 agent-runtime 调 admin `/api/internal/ma/*` 对称。须登记 §12 |
| D5 | **评分**：每条结果先跑规则检查（`contains` / `not_contains` / `regex` / `tool_called` / `tool_not_called` / `max_tool_calls` / `stop_reason`，外加用例自带的 `expected_tool_trace` 顺序检查），再按评分标准可选调用 LLM 裁判（`agenticx.evaluation.LLMJudge`，经网关）。**通过** = 全部规则通过且（无裁判或裁判通过）；**分数** = 裁判分（binary 为 1/0，score 为 0–1），无裁判时为规则通过比例；千分制整数落库 | 可检查规则优先、AI 评分辅助（调研 L56、L100） |
| D6 | **异常单列**：会话以 `retries_exhausted` / `policy_blocked` / `budget_exceeded` 结束、单条超时、进入 `requires_action`（含自定义工具调用）、建会话失败 → 该条 `status="error"`，不计入通过率与均分 | 调研 L100；无人值守场景不能依赖审批（master §1.2） |
| D7 | `requires_action` 时执行器立即发 `user.interrupt` 收尾并把该条记为 `error`（`error="requires_action"`）；v1 不提供自定义工具 mock | 调研 L69 的 mock 列为后续 |
| D8 | 评测可选挂载记忆库：执行器对每个 `memory_store_id` 一律传 `{"type":"memory_store","memory_store_id":…,"access":"read_only"}`；不支持 Vault（v1）。MA-A07 未合入时 agent-runtime 拒绝带 resources 的建会话 → 管理台在发起评测时收到 400 并提示「当前运行时不支持挂载记忆库」 | master §8 |
| D9 | **自迭代 v1 只改系统提示**：输入一次已完成的评测任务；取得分最低的至多 20 条未通过用例（问题、回答、裁判理由、未通过的规则），连同当前系统提示与评分标准交给优化模型（管理员选择，经网关），要求返回 JSON `{"system","rationale"}`；生成候选（完整 Manifest、hash、差异、理由）落 `ma_eval_candidates`，**不创建版本、不回测** | 「只产出候选」；Skills 优化、多轮自动回测列入后续 |
| D10 | **人工发布**：管理员在候选上点「创建候选版本」→ admin-console 先（已发布且跟随最新时）把路由固定在当前生效版本，再 `createAgentVersion`（`source:"admin"`，note 记候选 id），然后通知 agent-runtime 把候选标为 `applied`；新版本不生效，管理员可在其上发起回测并对比，再到「智能体 → 版本」手动切换生效 | 新版本在 follow_latest 下立即生效，必须先固定（与 D04 一致） |
| D11 | **对比**：只允许 `dataset_hash` 与 `rubric_hash` 都相同的两次已完成评测对比；逐条按 `item_id` 配对，给出修复 / 退化 / 不变 / 异常计数与通过率、均分差 | 调研 L12「同一批数据比较」；避免把条件变化当能力变化 |
| D12 | 限额：每评测集 ≤ 500 条；单条 `query` ≤ 20000 字符、`expected_answer` ≤ 20000 字符；上传体 ≤ 5 MiB；每任务并发 1–4（默认 2）；全进程同时运行的任务数 `MA_EVAL_MAX_CONCURRENT_RUNS`（默认 1）；单条超时 `MA_EVAL_ITEM_TIMEOUT_SECONDS`（默认 600） | 先小规模验证（调研 L104） |
| D13 | 多副本：任务领取用 `FOR UPDATE SKIP LOCKED`；执行中每 15 秒刷新 `heartbeat_at`；任何副本发现 `status='running' AND heartbeat_at < now()-120s` 的任务把它改回 `queued`（`claimed_by=NULL`），已写结果的用例在续跑时跳过 | 与 PG Work Queue 同口径，按用例粒度可续 |
| D14 | 评测会话保留（不删），执行完对每个会话调 `archive`；观测台按 `source=eval` 可查（E05 已支持来源筛选） | 留痕、可追溯执行轨迹 |

---

## 3. In scope / Out of scope

### 3.1 In scope（只能创建或修改这些文件）

db-schema（TS）：
- 新建 `enterprise/packages/db-schema/drizzle/<PG>_ma_evals.sql`、`drizzle-mysql/<MY>_ma_evals.sql`（编号见 §6.1）
- 修改两份 `meta/_journal.json`（各追加一项）
- 新建 `enterprise/packages/db-schema/src/schema/ma-evals.ts`、`src/mysql-schema/ma-evals.ts`；修改两份 `index.ts`（各加一行 `export * from "./ma-evals";`）
- 修改 `src/__tests__/schema-parity.test.ts`（表数 +6、MySQL 迁移清单与 journal 项）、`src/__tests__/migration-inventory.test.ts`（journal 条数、末 tag、`.sql` 文件数各 +1）、`src/__tests__/ma-schema.test.ts`（6 张表列集合双方言一致）

core-api（TS）：
- 新建 `enterprise/packages/core-api/src/managed-evals.ts`（评分标准校验 / 规范化 / hash、规则类型常量）；修改 `src/index.ts`（追加一行 re-export）
- 新建 `enterprise/packages/core-api/src/__tests__/managed-evals.test.ts`

框架（Python）：
- 新建 `agenticx/managed/evaluation.py`、`agenticx/managed/eval_iterate.py`
- 新建 `tests/fixtures/managed_agents/rubric_cases.json`
- 新建 `tests/managed/test_evaluation.py`、`tests/managed/test_eval_iterate.py`

agent-runtime（Python）：
- 新建 `enterprise/apps/agent-runtime/ma_agent_runtime/evals.py`
- 修改 `ma_agent_runtime/tables.py`（3 张表）、`ma_agent_runtime/config.py`（3 个环境变量）、`ma_agent_runtime/app.py`（`if settings.evals_enabled: wire_evals(...)` 一段）
- 新建 `enterprise/apps/agent-runtime/tests/test_evals.py`；修改 `tests/test_tables_parity.py`（`_WANTED` 加 3 表、读取本迁移文件）、`tests/test_config.py`

iam-core（TS）：
- 新建 `enterprise/packages/iam-core/src/repos/ma-evals.ts`（评测集 / 用例 / 评分标准写仓储，双方言）、`src/repos/ma-evals-read.ts`（任务 / 结果 / 候选只读）
- 修改 `src/index.ts`（re-export）
- 新建 `src/repos/__tests__/ma-evals.test.ts`

admin-console（TS）：
- 新建 `src/lib/ma/runtime-internal-client.ts`、`src/lib/ma/eval-dataset-parse.ts`、`src/lib/ma/eval-compare.ts`、`src/lib/ma/eval-records.ts`
- 新建接口（相对 `src/app/api/admin/ma-evals/`）：`datasets/route.ts`、`datasets/[datasetId]/route.ts`、`datasets/[datasetId]/items/route.ts`、`datasets/[datasetId]/items/[itemId]/route.ts`、`datasets/[datasetId]/items/import-session/route.ts`、`rubrics/route.ts`、`rubrics/[rubricId]/route.ts`、`runs/route.ts`、`runs/[runId]/route.ts`、`runs/[runId]/cancel/route.ts`、`runs/[runId]/iterate/route.ts`、`candidates/route.ts`、`candidates/[candidateId]/apply/route.ts`、`candidates/[candidateId]/discard/route.ts`、`compare/route.ts`、`shared.ts`
- 新建页面 `src/app/admin/_sections/agent-evals.tsx` 与 `src/components/agent-evals/{DatasetsTab,RubricsTab,RunsTab,RunDetailSheet,CompareDialog,CandidatesTab}.tsx`
- 修改 `src/lib/admin-platform-sections.ts`（插入 `"agent-evals"`）、`src/app/admin/[section]/page.tsx`（映射）、`src/components/AppShell.tsx`（导航项，受 `MA_EVALS_UI_ENABLED` 控制）、`messages/zh.json`、`messages/en.json`
- 修改 `src/lib/__tests__/admin-platform-sections.test.ts`
- 新建测试：`src/lib/ma/__tests__/eval-dataset-parse.test.ts`、`eval-compare.test.ts`、`src/app/api/admin/ma-evals/__tests__/routes.test.ts`、`src/components/agent-evals/RunDetailSheet.test.tsx`
- 修改 `enterprise/.env.local.example`（追加 `MA_RUNTIME_INTERNAL_URL`、`MA_EVALS_UI_ENABLED`、`MA_RUNTIME_EVALS_ENABLED` 三行注释示例）

文档：
- 修改 `docs/managed-agents/protocol.md`（追加「评测与自迭代（MA-E12）」一节：内部接口、评分规则、状态）

### 3.2 Out of scope

- AI 生成评测集、XLSX / XLS 上传、用户模拟复现、自定义工具 mock 结果（调研 L37–40、L67–69）。
- 自迭代优化 Skills、多轮自动回测、候选沙盒清理。
- 公开 `/ma/v1/eval*` API 与 PAT scope、`agx ma eval` CLI（可由 MA-E11 后续接入）。
- 评测挂载 Vault；`desktop_worker` 环境评测（建会话时 agent-runtime 会按现有规则拒绝或排队，本文 v1 只允许 `cloud` 环境，管理台下拉只列 cloud 环境与合成 `local`）。
- 不改 `agenticx/evaluation/*`、`agenticx/learning/*`、`agenticx/managed/host/*`、E05 观测台页面、web-portal。
- MA-E10 计量对 `source=eval` 的特殊处理（评测会话照常计入该 Agent 与发起人的用量）。

---

## 4. 精确落点

### 4.1 Python 框架：`agenticx/managed/evaluation.py`

```python
RULE_TYPES = ("contains", "not_contains", "regex", "tool_called", "tool_not_called", "max_tool_calls", "stop_reason")
JUDGE_MODES = ("binary", "score")
STOP_REASON_VALUES = ("end_turn", "requires_action", "retries_exhausted", "refusal",
                      "max_tool_rounds", "budget_exceeded", "policy_blocked")
MAX_CRITERIA_BYTES = 32768
MAX_RULE_CHECKS = 20
MAX_RULE_VALUE_BYTES = 1000
MAX_RULE_PATTERN_BYTES = 500
DEFAULT_PASS_THRESHOLD = 0.7


@dataclass
class RubricResult:
    ok: bool
    errors: list[str]                        # sorted()
    normalized: dict[str, Any] | None
    content_hash: str | None                 # "sha256:<hex>" of canonical_json(normalized)

def validate_rubric(raw: Any) -> RubricResult: ...


@dataclass(frozen=True)
class ItemOutcome:
    answer: str                              # last primary-thread agent.message text after the query
    tool_names: tuple[str, ...]              # agent.tool_use / mcp_tool_use / custom_tool_use names, seq order
    stop_reason: str | None
    error: str | None                        # set when the item is an execution error (D6)

@dataclass(frozen=True)
class RuleResult:
    type: str
    passed: bool
    detail: str

def run_rule_checks(rule_checks: Sequence[Mapping[str, Any]], outcome: ItemOutcome,
                    expected_tool_trace: Sequence[str] | None) -> list[RuleResult]: ...

class GatewayJudgeProvider:
    """agenticx.evaluation LLMProvider over a managed LLM object (has .invoke(messages))."""
    def __init__(self, llm: Any) -> None: ...
    async def acomplete(self, prompt: str) -> str: ...      # asyncio.to_thread(llm.invoke, [{"role":"user","content":prompt}]).content
    def complete(self, prompt: str) -> str: ...

async def judge_item(rubric: Mapping[str, Any], *, query: str, answer: str,
                     expected_answer: str | None, provider: Any) -> dict[str, Any]:
    """Return {"score": float 0..1, "passed": bool, "reason": str, "error": str | None}."""

def score_item(rubric: Mapping[str, Any], rules: Sequence[RuleResult],
               judge: Mapping[str, Any] | None) -> tuple[Literal["passed", "failed"], float]: ...

def summarize(results: Sequence[Mapping[str, Any]]) -> dict[str, Any]: ...
```

规则（逐条实现）：
- `validate_rubric` 规则与错误串见 §6.3（逐字，与 TS 同语义，共享 `rubric_cases.json`）。规范化：`criteria` 缺省 `""`、`mode` 缺省 `"binary"`、`pass_threshold` 缺省 `0.7`、`judge_model` 缺省 `None`、`rule_checks` 缺省 `[]`；`contains` / `not_contains` 的 `case_sensitive` 缺省 `False`。hash 用 `agenticx.managed.manifest.canonical_json` + sha256，前缀 `sha256:`。
- `run_rule_checks`（`detail` 文本逐字）：
  - `contains` / `not_contains`：大小写不敏感时两边 `.casefold()`；`detail` = `"found"` / `"not found"`。
  - `regex`：`re.search(pattern, answer)`；`re.error` → `passed=False`、`detail="invalid regex"`；超时防护：答案截前 200000 字符再匹配。
  - `tool_called` / `tool_not_called`：`name in tool_names`。
  - `max_tool_calls`：`len(tool_names) <= value`；`detail=f"{len(tool_names)} calls"`。
  - `stop_reason`：`outcome.stop_reason == value`；`detail=str(outcome.stop_reason)`。
  - 用例 `expected_tool_trace` 非空时追加一条 `type="expected_tool_trace"`：期望序列是 `tool_names` 的**子序列**（按顺序、可间隔）；`detail` = `"matched"` / `f"missing {name}"`（第一个缺失的名字）。
- `judge_item`：`rubric["judge_model"]` 为 None 时不调用（调用方保证）；`LLMJudge(rubric=criteria, mode=BINARY if mode=="binary" else CONTINUOUS, llm_provider=provider, include_input=True, include_expected=expected_answer is not None, retry_count=1)`；`evaluate(output=answer, expected=expected_answer, inputs={"query": query})`；binary：`score = 1.0 if value is True else 0.0`，`passed = value is True`；score：`score = clamp(float(value), 0, 1)`，`passed = score >= pass_threshold`；`JudgeResult.metadata` 含 `error` 或 `parse_error` → 返回 `{"score":0.0,"passed":False,"reason":<reason>,"error":"judge_failed"}`。
- `score_item`：任一规则 `passed=False` → `"failed"`；有裁判且 `judge["passed"]` 为 False → `"failed"`；否则 `"passed"`。分数：有裁判 → `judge["score"]`；否则规则通过比例（无规则时 1.0）。
- `summarize(results)`（每项含 `status`、`score_milli`）：`{"total", "passed", "failed", "errored", "pass_rate", "mean_score"}`；`pass_rate = passed / (passed + failed)`（分母 0 → null），`mean_score = mean(score_milli)/1000` 只统计非 error（无则 null），保留 4 位小数。

### 4.2 Python 框架：`agenticx/managed/eval_iterate.py`

```python
MAX_FAILURES = 20
MAX_FAILURE_ANSWER_CHARS = 2000

def select_failures(results: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """status == "failed", ordered by score_milli asc then position asc, first MAX_FAILURES."""

def build_iteration_prompt(*, system: str, criteria: str, failures: Sequence[Mapping[str, Any]]) -> str: ...

def parse_iteration_response(text: str) -> tuple[str, str] | None:
    """Return (system, rationale). Accept raw JSON or the first {...} block (gepa_proposer pattern)."""

def build_candidate(base_manifest: Mapping[str, Any], new_system: str) -> dict[str, Any]:
    """Return {"manifest": normalized, "manifest_hash", "diff": {"system": <unified diff>}}.
    Raises ValueError("optimizer produced no change") when the system text is unchanged,
    ValueError("candidate manifest invalid: <first error>") when validate_manifest fails."""
```

提示词（`build_iteration_prompt` 输出，逐字模板；`<...>` 为插值，失败用例逐条渲染）：

```
You improve the system prompt of an AI agent. Keep everything that already works.
Change only what is needed to fix the failures below. Do not invent tools or data sources.
Return ONLY JSON: {"system": "<full new system prompt>", "rationale": "<what you changed and why, under 800 characters>"}

## Evaluation criteria
<criteria，空时写 (rule checks only)>

## Current system prompt
<system>

## Failed cases
### Case <n>
Query: <query 前 2000 字符>
Answer: <answer 前 2000 字符>
Judge: <judge.reason 或 (none)>
Failed checks: <未通过规则的 "type: detail" 逗号拼接，或 (none)>
```

`build_candidate`：`copy.deepcopy(base_manifest)`，`["system"] = new_system`，`validate_manifest` → 用其 `normalized` / `manifest_hash`；差异 `"\n".join(difflib.unified_diff(old.splitlines(), new.splitlines(), fromfile="current", tofile="candidate", lineterm=""))`。

### 4.3 agent-runtime：`ma_agent_runtime/evals.py`

```python
EVAL_RUN_STATUSES = ("queued", "running", "completed", "failed", "cancelled")
EVAL_RESULT_STATUSES = ("passed", "failed", "error")
HEARTBEAT_SECONDS = 15
STALE_SECONDS = 120
CLAIM_INTERVAL_SECONDS = 2.0
MAX_ITEMS_PER_RUN = 500


class EvalStore:
    """Sync SQLAlchemy (same sync engine as PgWorkQueue); every method runs via asyncio.to_thread."""
    def __init__(self, engine: Engine) -> None: ...
    def create_run(self, row: Mapping[str, Any]) -> dict: ...
    def claim_next(self, worker_id: str) -> dict | None: ...           # FOR UPDATE SKIP LOCKED, status queued -> running
    def requeue_stale(self) -> int: ...                                # D13
    def heartbeat(self, run_id: str, worker_id: str, progress: Mapping) -> bool: ...   # False when claimed_by changed
    def finished_item_ids(self, run_id: str) -> set[str]: ...
    def insert_result(self, row: Mapping[str, Any]) -> None: ...       # ON CONFLICT (run_id, item_id) DO NOTHING
    def list_results(self, run_id: str) -> list[dict]: ...
    def finish_run(self, run_id: str, worker_id: str, *, status: str, summary: Mapping, error: str | None) -> None: ...
    def request_cancel(self, tenant_id: str, run_id: str) -> dict | None: ...
    def get_run(self, tenant_id: str, run_id: str) -> dict | None: ...
    def insert_candidate(self, row: Mapping[str, Any]) -> dict: ...
    def set_candidate_status(self, tenant_id: str, candidate_id: str, *, status: str,
                             applied_version: int | None, decided_by: str | None) -> dict | None: ...


class EvalRunner:
    def __init__(self, *, state: "MAHostState", store: EvalStore, llm_factory: LLMFactory,
                 item_timeout_seconds: float, max_concurrent_runs: int, worker_id: str) -> None: ...
    async def start(self) -> None: ...      # background loop task
    async def stop(self) -> None: ...
    async def _run_eval(self, run: dict) -> None: ...
    async def _run_iterate(self, run: dict) -> None: ...
    async def _run_item(self, run: dict, item: Mapping[str, Any]) -> dict: ...


def build_internal_router(*, store: EvalStore, internal_token: str) -> APIRouter: ...
def wire_evals(app: FastAPI, *, sync_engine: Engine, llm_factory: LLMFactory, settings: Settings) -> None: ...
```

`_run_item(run, item)`（逐步）：
1. `principal = Principal(tenant_id=run["tenant_id"], user_id=run["created_by"] or "system", scopes=frozenset({"ma:admin"}))`。
2. `resources = [{"type": "memory_store", "memory_store_id": sid, "access": "read_only"} for sid in run["config"]["memory_store_ids"]]`。
3. `record = await state.service.create_session(principal, CreateSessionRequest(agent_id=run["agent_id"], agent_version=run["agent_version"], environment_id=run["environment_id"], resources=resources, title=f"eval {run['id'][-6:]} #{item['position']}", source="eval"))`；`MAError` → 返回 `status="error"`、`error=f"create_session: {exc.code}"`。
4. `await state.service.post_events(principal, record.id, {"events": [{"type": "user.message", "content": [{"type": "text", "text": item["query"]}]}]})`，记下返回的该事件 `seq`。
5. 每 1 秒 `get_session` 轮询直至 `status == "idle"` 且 `stop_reason` 非空，或总时长超 `item_timeout_seconds`：
   - `stop_reason.type == "requires_action"` → `post_events` 发 `user.interrupt`，再等到 idle（最多 10 秒）；本条 `error="requires_action"`。
   - 超时 → 发 `user.interrupt`，`error="timeout"`。
6. 读该会话 `seq` 之后的全部事件（`store.list_events(..., thread_filter=None)` 分页；若 MA-A08 已合入则传 `ThreadFilter("session")` 只取主线程与线程摘要——以实际实现为准）：`answer` = 最后一条 `thread_id` 为空的 `agent.message` 的 text 块拼接；`tool_names` = `agent.tool_use` / `agent.mcp_tool_use` / `agent.custom_tool_use` 的 `name`；`stop_reason` = 记录的 `stop_reason.type`。
7. `stop_reason ∈ {"retries_exhausted", "policy_blocked", "budget_exceeded"}` → `error = stop_reason`。
8. 有 `error` → `status="error"`、`score_milli=None`，不跑规则与裁判。否则 `run_rule_checks`；`judge_model` 非空时 `provider, model = split_model_ref(judge_model)`，`llm = llm_factory.create(provider=provider, model=model, context=LLMCallContext(tenant_id=…, session_id=record.id, agent_id="ma.eval.judge", agent_version=1, user_id=run["created_by"]))`，`judge = await judge_item(...)`；`status, score = score_item(...)`；`score_milli = round(score * 1000)`。
9. `await state.service.archive(principal, record.id)`（失败只记日志）。
10. 返回结果行（字段见 §6.1 `ma_eval_results`），`usage` = 会话记录 `usage.model_dump()`，`duration_ms` = 墙钟毫秒。

`_run_eval(run)`：`items = run["config"]["dataset"]["items"]`；跳过 `finished_item_ids`；`asyncio.Semaphore(run["config"]["concurrency"])` 并发；每条完成后 `insert_result` 并 `heartbeat(progress={"total", "done", "passed", "failed", "errored"})`；heartbeat 返回 False（任务被其他副本接管）或读到 `status=="cancelled"`（`get_run`）→ 停止派发新条目、等待在途条目结束后返回（不写 finish）。全部完成 → `finish_run(status="completed", summary=summarize(list_results))`。任何未捕获异常 → `finish_run(status="failed", error=f"{type(exc).__name__}")`。

`_run_iterate(run)`：`base = store.get_run(tenant, run["base_run_id"])` 必须 `kind=="eval" and status=="completed"`（否则 failed `"base run is not a completed eval run"`）；`version = await state.registry.get_version(tenant, base["agent_id"], base["agent_version"])`；`failures = select_failures(store.list_results(base["id"]))`，为空 → failed `"no failed cases to improve"`；优化模型 `run["config"]["optimizer_model"]` 经 `llm_factory`（`agent_id="ma.eval.optimizer"`，`session_id=run["id"]`）调用一次 `invoke`；`parse_iteration_response` 失败 → failed `"optimizer returned invalid JSON"`；`build_candidate` 抛 ValueError → failed（消息即异常文本）；成功 → `insert_candidate`（`status="proposed"`），`finish_run(status="completed", summary={"candidate_id": <id>})`。

主循环 `start()`：每 `CLAIM_INTERVAL_SECONDS` 先 `requeue_stale()`，在运行任务数 < `max_concurrent_runs` 时 `claim_next` 并按 `kind` 派发；每个运行中任务另起心跳协程（15 秒）。`stop()` 取消主循环与运行中任务（任务保持 running，由心跳过期机制在重启后续跑）。

内部路由（`build_internal_router`，前缀 `/internal/ma`，**不**在 `/ma/v1` 下；鉴权：`Authorization: Bearer <MA_INTERNAL_TOKEN>`，`hmac.compare_digest`，失败 401 `{"error":{"code":"unauthorized","message":"invalid internal token"}}`）：

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| POST | `/internal/ma/eval-runs` | §6.4.1 | 201 `{"run": EvalRun}` |
| GET | `/internal/ma/eval-runs/{run_id}?tenant_id=` | — | 200 `{"run"}`；404 `eval_run_not_found` |
| POST | `/internal/ma/eval-runs/{run_id}/cancel` | `{"tenant_id"}` | 200 `{"run"}`（queued → cancelled；running → cancelled，执行器下一次检查时停止；终态原样） |
| POST | `/internal/ma/eval-iterations` | `{"tenant_id","created_by_user_id","base_run_id","optimizer_model"}` | 201 `{"run"}`（kind `iterate`） |
| POST | `/internal/ma/eval-candidates/{candidate_id}/status` | `{"tenant_id","status":"applied"\|"discarded","applied_version":int\|null,"decided_by_user_id"}` | 200 `{"candidate"}`；404 `eval_candidate_not_found`；非 `proposed` 且目标状态不同 → 409 `eval_candidate_decided` |

错误码 `eval_run_not_found` 404、`eval_candidate_not_found` 404、`eval_candidate_decided` 409 是 agent-runtime 内部接口的**局部码**（直接 `JSONResponse`，不进 `ALL_ERROR_CODES`），须登记 §12。请求体校验失败 → 400 `invalid_request`，`message` 为第一条错误（字段清单见 §6.4.1）。

`wire_evals`：`EvalStore(sync_engine)`、`EvalRunner(...)`，`app.include_router(build_internal_router(...))`，`app.state.ma.startup_hooks.append(runner.start)`、`shutdown_hooks.append(runner.stop)`。`app.py` 在 `return app` 之前追加：

```python
    if settings.evals_enabled:
        wire_evals(app, sync_engine=sync_engine, llm_factory=llm_factory, settings=settings)
```

`config.py` 新环境变量：`MA_RUNTIME_EVALS_ENABLED`（恰为 `"1"` 启用，默认关）、`MA_EVAL_ITEM_TIMEOUT_SECONDS`（30–3600，默认 600）、`MA_EVAL_MAX_CONCURRENT_RUNS`（1–8，默认 1）。

### 4.4 core-api：`src/managed-evals.ts`

导出 `RULE_TYPES`、`JUDGE_MODES`、`MAX_CRITERIA_BYTES`、`MAX_RULE_CHECKS`、`DEFAULT_PASS_THRESHOLD`（`as const`）、类型 `EvalRubric`、`RubricResult = { ok; errors; normalized; contentHash }`、函数 `validateRubric(raw: unknown): RubricResult`（规则与错误串与 §6.3 逐字一致，errors `[...].sort()`；hash 用 `canonicalJson` + `node:crypto` sha256，前缀 `sha256:`）。`src/index.ts` 追加 `export * from "./managed-evals";`。

### 4.5 iam-core

- `ma-evals.ts`（写，双方言，写法照 `repos/ma-vaults.ts`）：`listEvalDatasets(tenantId)`、`createEvalDataset(tenantId, {name, description}, createdBy)`、`updateEvalDataset(tenantId, id, patch)`、`deleteEvalDataset(tenantId, id)`、`listEvalDatasetItems(tenantId, datasetId)`、`appendEvalDatasetItems(tenantId, datasetId, items[])`（事务：读当前最大 position，追加，更新 `item_count`；超过 500 → 抛 `EvalDatasetLimitError`）、`updateEvalDatasetItem`、`deleteEvalDatasetItem`（删除后**不**重排 position）、`listEvalRubrics`、`createEvalRubric(tenantId, {name, description, content}, createdBy)`（先 `validateRubric`，失败抛 `EvalRubricInvalidError(errors)`）、`updateEvalRubric`（content 变化时 `version+1`、`content_hash` 更新）、`deleteEvalRubric`。名称冲突 → `EvalNameConflictError`。
- `ma-evals-read.ts`（只读）：`listEvalRuns(tenantId, {agentId?, limit<=100, cursor?})`、`getEvalRun(tenantId, id)`、`listEvalResults(tenantId, runId, {status?, limit<=500, offset})`、`listEvalCandidates(tenantId, {agentId?})`、`getEvalCandidate(tenantId, id)`。

### 4.6 admin-console

`src/lib/ma/runtime-internal-client.ts`：

```ts
export class MaRuntimeUnavailableError extends Error {}
export class MaRuntimeRequestError extends Error { constructor(readonly status: number, readonly code: string, message: string) }
export async function runtimeInternal<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T>;
// base = process.env.MA_RUNTIME_INTERNAL_URL?.trim() || "http://127.0.0.1:8092"; token = getMaInternalToken()
// token 为空 -> MaRuntimeUnavailableError("运行时内部令牌未配置")
// fetch 15s 超时（AbortController）；网络错误 -> MaRuntimeUnavailableError("评测运行时不可达")
// 非 2xx -> MaRuntimeRequestError(status, error.code, error.message)
```

`src/lib/ma/eval-dataset-parse.ts`：`parseEvalItems(format: "json" | "jsonl" | "csv", text: string): { items: EvalItemInput[]; errors: string[] }`：
- JSON：顶层数组；每项对象，`query`（必填非空字符串），`expected_answer` 或 `expectedAnswer`（可选字符串），`expected_tool_trace` 或 `expectedToolTrace`（可选：字符串数组；也接受 `[{tool_name|name: string}]` 并取名字），`tags`（可选字符串数组）；未知键忽略。
- JSONL：每个非空行一个对象，规则同上。
- CSV：RFC 4180（双引号转义、字段内换行），首行表头，必须含 `query` 列，可选 `expected_answer` 列；不引入新依赖，手写解析。
- 错误串（第 n 条，从 1 计）：`第 <n> 条：缺少 query`、`第 <n> 条：query 超过 20000 字`、`第 <n> 条：expected_answer 超过 20000 字`、`第 <n> 条：expected_tool_trace 格式不正确`、`内容不是合法的 JSON 数组`、`第 <n> 行不是合法的 JSON`、`CSV 缺少 query 列`、`最多 500 条`。有任何错误则整批不写入。

`src/lib/ma/eval-compare.ts`：`compareEvalRuns(base: EvalRunView, target: EvalRunView, baseResults, targetResults): EvalComparison`（形状 §6.5）；`dataset_hash` 或 `rubric_hash` 不同 → 抛 `EvalCompareMismatchError(<中文原因>)`。

接口（响应 `{code:"00000", message:"ok", data}`；失败 `{code, message}` 中文；读 `requireAdminScope(["provider:read"])`、写 `["provider:update"]`，与 `/api/admin/agents` 一致）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET / POST | `/api/admin/ma-evals/datasets` | 列表 / 新建 `{name, description?}` |
| GET / PATCH / DELETE | `/datasets/[datasetId]` | 详情含 `item_count` / 改名与描述 / 删除（不影响已有评测任务） |
| GET / POST | `/datasets/[datasetId]/items` | 列表 / 追加：`{items:[…]}`（粘贴已解析）或 `{format:"json"|"jsonl"|"csv", text}`（上传，服务端解析） |
| PATCH / DELETE | `/datasets/[datasetId]/items/[itemId]` | 编辑 query / 期望回答 / 期望工具轨迹 / 标签；删除 |
| POST | `/datasets/[datasetId]/items/import-session` | `{session_id, use_answer_as_expected?: boolean}`：`getMaSession` 不存在 → 404「会话不存在」；`query` = 第一条 `user.message` 的 text 块（无 → 400「该会话没有用户消息」）；`use_answer_as_expected` 为 true 时 `expected_answer` = 最后一条主线程 `agent.message` 文本；`source_session_id` = 会话 id |
| GET / POST | `/rubrics` | 列表 / 新建 `{name, description?, content}`（校验失败 400，`errors` 列表原样带回） |
| GET / PATCH / DELETE | `/rubrics/[rubricId]` | PATCH content 变化 → `version+1` |
| GET / POST | `/runs` | 列表（读 PG）/ 发起评测：`{agent_id, agent_version, environment_id?, dataset_id, rubric_id, memory_store_ids?: string[] (≤8), concurrency?: 1..4}`：校验版本存在（`getAgentVersion`）、评测集非空、环境（若给）为 `cloud`，组装 §6.4.1 快照调 `runtimeInternal("POST", "/internal/ma/eval-runs", …)` |
| GET | `/runs/[runId]?status=&offset=&limit=` | 任务 + 结果分页（读 PG） |
| POST | `/runs/[runId]/cancel` | 调内部 cancel |
| POST | `/runs/[runId]/iterate` | `{optimizer_model}`（须匹配 `MODEL_RE`）→ 内部 `eval-iterations` |
| GET | `/candidates?agent_id=` | 读 PG |
| POST | `/candidates/[candidateId]/apply` | §4.6.1 |
| POST | `/candidates/[candidateId]/discard` | 内部 status `discarded` |
| GET | `/compare?base=&target=` | 两个任务都 `completed` 且 `kind==="eval"`；不满足或 hash 不同 → 400 中文原因 |

运行时不可达 → 503「评测运行时不可达，请确认 agent-runtime 已启动并开启评测」；`MaRuntimeRequestError` → 原状态码 + 中文映射（400 原样带 message；404「评测任务不存在」；409「该候选已处理」）。

#### 4.6.1 「创建候选版本」（`apply`）

```ts
const cand = await getEvalCandidate(tenantId, candidateId);           // 不存在 404
if (cand.status === "applied") return ok({ version: cand.appliedVersion, created: false });
if (cand.status !== "proposed") return fail(409, "该候选已被丢弃");
const agent = await getAgentWithMa(tenantId, cand.agentId);
let routingPinned = false;
if (agent.lifecycle === "published" && agent.versionRouting === "follow_latest") {
  await updateAgentMaSettings(tenantId, agent.id, { versionRouting: "pinned", pinnedVersion: agent.effectiveVersion });
  routingPinned = true;
}
const created = await createAgentVersion(tenantId, agent.id, {
  manifest: cand.manifest, expectedLatestVersion: agent.latestVersion,
  note: `评测候选 ${cand.id}（基于 v${cand.baseVersion}）`, createdBy: adminUserId, source: "admin",
});   // AgentVersionConflictError -> 409「智能体版本已被他人更新，请刷新后重试」；AgentManifestInvalidError -> 400 带 errors
await runtimeInternal("POST", `/internal/ma/eval-candidates/${cand.id}/status`,
  { tenant_id: tenantId, status: "applied", applied_version: created.version.version, decided_by_user_id: adminUserId });
// 这一步失败 -> 502「已创建版本 v{N}，但候选状态未更新，请重试」（重试时 createAgentVersion 因 hash 相同返回 created:false，不会重复建版本）
return ok({ version: created.version.version, created: created.created, routing_pinned: routingPinned,
            effective_version: (await getAgentWithMa(tenantId, agent.id)).effectiveVersion });
```

#### 4.6.2 页面 `agent-evals.tsx`

用 `@agenticx/ui` 的 `PageHeader`、`Tabs`、`DataTable`、`Dialog`、`Sheet`、`Progress`、`StatCard`、`Badge`、`Toaster`；样式参照 `agent-environments.tsx`。所有删除用主题化 `Dialog` 二次确认；文案不出现仓库路径与实现细节；i18n 键块 `agentEvals.*`（zh / en 各一份），导航键 `nav.agentEvals`：zh「评测」、en「Evaluations」，图标 `FlaskConical`。

- **评测集**：列「名称、用例数、更新时间、操作」；详情 Sheet 内用例表（问题前 80 字、期望回答有无、来源会话链接 `/ops/logs/managed/<id>`）；「添加用例」对话框三个页签：粘贴 JSON / 上传文件（`.json`、`.jsonl`、`.csv`）/ 从会话导入（输入会话 ID + 「把该会话的最终回答作为期望回答」复选框）；解析错误逐条列在对话框内，不关闭对话框。
- **评分标准**：表单字段「评判说明（textarea）、评判方式（是否通过 / 打分）、通过阈值（打分时显示，0–1）、裁判模型（可选，下拉来自模型服务配置）、规则检查列表（类型下拉 + 值）」；保存失败保留弹窗并显示 `errors`。
- **评测任务**：列「智能体与版本、评测集、评分标准、状态、进度（`Progress` 显示 `done/total` 与百分比）、通过率、均分、发起时间、操作（查看 / 取消 / 自迭代）」；`queued` / `running` 时每 3 秒轮询该行；「发起评测」对话框：智能体 → 版本（列出全部版本，默认当前生效版本）→ 环境（仅 cloud）→ 评测集 → 评分标准 → 记忆库（多选，标注「评测时只读挂载」）→ 并发数。
- **任务详情 Sheet**（`RunDetailSheet.tsx`）：顶部四个 `StatCard`「均分、通过率、未通过、执行异常」，其下注明「执行异常不计入通过率与均分」；结果表可筛「全部 / 未通过 / 执行异常」，展开行显示回答全文、裁判理由、规则检查逐项（通过绿 / 未通过红）、会话链接；按钮「与另一次评测对比」→ `CompareDialog`（只列同评测集同评分标准内容的已完成任务）。
- **对比**：总览「通过率 A → B（±）」「均分 A → B（±）」「修复 n / 退化 n / 不变 n / 异常 n」；明细表默认按「退化」在前排序。
- **候选版本**：列「智能体、基线版本、来源任务、状态（待处理 / 已创建版本 vN / 已丢弃）、创建时间、操作」；详情展示理由与系统提示差异（等宽字体，`+`/`-` 行着色）；「创建候选版本」确认对话框文案：「将基于该候选创建智能体的新版本。当前生效版本不变（若智能体跟随最新版本，会先固定在当前生效版本）。确认后可在新版本上回测，再到智能体页面手动切换生效版本。」成功 toast：「已创建版本 v{N}，当前生效仍为 v{M}」。

导航与注册：`admin-platform-sections.ts` 在 `"agent-memory"` 之后插入 `"agent-evals"`（E07 未合入则在 `"agent-vaults"` 之后）；`[section]/page.tsx` 映射 `"agent-evals": AgentEvalsSection`；`AppShell.tsx` 在 `/admin/agent-memory` 项之后加 `{ href: "/admin/agent-evals", labelKey: "agentEvals", icon: FlaskConical }`，仅当 `process.env.NEXT_PUBLIC_MA_EVALS_UI_ENABLED === "1"` 时渲染（`MA_EVALS_UI_ENABLED` 经 `next.config` 已有的 `NEXT_PUBLIC_` 约定暴露；若无该约定，直接使用 `NEXT_PUBLIC_MA_EVALS_UI_ENABLED` 变量名并在 `.env.local.example` 写明）。

---

## 5. Before / After

| 场景 | Before | After |
|---|---|---|
| 发布前验收 | 只能人工在门户试几轮 | 选版本 + 评测集 + 评分标准一键批量跑，逐条可追溯到托管会话 |
| 比较 v2 与 v3 | 无 | 同一评测集与评分标准跑两次，对比报告列出修复 / 退化 |
| 改进系统提示 | 管理员手改 | 自迭代给出候选（含差异与理由），管理员确认后创建**不生效**的新版本，回测后再手动切换 |
| 评测带记忆 | — | 记忆库只读挂载，用例之间不互相污染 |
| `MA_RUNTIME_EVALS_ENABLED` 未设 | — | 无评测执行器、无内部路由；管理台导航不显示（`NEXT_PUBLIC_MA_EVALS_UI_ENABLED` 未设） |

---

## 6. 数据与协议

### 6.1 迁移（PG / MySQL）

编号：实施时 `ls enterprise/packages/db-schema/drizzle | tail -3` 取末项 +1（当前末项 `0064_ma_memory_stores` / MySQL `0038_ma_memory_stores`；W5 的 E08 / E09 / E10 若先合入会再占号）。master §12 给出的「E08 之后从 PG 0066 / MySQL 0040 起」为参考；本文与 MA-A10 并行时，**先合入者取小号**，journal `idx` 必须连续，另一方顺延。文件名 `<NNNN>_ma_evals.sql`。

PG（逐字）：

```sql
-- Managed Agents 评测与自迭代。
-- 写入方：ma_eval_datasets / ma_eval_dataset_items / ma_eval_rubrics = admin-console；
--         ma_eval_runs / ma_eval_results / ma_eval_candidates = agent-runtime（admin-console 只读）。
-- 分数以千分制整数 score_milli 存储（0..1000）。
CREATE TABLE IF NOT EXISTS "ma_eval_datasets" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(128) NOT NULL,
  "description" varchar(1024),
  "item_count" integer DEFAULT 0 NOT NULL,
  "created_by" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_eval_datasets_tenant_name_uq" ON "ma_eval_datasets" ("tenant_id", "name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_eval_dataset_items" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "dataset_id" varchar(26) NOT NULL REFERENCES "ma_eval_datasets"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "query" text NOT NULL,
  "expected_answer" text,
  "expected_tool_trace" jsonb,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "source_session_id" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_eval_dataset_items_dataset_position_uq" ON "ma_eval_dataset_items" ("dataset_id", "position");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_eval_rubrics" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(128) NOT NULL,
  "description" varchar(1024),
  "version" integer DEFAULT 1 NOT NULL,
  "content" jsonb NOT NULL,
  "content_hash" varchar(80) NOT NULL,
  "created_by" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_eval_rubrics_tenant_name_uq" ON "ma_eval_rubrics" ("tenant_id", "name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_eval_runs" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "kind" varchar(16) NOT NULL,
  "status" varchar(16) DEFAULT 'queued' NOT NULL,
  "agent_id" varchar(26) NOT NULL,
  "agent_version" integer NOT NULL,
  "environment_id" varchar(26),
  "dataset_id" varchar(26),
  "dataset_name" varchar(128) NOT NULL,
  "dataset_hash" varchar(80) NOT NULL,
  "rubric_id" varchar(26),
  "rubric_name" varchar(128) NOT NULL,
  "rubric_version" integer NOT NULL,
  "rubric_hash" varchar(80) NOT NULL,
  "base_run_id" varchar(26),
  "config" jsonb NOT NULL,
  "progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error" text,
  "created_by" varchar(26),
  "claimed_by" varchar(64),
  "heartbeat_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_eval_runs_tenant_created_idx" ON "ma_eval_runs" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_eval_runs_status_created_idx" ON "ma_eval_runs" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_eval_runs_tenant_agent_idx" ON "ma_eval_runs" ("tenant_id", "agent_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_eval_results" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "run_id" varchar(26) NOT NULL REFERENCES "ma_eval_runs"("id") ON DELETE CASCADE,
  "item_id" varchar(26) NOT NULL,
  "position" integer NOT NULL,
  "status" varchar(16) NOT NULL,
  "score_milli" integer,
  "session_id" varchar(26),
  "answer" text,
  "tool_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "stop_reason" varchar(32),
  "rule_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "judge" jsonb,
  "usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "duration_ms" integer DEFAULT 0 NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_eval_results_run_item_uq" ON "ma_eval_results" ("run_id", "item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_eval_results_run_position_idx" ON "ma_eval_results" ("run_id", "position");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_eval_candidates" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "run_id" varchar(26) NOT NULL REFERENCES "ma_eval_runs"("id") ON DELETE CASCADE,
  "base_run_id" varchar(26) NOT NULL,
  "agent_id" varchar(26) NOT NULL,
  "base_version" integer NOT NULL,
  "manifest" jsonb NOT NULL,
  "manifest_hash" varchar(80) NOT NULL,
  "diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "rationale" text,
  "status" varchar(16) DEFAULT 'proposed' NOT NULL,
  "applied_version" integer,
  "decided_by" varchar(26),
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_eval_candidates_tenant_agent_idx" ON "ma_eval_candidates" ("tenant_id", "agent_id", "created_at");
```

MySQL：同表同列，按 `drizzle-mysql/0037_ma_vaults.sql` 的写法逐列翻译：`jsonb` → `json`（默认值 `DEFAULT (JSON_ARRAY())` / `(JSON_OBJECT())`）、`timestamp with time zone DEFAULT now()` → `datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6))`、可空时间 → `datetime(6)`、`PRIMARY KEY` → `CONSTRAINT \`<表>_id\` PRIMARY KEY (\`id\`)`、外键与索引写进 `CREATE TABLE` 内（`CONSTRAINT … FOREIGN KEY … ON DELETE CASCADE`、`UNIQUE INDEX`、`INDEX`），索引名与 PG 相同；`query` / `expected_answer` / `answer` / `error` / `rationale` 用 `text`（MySQL `text` 上限 64 KiB，用例上限 20000 字符的 UTF-8 最坏 80000 字节 → 这三列 `query`、`expected_answer`、`answer` 用 `mediumtext`，在 `ma-schema.test.ts` 中把 `mediumtext` 视作 `text` 族）。drizzle schema（`ma-evals.ts` 两份）列名与类型与 DDL 一一对应。

### 6.2 记录形状（admin-console `eval-records.ts`，snake_case 与 PG 一致）

```ts
type EvalRunView = { id; tenant_id; kind: "eval" | "iterate"; status: "queued" | "running" | "completed" | "failed" | "cancelled";
  agent_id; agent_version: number; environment_id: string | null; dataset_id: string | null; dataset_name; dataset_hash;
  rubric_id: string | null; rubric_name; rubric_version: number; rubric_hash; base_run_id: string | null;
  progress: { total?: number; done?: number; passed?: number; failed?: number; errored?: number };
  summary: { total?: number; passed?: number; failed?: number; errored?: number; pass_rate?: number | null;
             mean_score?: number | null; candidate_id?: string };
  error: string | null; created_by: string | null; started_at; finished_at; created_at };
type EvalResultView = { id; run_id; item_id; position: number; status: "passed" | "failed" | "error";
  score: number | null /* score_milli/1000 */; session_id: string | null; answer: string | null; tool_names: string[];
  stop_reason: string | null; rule_results: { type: string; passed: boolean; detail: string }[];
  judge: { score: number; passed: boolean; reason: string; error: string | null } | null;
  usage: Record<string, number>; duration_ms: number; error: string | null };
type EvalCandidateView = { id; run_id; base_run_id; agent_id; base_version: number; manifest_hash;
  diff: { system?: string }; rationale: string | null; status: "proposed" | "applied" | "discarded";
  applied_version: number | null; decided_by: string | null; decided_at: string | null; created_at };
```

### 6.3 评分标准 `content`（Python / TS 逐字同语义）

```json
{
  "criteria": "回答必须给出月度汇总表；缺数据时说明缺失原因",
  "mode": "score",
  "pass_threshold": 0.7,
  "judge_model": "zhipu/glm-5",
  "rule_checks": [
    {"type": "contains", "value": "汇总", "case_sensitive": false},
    {"type": "tool_called", "name": "file_write"},
    {"type": "max_tool_calls", "value": 20},
    {"type": "stop_reason", "value": "end_turn"}
  ]
}
```

规则（`<i>` 下标，`<v>` 原值 JSON 表示；错误串逐字）：

| # | 条件 | 错误串 |
|---|---|---|
| R1 | 不是对象 | `rubric: must be a JSON object`（短路） |
| R2 | 出现 `criteria/mode/pass_threshold/judge_model/rule_checks` 之外的键 | `rubric.<k>: unknown field` |
| R3 | `criteria` 存在且不是字符串 | `rubric.criteria: must be a string` |
| R4 | `criteria` UTF-8 > 32768 字节 | `rubric.criteria: exceeds 32768 bytes` |
| R5 | `mode` 存在且不在 `[binary,score]` | `rubric.mode: must be one of [binary,score]` |
| R6 | `pass_threshold` 存在且不是 0–1 的数（布尔不算） | `rubric.pass_threshold: must be a number between 0 and 1` |
| R7 | `judge_model` 存在、非 null 且不是匹配 `MODEL_RE` 的字符串 | `rubric.judge_model: must be null or "<providerId>/<modelName>"` |
| R8 | `judge_model` 非 null 且 `criteria` 缺失或为空串（仅在 R3 通过时检查） | `rubric.criteria: is required when judge_model is set` |
| R9 | `rule_checks` 存在且不是数组 | `rubric.rule_checks: must be an array` |
| R10 | 长度 > 20 | `rubric.rule_checks: must contain at most 20 items`（R11–R16 不再检查） |
| R11 | 项不是对象 | `rubric.rule_checks[<i>]: must be an object` |
| R12 | `type` 不在 RULE_TYPES（缺失时 `<v>` 为 `null`） | `rubric.rule_checks[<i>].type: must be one of [contains,not_contains,regex,tool_called,tool_not_called,max_tool_calls,stop_reason], got <v>`（该项其余不查） |
| R13 | 允许键：`contains`/`not_contains` → `type,value,case_sensitive`；`regex` → `type,pattern`；`tool_called`/`tool_not_called` → `type,name`；`max_tool_calls`/`stop_reason` → `type,value`；其余键 | `rubric.rule_checks[<i>].<k>: unknown field` |
| R14 | `contains`/`not_contains` 的 `value` 不是 1–1000 字节非空字符串 → `rubric.rule_checks[<i>].value: must be a non-empty string of at most 1000 bytes`；`case_sensitive` 存在且非布尔 → `rubric.rule_checks[<i>].case_sensitive: must be a boolean` | 见左 |
| R15 | `regex.pattern` 不是 1–500 字节非空字符串 → `rubric.rule_checks[<i>].pattern: must be a non-empty string of at most 500 bytes`；`tool_called/tool_not_called.name` 缺失或非非空字符串 → `rubric.rule_checks[<i>].name: is required` | 见左（正则可编译性**不**在校验期检查，运行期失败记 `invalid regex`，避免两端正则引擎差异） |
| R16 | `max_tool_calls.value` 不是 0–1000 整数 → `rubric.rule_checks[<i>].value: must be an integer between 0 and 1000`；`stop_reason.value` 不在 STOP_REASON_VALUES → `rubric.rule_checks[<i>].value: must be one of [end_turn,requires_action,retries_exhausted,refusal,max_tool_rounds,budget_exceeded,policy_blocked]` | 见左 |
| R17 | 规范化后 `judge_model` 为 null 且 `rule_checks` 为空（仅在无其它错误时检查） | `rubric: must define judge_model or at least one rule check` |

共享 fixture `tests/fixtures/managed_agents/rubric_cases.json`，格式同 `manifest_cases.json`（`{"cases":[{name,input,ok,errors,normalized}]}`），至少：`minimal_rules_ok`（只有一条 contains）、`full_ok`（上例）、`not_object`、`unknown_key`、`bad_mode_threshold`（`mode:"x"`、`pass_threshold:2`）、`judge_without_criteria`、`bad_judge_model`、`rule_checks_not_array`、`too_many_rules`（21 条 contains）、`bad_rule_entries`（`["x", {"type":"len"}, {"type":"contains"}, {"type":"contains","value":"a","case_sensitive":"no"}, {"type":"regex"}, {"type":"tool_called"}, {"type":"max_tool_calls","value":-1}, {"type":"stop_reason","value":"done"}, {"type":"contains","value":"a","x":1}]`）、`empty_rubric`（`{}` → R17）。Python `tests/managed/test_evaluation.py::test_rubric_cases` 与 TS `managed-evals.test.ts` 的 `rubric cases` 都读该文件；两端测试硬编码同一份 `EXPECTED_RUBRIC_HASHES`（ok case），做法同 MA-00 §6.1。

### 6.4 内部接口

#### 6.4.1 `POST /internal/ma/eval-runs` 请求（admin-console 组装）

```json
{
  "tenant_id": "T", "created_by_user_id": "U",
  "agent_id": "01J...", "agent_version": 3, "environment_id": null,
  "dataset": {"id": "01J...", "name": "销售周报回归", "items": [
    {"id": "01J...", "position": 1, "query": "...", "expected_answer": null, "expected_tool_trace": ["file_write"]}
  ]},
  "rubric": {"id": "01J...", "name": "周报标准", "version": 2, "content": { "...": "规范化后的 content" }},
  "memory_store_ids": [],
  "concurrency": 2
}
```

agent-runtime 校验（第一条错误作为 400 `message`）：字段齐全且类型正确（未知键拒绝）；`items` 1–500 条、`query` 非空字符串；`rubric.content` 经 `validate_rubric` 通过；`memory_store_ids` ≤ 8 个字符串；`concurrency` 1–4。写入：`kind="eval"`、`status="queued"`、`dataset_hash = "sha256:" + sha256(canonical_json([{query, expected_answer, expected_tool_trace} 按 position 排序]))`、`rubric_hash = validate_rubric(...).content_hash`、`config = {"dataset": …, "rubric": …, "memory_store_ids": …, "concurrency": …}`。

`POST /internal/ma/eval-iterations`：`base_run_id` 对应任务须属于该租户（否则 404 `eval_run_not_found`）；新任务 `kind="iterate"`、复制 base 的 agent / dataset / rubric 字段、`base_run_id`、`config={"optimizer_model": …}`。

#### 6.4.2 `EvalRun`（内部接口响应）

与 §6.2 `EvalRunView` 相同字段，但不含 `config`。

### 6.5 对比报告

```json
{
  "base": {"run_id": "R1", "agent_version": 2, "summary": {"pass_rate": 0.6, "mean_score": 0.71, "errored": 1}},
  "target": {"run_id": "R2", "agent_version": 3, "summary": {"pass_rate": 0.8, "mean_score": 0.82, "errored": 0}},
  "delta": {"pass_rate": 0.2, "mean_score": 0.11},
  "counts": {"fixed": 3, "regressed": 1, "unchanged": 15, "errored": 1},
  "items": [{"item_id": "I1", "position": 1, "query": "<前 200 字>",
             "base": {"status": "failed", "score": 0.4}, "target": {"status": "passed", "score": 0.9}, "change": "fixed"}]
}
```

`change`：任一侧 `error` 或缺失 → `errored`；`failed → passed` → `fixed`；`passed → failed` → `regressed`；其余 `unchanged`。`items` 排序：`regressed`、`fixed`、`errored`、`unchanged`，同类按 `position`。`delta` 任一侧为 null 时为 null；保留 4 位小数。

---

## 7. FR / NFR / AC

| ID | 需求 | AC（测试文件 :: 用例 :: 断言） |
|---|---|---|
| FR-1 | 表结构 | `db-schema` `ma-schema.test.ts`：6 张表列集合 PG / MySQL 一致（`mediumtext` 视作 `text`）；`schema-parity.test.ts` 表数 = 原值 + 6；`migration-inventory.test.ts` journal 条数、末 tag、`.sql` 数各 +1；agent-runtime `test_tables_parity.py` 新 3 表逐列一致 |
| FR-2 | 评分标准校验双端一致 | `tests/managed/test_evaluation.py::test_rubric_cases`、`managed-evals.test.ts` `rubric cases`；两端 `EXPECTED_RUBRIC_HASHES` 相同 |
| FR-3 | 规则检查 | `test_evaluation.py::test_rule_checks`（参数化：contains 大小写、not_contains、regex 命中 / `invalid regex`、tool_called / not_called、max_tool_calls 边界、stop_reason、expected_tool_trace 子序列 `["a","c"]` 对 `["a","b","c"]` 通过、对 `["c","a"]` 失败且 `detail=="missing c"`） |
| FR-4 | 裁判与计分 | `::test_judge_binary_and_score`（用 `agenticx.evaluation.llm_judge.MockLLMProvider` 返回 `{"passed":true,"reason":"ok"}` → `score==1.0, passed`；score 模式返回 0.65、阈值 0.7 → `passed is False`；返回不可解析文本 → `error=="judge_failed"`）；`::test_score_item_rules_fail_overrides_judge`；`::test_summarize_excludes_errors`（2 passed / 1 failed / 1 error → `pass_rate==0.6667`、`errored==1`） |
| FR-5 | 自迭代纯函数 | `tests/managed/test_eval_iterate.py`：`test_select_failures_order_and_cap`（25 条 failed → 20 条，按分数升序）；`test_parse_iteration_response_tolerates_wrapping`（前后有文本仍解析）；`test_build_candidate_diff_and_hash`（diff 含 `-旧行` / `+新行`，hash 等于 `validate_manifest` 结果）；`test_build_candidate_no_change_raises` |
| FR-6 | 执行器跑通 | `enterprise/apps/agent-runtime/tests/test_evals.py::test_eval_run_end_to_end`（SQLite 引擎 + `create_all` + 该文件既有 fakes 中的注册表；`PerSessionScriptFactory` 让被测 Agent 回答 `本月汇总如下`；2 条用例、规则 `contains:"汇总"`、无裁判：内部接口 201 → 执行器跑完 → `ma_eval_runs.status=="completed"`、`summary.passed==2`、两行结果 `status=="passed"`、`score_milli==1000`、`session_id` 对应会话 `source=="eval"` 且已 `archived`） |
| FR-7 | 只读挂载 | `::test_eval_sessions_mount_memory_read_only`（monkeypatch `SessionService.create_session` 记录请求：`resources==[{"type":"memory_store","memory_store_id":"M1","access":"read_only"}]`） |
| FR-8 | 异常单列 | `::test_requires_action_and_timeout_are_errors`（被测 Agent `bash_exec: always_ask` → 结果 `status=="error"`、`error=="requires_action"`，会话最终 idle；`item_timeout_seconds=1` 且模型脚本 sleep → `error=="timeout"`；`summary.errored==2`，`pass_rate is None`） |
| FR-9 | 续跑与取消 | `::test_stale_run_requeued_and_resumes`（预置 running、`heartbeat_at` 过期、已有 1 条结果的任务 → `requeue_stale()==1`，再跑只执行剩余条目）；`::test_cancel_stops_dispatch`（并发 1、3 条用例，第一条执行中取消 → 最终 `status=="cancelled"`，结果 ≤ 1 条） |
| FR-10 | 自迭代任务 | `::test_iterate_creates_candidate`（base 任务有 1 条 failed；优化模型脚本返回 `{"system":"新提示","rationale":"r"}` → `ma_eval_candidates` 一行 `status=="proposed"`、`manifest.system=="新提示"`、`diff.system` 含 `+新提示`；未创建任何 agent 版本：`registry` 调用记录中无写操作） |
| FR-11 | 内部鉴权 | `::test_internal_routes_require_token`（无 / 错 token → 401；请求体多余键 → 400 `invalid_request`；他租户 run → 404 `eval_run_not_found`；`/ma/v1/` 前缀下不存在这些路径（`GET /ma/v1/internal/ma/eval-runs/x` → 404 或 401）） |
| FR-12 | 数据集解析 | `admin-console/src/lib/ma/__tests__/eval-dataset-parse.test.ts`：JSON（含 `expectedAnswer` 驼峰与 `expectedToolTrace:[{tool_name}]`）、JSONL、CSV（带引号与字段内换行）、缺 query 报 `第 2 条：缺少 query`、501 条报 `最多 500 条`、CSV 无 query 列 |
| FR-13 | 对比 | `eval-compare.test.ts`：修复 / 退化 / 异常计数、排序、`delta`、hash 不同抛错 |
| FR-14 | 管理台接口 | `src/app/api/admin/ma-evals/__tests__/routes.test.ts`（`vi.mock("@agenticx/iam-core")` 与 `runtime-internal-client`）：`POST /runs` 组装的快照字段与 §6.4.1 一致、`memory_store_ids` 透传；运行时不可达 → 503 文案；`POST /candidates/:id/apply` 对已发布跟随最新 Agent 先 `updateAgentMaSettings({versionRouting:"pinned", pinnedVersion: effective})` 再 `createAgentVersion`（`invocationCallOrder` 断言），再调内部 status；内部 status 失败 → 502 文案含版本号；已 applied 的候选再次 apply 不调 `createAgentVersion`；`import-session` 取第一条用户消息、`use_answer_as_expected` 取最后主线程回答 |
| FR-15 | iam-core 仓储 | `iam-core/src/repos/__tests__/ma-evals.test.ts`：追加用例 position 连续、`item_count` 同步、超过 500 抛 `EvalDatasetLimitError`、评分标准非法抛 `EvalRubricInvalidError` 带 errors、content 变化 version+1、名称冲突抛 `EvalNameConflictError` |
| FR-16 | 页面 | `RunDetailSheet.test.tsx`：四个统计卡、「执行异常不计入通过率与均分」提示可见；筛选「执行异常」只显示 error 行；展开行显示裁判理由与规则逐项；`admin-platform-sections.test.ts` 含 `agent-evals` |
| NFR-1 | 默认关闭 | `test_config.py::test_eval_settings_defaults`（`evals_enabled is False`、600、1）；`test_evals.py::test_not_wired_when_disabled`（未开启时 `/internal/ma/eval-runs` 404） |
| NFR-2 | 不改既有行为 | `pytest tests/managed -q`、agent-runtime 全量测试、`pnpm -C enterprise --filter @agenticx/admin-console test` 全绿 |
| NFR-3 | 进度可见 | 运行中任务列表行显示 `done/total` 与百分比（`RunDetailSheet.test.tsx` 或 `RunsTab` 测试断言 `Progress` 的 `value`），符合「耗时操作暴露真实进度」 |

---

## 8. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
# 段一 evals-schema
pytest tests/managed/test_evaluation.py tests/managed/test_eval_iterate.py -q
pnpm -C enterprise --filter @agenticx/core-api test && pnpm -C enterprise --filter @agenticx/core-api typecheck
pnpm -C enterprise --filter @agenticx/db-schema test
# 段二 evals-runtime
(cd enterprise/apps/agent-runtime && PYTHONPATH="/Users/damon/myWork/AgenticX:$PWD" pytest tests -q)
# 段三 evals-admin
pnpm -C enterprise --filter @agenticx/iam-core test && pnpm -C enterprise --filter @agenticx/iam-core typecheck
pnpm -C enterprise --filter @agenticx/admin-console test && pnpm -C enterprise --filter @agenticx/admin-console typecheck
pnpm -C enterprise --filter @agenticx/admin-console build
pytest tests/managed -q

# 实库演示（确认 shell 无残留 DATABASE_URL；用契约备忘中的 ma-pg-test 容器）
pnpm -C enterprise db:migrate     # 实施时以 enterprise/package.json 中的迁移脚本名为准
MA_RUNTIME_EVALS_ENABLED=1 bash enterprise/scripts/start-dev.sh --with-agent-runtime
# 管理台 NEXT_PUBLIC_MA_EVALS_UI_ENABLED=1：建评测集（粘贴 2 条）→ 建评分标准（contains）→ 发起评测 → 看进度到 100% → 详情 → 自迭代 → 创建候选版本 → 在新版本回测 → 对比
```

---

## 9. 回滚

- 开关：agent-runtime `MA_RUNTIME_EVALS_ENABLED`（默认关：不挂执行器与内部路由）；管理台 `NEXT_PUBLIC_MA_EVALS_UI_ENABLED`（默认关：导航不显示，直接访问 `/admin/agent-evals` 仍可打开但发起评测返回 503）。
- 代码回滚：按三段 commit 逆序 revert。迁移为纯新增表，回滚代码不需要回滚迁移；如需删表另写 down 脚本（不在本文）。
- 已创建的候选版本是普通 Agent 版本，回滚后保留；被固定的路由需管理员在版本页手动改回「跟随最新」（回滚说明写明）。

---

## 10. 不变量

1. 评测不修改被测 Agent：执行器对 `enterprise_agents` / `enterprise_agent_versions` 零写入；只有管理员点「创建候选版本」才新增版本，且当前生效版本不变。
2. 所有模型调用（被测会话、裁判、优化）经 `GatewayLLMFactory`。
3. 评测会话挂载的记忆库一律 `read_only`。
4. 执行异常不计入通过率与均分。
5. 已有表、`/ma/v1/*` 公共接口、门户、Near 行为不变。
6. 管理台文案不出现仓库路径、表名、环境变量名（`.env.local.example` 除外）。

---

## 11. 须登记 master §12 / 待用户确认

- **登记**：① 新增 admin-console → agent-runtime 内部接口 `/internal/ma/eval-*`（Bearer `MA_INTERNAL_TOKEN`，不经 nginx 对外）与 admin-console 环境变量 `MA_RUNTIME_INTERNAL_URL`；② 6 张评测表与写入方切分（D2）；③ 内部接口局部错误码 `eval_run_not_found` 404、`eval_candidate_not_found` 404、`eval_candidate_decided` 409；④ 自迭代 v1 只改系统提示、候选不自动成为版本、创建候选版本前固定路由（D9 / D10）；⑤ 评测会话照常计入 MA-E10 用量；⑥ 迁移编号按实施时末项 +1，与 MA-A10 先合入者取小号。
- **待确认**：Q1 v1 不做 XLSX、AI 生成用例、自定义工具 mock，是否接受；Q2 评测入口只在管理台（无公开 API / CLI），是否接受；Q3 裁判模型与优化模型由管理员每次选择（不设租户默认），是否接受。
