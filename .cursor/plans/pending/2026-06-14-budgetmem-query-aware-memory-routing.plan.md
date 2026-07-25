# Plan: 记忆系统 query-aware 预算路由 + 召回后结构化精炼（参考 BudgetMem）

Plan-Id: 2026-06-14-budgetmem-query-aware-memory-routing
Status: draft (待用户确认后执行)
Owner: Damon Li
实施模型预期: composer-2.5（本 plan 已按"精确到文件/函数/签名/禁改项"编写，便于该模型高质量落地）

---

## 0. 给实施者（composer）的阅读须知

- 本 plan 每一步都给了**精确文件路径 + 函数名 + 行号锚点 + 输入输出契约**。
  行号是编写时快照，若有偏移，请用函数名/字符串锚点定位，不要凭空猜。
- **严格遵守 `no-scope-creep`**：只改本 plan 明确点名的代码路径。看到"顺手能优化"
  的旧逻辑一律不动。每个改动必须能对应到下面某条 FR。
- Python 代码遵守 `google-python-style`：英文注释/docstring、文件头含
  `Author: Damon Li`、禁用相对 import、代码里无 emoji。
- 每个 Phase 结束必须让对应冒烟测试通过后再进下一个 Phase。
- 默认全部新增能力**带 feature flag 且默认 OFF/LOW**，保证不打开开关时
  线上行为与现状完全一致（零回归）。

---

## 1. 背景与现状（事实基础，执行前必读）

### 1.1 现有记忆召回链路（已核实，不要误判为"什么都没有"）

主召回入口：`agenticx/memory/recall.py::search_memory_for_chat`（L176）：
- 三路来源做 RRF 融合：`workspace`（文件 chunk）+ `turn`（历史对话轮归档）+
  `graph`（记忆图谱），见 `_merge_recall_results`（L125）。
- turn 召回带 halflife 衰减（`_TURN_RECALL_HALFLIFE_DAYS=7`）与命中后 reinforce
  强化（`reinforce_turns_sync` / `reinforce_chunks_sync`，L263/L273）。
- 文本检索 = `WorkspaceMemoryStore.search_sync`（BM25 + 向量混合），
  默认 embedding provider 为 `hashing-v1` / `hashing-64d`
  （`workspace_memory.py` L95-96）——即**本地哈希向量，不是真语义 embedding**。

prompt 注入入口：`agenticx/runtime/prompts/meta_agent.py::_build_memory_recall_context`
（L282），由 `build_meta_agent_system_prompt`（L642/L846）拼进系统提示：
- query = 最近 5 条 user 消息拼接、截断 500 字（L287-293）。
- **召回参数恒定**：`limit=5, mode="hybrid"`（L328-336），无论 query 难易。
- 注入方式：把每条命中的**原始 chunk 文本截断 200 字**直接列出（L350-357），
  总预算约 500 字。**没有任何"按 query 重组/提炼"的步骤**。

### 1.2 与 BudgetMem 论文的差距（本 plan 要补的洞）

BudgetMem 核心两点：
1. **query-aware budget-tier routing**：按 query 复杂度给记忆处理分配 LOW/MID/HIGH
   成本档位（论文用 RL 训 Router）。
2. **runtime query-focused extraction**：召回后用模块化 pipeline
   （Filtering → Entity/Temporal/Topic → Summary）把原始历史**重组**成面向当前
   query 的记忆，而非直接喂原始 chunk。

AGX 现状：以上两点**都没有**。所有 query 走同一套 `limit=5/hybrid` 并注入原始 chunk。

### 1.3 本 plan 的取舍（务实落地，明确不做什么）

- **取** BudgetMem 的"分级路由"思想，但**不引入 RL**（训练成本/冷启动对私有化部署
  不友好）。改用**轻量启发式分类器**做 budget-tier 决策（可解释、零训练、即时可用），
  并预留后续可替换为学习型 Router 的接口。
- **取** BudgetMem 的"召回后结构化精炼"，作为 HIGH 档独有步骤，用一次 LLM 调用把
  召回片段提炼成 query-focused 结构（实体/时间线/摘要）。MID/LOW 不触发 LLM。
- **不做**：替换默认 hashing embedding 为真语义 embedding（见 §7 列为后续独立 plan，
  本 plan 不碰，避免 scope 膨胀与回归面扩大）。
- **不做**：改图谱底层引擎、turn 归档机制、reinforce/decay 算法。
- **不做**：enterprise/ 任何代码。

---

## 2. 目标架构（一句话）

在现有 `search_memory_for_chat` 之上，插入一个 **Budget Router（启发式）**
决定本次召回的档位，再由档位驱动「召回成本 + 是否做结构化精炼」，
让简单 query 走便宜路径、复杂 query 走高质量路径，且全程可配置、可观测、默认零回归。

数据流（新增部分用 *标注）：
```
query
  └─ *BudgetRouter.classify(query, ctx) -> tier(LOW/MID/HIGH) + params
       └─ search_memory_for_chat(..., budget_tier=tier)   # 档位决定 limit/include_graph 等
            └─ 三路 RRF 融合（现有，不改算法）
                 └─ *若 tier==HIGH: MemoryRefiner.refine(query, matches) -> 结构化记忆
                      └─ 注入 prompt（HIGH 注入精炼结构；MID/LOW 注入原始片段=现状）
```

---

## 3. 范围（Scope）与非目标

### In scope
- 后端新增：`BudgetRouter`（启发式分级）、`MemoryRefiner`（HIGH 档结构化精炼）、
  budget 配置读取、召回档位贯通、轻量可观测日志。
- 改造：`search_memory_for_chat` 接受 `budget_tier`；`_build_memory_recall_context`
  调用 Router 并按档位注入。

### Out of scope（本 plan 明确不做）
- 不替换 embedding 后端（哈希→真语义，另起 plan）。
- 不引入 RL / 不做 Router 训练。
- 不改 turn 归档 / 图谱 / decay / reinforce 既有逻辑。
- 不改 Desktop 前端（本期纯后端能力；配置先走 `config.yaml`，UI 后续 plan 再补）。
- 不改 enterprise/。

---

## 4. 需求（FR / NFR / AC）

### FR-1 Budget 配置节
- FR-1.1 在 `~/.agenticx/config.yaml` 支持新节 `memory.budget`：
  ```yaml
  memory:
    budget:
      enabled: false          # 总开关，默认 false=完全保持现状
      default_tier: "mid"     # 关闭路由时的固定档；low|mid|high
      router: "heuristic"     # 仅 heuristic（预留 future: "learned"）
      refine:
        enabled: false        # HIGH 档是否触发 LLM 结构化精炼
        model: ""             # 留空=回退主会话模型；建议填小模型名
        max_input_chars: 4000 # 精炼输入的召回片段总上限
      tiers:
        low:  { limit: 3, include_graph: false, include_turns: true,  turns_limit: 2 }
        mid:  { limit: 5, include_graph: true,  include_turns: true,  turns_limit: 3 }
        high: { limit: 8, include_graph: true,  include_turns: true,  turns_limit: 5 }
  ```
- FR-1.2 新增 `agenticx/memory/budget_config.py`：
  - `load_budget_config() -> BudgetConfig`（dataclass，含上面所有字段 + 安全默认）。
  - 缺节/缺字段一律回退默认；解析异常不抛、返回 `enabled=False` 的安全默认。
  - 与现有 `turn_archive_config.py` 同风格（读取 `~/.agenticx/config.yaml`）。

### FR-2 BudgetRouter（启发式分级）
- FR-2.1 新增 `agenticx/memory/budget_router.py`：
  ```python
  @dataclass
  class BudgetDecision:
      tier: str               # "low" | "mid" | "high"
      reason: str             # human-readable why, for logging
      limit: int
      include_graph: bool
      include_turns: bool
      turns_limit: int
      refine: bool            # 是否做结构化精炼（仅 high 且 refine.enabled 时 True）

  def classify_query(query: str, cfg: BudgetConfig) -> BudgetDecision: ...
  ```
- FR-2.2 启发式规则（纯规则、可解释、可单测；阈值写成模块常量便于调优）：
  - 若 `cfg.enabled is False` → 直接返回 `default_tier` 对应参数，`refine=False`，
    `reason="budget_disabled"`（保证关闭时等价现状）。
  - **LOW** 命中条件（任一）：query 长度 < 12 字符；或匹配"事实/即时"型短问
    （正则覆盖：纯时间/数字问、"是不是/对吗/几点/多少"等极短确认句）。
  - **HIGH** 命中条件（任一）：query 长度 > 80 字符；或包含跨时间/跨实体/聚合类
    信号词（中英双语关键词表常量，如：总结/对比/汇总/为什么/演变/过去.*(周|月|年)/
    所有/逐条/summarize/compare/why/trend/across/timeline 等）；或问号 ≥ 2；
    或同时出现 ≥ 2 个不同实体信号（简单启发式：连续大写词/书名号/引号片段计数）。
  - **MID**：其余默认档。
  - 决策出的 `tier` 再用 `cfg.tiers[tier]` 取 `limit/include_graph/...`；
    `refine = (tier == "high" and cfg.refine.enabled)`。
- FR-2.3 Router 必须是**纯函数**（无 IO、无 LLM 调用），便于单测与零副作用。

### FR-3 召回链路贯通 budget_tier
- FR-3.1 `agenticx/memory/recall.py::search_memory_for_chat` 与 `_sync` 包装：
  新增可选参数 `budget: Optional[BudgetDecision] = None`。
  - 传入时：用 `budget.limit/include_graph/include_turns/turns_limit` 覆盖对应入参。
  - 不传时：**行为与现在完全一致**（不得改变默认调用方语义）。
  - 不在 recall 内部做 LLM 精炼（精炼在调用方/Refiner，保持 recall 纯检索职责）。
- FR-3.2 返回值 `MemoryRecallResult` 增加可选字段 `budget_tier: Optional[str] = None`
  （回填 `budget.tier`），供上层日志/注入分支判断；默认 `None` 不影响旧调用。

### FR-4 MemoryRefiner（HIGH 档结构化精炼）
- FR-4.1 新增 `agenticx/memory/memory_refiner.py`：
  ```python
  @dataclass
  class RefinedMemory:
      entities: list[str]     # query 相关实体
      timeline: list[str]     # 时间线要点（按时间排序的短句）
      summary: str            # 面向当前 query 的整合摘要
      raw_used: int           # 实际纳入精炼的片段数（可观测）

  async def refine_memory(
      query: str,
      matches: list[dict],
      *,
      model: str,
      max_input_chars: int,
  ) -> Optional[RefinedMemory]: ...
  ```
- FR-4.2 实现：把 `matches` 的 text 截断拼接到 `max_input_chars` 内，调用一次 LLM
  （复用项目既有 LLM 调用封装，**禁止新引依赖**；model 为空时回退主会话模型——
  具体回退取值方式参照 `meta_tools` / 既有 provider 解析，实施时就近复用）。
  prompt 要求模型只输出结构化 JSON（entities/timeline/summary）。
- FR-4.3 健壮性：LLM 失败/超时/JSON 解析失败 → 返回 `None`（上层回退到原始片段注入），
  绝不抛异常打断主对话；失败写一条 warning 日志（含原因），不向用户透出。
- FR-4.4 精炼有独立超时（建议常量 20s），避免拖慢 HIGH 档主回复首字延迟。

### FR-5 prompt 注入按档位
- FR-5.1 `meta_agent.py::_build_memory_recall_context`（L282）：
  1. 读取 `load_budget_config()`；构造 query 后调用 `classify_query` 得 `BudgetDecision`。
  2. 调 `search_memory_for_chat_sync(..., budget=decision)`。
  3. 若 `decision.refine` 为 True：调用 `refine_memory(...)`（同步包装，与文件内既有
     sync 调用风格一致）：
     - 成功 → 注入 "## 相关历史记忆（已按当前问题整理）" 段：分「相关实体 / 时间线 /
       摘要」三小节（中文标题），内容来自 `RefinedMemory`。
     - 失败/None → **回退**到现有原始片段注入逻辑（L337-360 不删，作为 fallback）。
  4. `decision.refine` 为 False（LOW/MID/关闭）→ 走现有原始片段注入逻辑（保持现状）。
- FR-5.2 注入预算：精炼段总长度上限沿用约 800 字（HIGH 档略放宽），可写成常量。
- FR-5.3 在 `_build_memory_recall_context` 内打一条 debug 日志：
  `tier / reason / refined(bool) / match_count`，便于线上排障与效果观测。
  日志走既有 logger，不打印用户隐私正文（只打长度/计数/档位）。

### NFR
- NFR-1 零回归：`memory.budget.enabled=false`（默认）时，召回与注入行为**逐字节
  等价现状**（冒烟需断言此点）。
- NFR-2 不新增三方依赖。
- NFR-3 Router 为纯函数、O(query 长度)，单次决策开销可忽略。
- NFR-4 HIGH 档精炼失败必须静默回退，主对话不受影响。
- NFR-5 所有新增配置缺省安全；老 `config.yaml` 无 `memory.budget` 节时正常运行。

### AC（验收）
- AC-1 `enabled=false` 时，对任意 query，`classify_query` 返回 `default_tier`、
  `refine=False`，召回参数与现状一致（冒烟断言）。
- AC-2 `enabled=true` 时：极短确认句 → LOW；含"总结/对比/为什么/过去三个月"等
  长复杂句 → HIGH 且（refine.enabled 时）`refine=True`；普通句 → MID（冒烟断言）。
- AC-3 `search_memory_for_chat(..., budget=decision)` 用 decision 的 limit/graph/turns
  覆盖入参；不传 budget 时行为不变（冒烟断言）。
- AC-4 `refine_memory` 在 LLM mock 成功时返回结构化 `RefinedMemory`；mock 失败时
  返回 `None` 且不抛异常（冒烟断言）。
- AC-5 HIGH 档 + refine 成功 → prompt 含「已按当前问题整理」结构化段；refine 失败
  → 自动回退为原始片段段（冒烟断言，LLM 用 mock）。
- AC-6 全部新增冒烟通过；`agx serve` 重启后手工回归：开关 on/off 各发一条简单问、
  一条复杂问，确认日志档位正确、复杂问注入了结构化记忆。

---

## 5. 实施步骤（分阶段，每阶段独立可验证）

> 顺序即依赖顺序。每个 Phase 跑通对应冒烟再继续。

### Phase 0 — 配置层（无行为变更，风险最低）
1. 新增 `agenticx/memory/budget_config.py`（FR-1.2）：`BudgetConfig` dataclass +
   `load_budget_config()`，读取 `~/.agenticx/config.yaml` 的 `memory.budget`，
   全字段安全默认；参考 `agenticx/memory/turn_archive_config.py` 的读取风格。
2. 冒烟 `tests/test_smoke_budget_config.py`：缺节→默认（enabled False）；
   提供完整节→正确解析；坏值→回退不抛。

### Phase 1 — Budget Router（纯函数，无 IO）
3. 新增 `agenticx/memory/budget_router.py`（FR-2）：`BudgetDecision` +
   `classify_query(query, cfg)`；阈值与关键词表为模块级常量。
4. 冒烟 `tests/test_smoke_budget_router.py`：覆盖 AC-1/AC-2 的 LOW/MID/HIGH 分类，
   含中英双语复杂句、极短句、disabled 短路。

### Phase 2 — 召回贯通 budget（不改融合算法）
5. 改 `agenticx/memory/recall.py`：`search_memory_for_chat` /
   `search_memory_for_chat_sync` 增加 `budget: Optional[BudgetDecision]=None`（FR-3.1），
   用其覆盖 limit/include_graph/include_turns/turns_limit；`MemoryRecallResult` 加
   `budget_tier`（FR-3.2）。**不传 budget 路径必须与现状等价。**
6. 冒烟 `tests/test_smoke_recall_budget_passthrough.py`：传 budget 覆盖参数生效（用
   monkeypatch/桩 store 断言传入 limit 等）；不传 budget 行为不变。

### Phase 3 — MemoryRefiner（HIGH 档精炼，可 mock）
7. 新增 `agenticx/memory/memory_refiner.py`（FR-4）：`RefinedMemory` +
   `refine_memory(...)`，复用既有 LLM 调用封装，JSON 输出，失败返回 None + 超时保护。
8. 冒烟 `tests/test_smoke_memory_refiner.py`：mock LLM 返回合法 JSON→结构化对象；
   mock 抛错/返回非 JSON→返回 None 不抛。

### Phase 4 — prompt 注入按档位（接线，默认关闭零回归）
9. 改 `agenticx/runtime/prompts/meta_agent.py::_build_memory_recall_context`（FR-5）：
   读 budget config → classify → 带 budget 召回 → HIGH+refine 注入结构化段（失败回退
   原始片段）→ debug 日志。**保留**现有原始片段注入分支作为 MID/LOW/fallback。
10. 冒烟 `tests/test_smoke_budget_prompt_injection.py`：
    - enabled=false → 注入文本与旧逻辑等价（AC-1）。
    - enabled=true + HIGH + refine mock 成功 → 含「已按当前问题整理」段（AC-5）。
    - refine mock 失败 → 回退原始片段段（AC-5）。

### Phase 5 — 收尾与回归
11. 跑全部新增冒烟 + 既有 memory 相关冒烟，全绿。
12. 重启 `agx serve`，按 AC-6 手工回归（开关 on/off × 简单/复杂问）。
13. `/commit --spec=.cursor/plans/2026-06-14-budgetmem-query-aware-memory-routing.plan.md`
    分阶段提交（建议）：
    - `feat(memory): budget config 读取层`
    - `feat(memory): 启发式 budget router`
    - `feat(memory): recall 贯通 budget tier`
    - `feat(memory): high 档记忆结构化精炼 refiner`
    - `feat(prompt): 记忆召回按 budget 档位注入`
    每个 commit 含 `Made-with: Damon Li` 与 Plan-Id/Plan-File trailer。

---

## 6. 测试清单（冒烟，pytest，全部可在无网络/LLM-mock 下跑）
- `tests/test_smoke_budget_config.py` — Phase 0
- `tests/test_smoke_budget_router.py` — Phase 1（AC-1/AC-2）
- `tests/test_smoke_recall_budget_passthrough.py` — Phase 2（AC-3）
- `tests/test_smoke_memory_refiner.py` — Phase 3（AC-4，LLM mock）
- `tests/test_smoke_budget_prompt_injection.py` — Phase 4（AC-1/AC-5，LLM mock）

---

## 7. 关键文件索引（执行参考）
新增：
- `agenticx/memory/budget_config.py` — 配置层
- `agenticx/memory/budget_router.py` — 启发式分级（纯函数）
- `agenticx/memory/memory_refiner.py` — HIGH 档结构化精炼（LLM）

改动：
- `agenticx/memory/recall.py` — `search_memory_for_chat(_sync)` 增 `budget` 参数；
  `MemoryRecallResult` 增 `budget_tier`
- `agenticx/runtime/prompts/meta_agent.py` — `_build_memory_recall_context`（L282）
  接线 router + refiner + 档位注入

参考（只读，勿改）：
- `agenticx/memory/turn_archive_config.py` — 配置读取风格范本
- `agenticx/memory/workspace_memory.py` — 检索后端（本期不动 embedding）
- `agenticx/memory/graph/` — 图谱（不动）

---

## 8. 后续（本 plan 之外，单独立项，勿在本期做）
- P2-A：默认 embedding 由 `hashing-64d` 升级为真语义 embedding（DashScope/本地模型），
  这是检索召回质量的根因优化，但回归面大，需独立 plan + 重建索引方案。
  **已拆分独立 plan：`.cursor/plans/2026-06-14-workspace-memory-semantic-embedding-upgrade.plan.md`**。
- P2-B：Budget Router 由启发式升级为学习型（轻量分类模型/在线反馈），接口已在
  FR-2 预留（`router: "learned"`）。
- P2-C：Desktop 设置页暴露 `memory.budget` 开关与档位调节（本期仅 config.yaml）。
- P2-D：召回精炼的 Entity/Temporal 提取下沉为可复用 memory module，对齐 BudgetMem
  的"模块化 + 统一 budget-tier interface"完整形态。

---

## 9. 风险与回退
- 风险：HIGH 档 LLM 精炼增加首字延迟 → 独立超时 + 失败静默回退（FR-4.3/4.4）；
  默认 `refine.enabled=false`，需显式打开。
- 风险：启发式分类误判（复杂问被判 LOW）→ 阈值/关键词为常量，便于快速调优；
  且 MID 为安全默认档，误判代价有限。
- 风险：改 recall 破坏旧调用 → `budget` 为可选且默认 None，NFR-1 冒烟守护等价性。
- 回退：各 Phase 独立 commit 可单独 revert；总开关 `enabled=false` 一键回到现状。
