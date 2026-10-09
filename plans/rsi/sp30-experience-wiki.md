# SP30 (Master Plan): 经验库 Wiki 化——分级上下文 + 编译层内化（OpenViking / LLM-Wiki 启发）

> 定位：master plan，描述需求与端到端验收标准，拆解为 SP30a/SP30b/SP30c 三个子规划分别实施。
> 状态：待评审
> 参考：`research/OpenViking/`（字节 OpenViking，Rust+Python）、`research/openwiki/`（langchain-ai OpenWiki，TS）

## 一、需求与动机

### 外部来源

2026.4 Karpathy 提出 LLM-Wiki 范式：在原始资料与用户之间增加一层由 LLM 维护的持久化 Markdown Wiki（编译层）。字节 OpenViking 与 langchain-ai OpenWiki 是该范式的两个工程实现。代码级调研已验证其核心机制（见附录 A）。

### AGX 现状痛点（内化的对症点）

现有经验库 `envharness/envharness/reasoning_bank/bank.py`：

1. **扁平卡片 + 整卡注入**：`MemoryItem` 是无层级文本块，检索后把完整 `content` 拼进 prompt（`reasoning_bank_eval.py` L176-217）。经验数量增长时 token 成本线性上升，与"prompt compression 7-50x"的既有约束方向相悖。
2. **append-only 无生命周期**：`Bank.add()` 只增不改不合并，无"新证据修正旧结论"的通道——经验库里会复现推文开头的"老王 vs 小李"口径打架问题（同一问题多条互斥经验，检索命中哪条全看 embedding 距离）。
3. **无适用条件一等公民**：`source` dict 有 provenance 但检索时不做条件过滤，经验不区分环境版本/任务类型/模型，跨域注入有污染风险（与 SP26 多域任务池扩展后的风险直接叠加）。
4. **无增量结构化产物**：episode 结束后沉淀的是原始轨迹和 flat card，没有"编译成结构化知识（method/analysis 页 + 来源 + 矛盾标记）"的环节；SP16 的 freeze 生命周期、SP13 的泄漏审计门都作用在 flat card 上，缺少可审计的知识层。

### AGX/Near 全局图景：统一上下文层（北极星）

对照 OpenViking 五层架构盘点 AGX/Near 现状（已代码核实）：

| 层 | AGX/Near 现状 | 差距 |
| --- | --- | --- |
| 资源接入 | Near connectors + ingest jobs（`desktop/src/components/settings/knowledge/`） | 基本齐 |
| 语义层（分级） | 无 L0/L1 分级预算纪律 | **缺**（统一语义层未建） |
| 编译层 | `agenticx/brain/wiki_compiler.py` 已有（two-step LLM ingest，产出 entities/concepts/sources/synthesis + compile 队列） | 缺增量更新（freshness）、矛盾标记、claim 级溯源、适用条件 |
| 产物层 | `wiki/` 目录 + 桌面端 WikiBrowseView（树+图谱双视图） | 基本齐 |
| 底座统一 | **memory（`agenticx/memory/`）/ brain-kb / 实验 reasoning_bank 是三个孤岛** | 缺统一寻址 + 分级语义 |

**北极星叙事**：OpenViking 的本质不是"更好的记忆"，而是统一上下文底座——memory 与 KB 共用同一套寻址和分级语义（其 memory 目录走同一个 SemanticProcessor 生成 L0/L1，已代码证实），灵魂是编译层（"用过即校准"：新证据更新同一套知识而非再生成一份新答案）。AGX 的终局是三个孤岛并一个底座。

**本计划是第一块拼图**：在 reasoning_bank 上验证机制（有实验验收、能出论文数据），产物格式直接对齐 Near 已有 wiki 约定（零 UI 成本进 WikiBrowseView），增量编译机制设计成可回馈 `wiki_compiler` 的形式。后续扩展（不在本计划内）：brain/kb 侧接入分级语义与增量编译 → memory 与 kb 并底座。

### 目标（一句话）

把经验库从"向量检索的扁平卡片堆"升级为"分级（L0/L1/L2）+ 结构化（wiki 页面类型）+ 带适用条件与矛盾标记 + 增量编译"的知识层，人和 Agent（训练注入、自探索、消融实验）共用同一套产物；产物格式对齐 Near wiki 约定，桌面端零 UI 改动可读。

### 非目标（明确不做）

- 不引入 OpenViking 服务/容器/Rust 依赖；机制内化为纯 Python 标准库 + 现有 embed 依赖。
- 不做多源 Connector（飞书/Git/网页接入）——AGX 的"源"就是轨迹、实验产出和结论目录。
- 不动 RSI 主线（3-seeds 复跑、A2/A5 训练）的关键路径；本计划可并行推进，实验消费点复用现有 eval harness。
- 不做新 UI/可视化组件（复用桌面端已有 WikiBrowseView，见 E2E-6）。
- 不做 brain/wiki_compiler 的直接改造（本计划只保证机制可回馈，回馈另立项）。

## 二、端到端验收标准（master 级）

以 WebArena（现有 reasoning_bank 消费点）为主验收场景，SWE-bench 桥接为辅：

**E2E-1 功能闭环**：一轮自探索/eval episode 结束 → 触发增量编译（只处理新增/变更轨迹）→ 产出/更新 wiki 页面（含 index.md、页面 frontmatter、来源链接 trace_id、矛盾标记）→ 下一轮 episode 检索注入走分级路径（L0 粗筛 → L1 定位 → 按需 L2）。

**E2E-2 质量门**：
- 每个页面有且仅有一个 retrieval purpose，frontmatter 含 `type/title/description/scope`（适用条件：domain/env/model 条件字段）；
- 每条 claim 带 trace_id 或实验产物路径来源，编译器禁止无来源写入（对应"never invent"）；
- 新旧经验冲突时不静默覆盖：同主题页面必须保留矛盾双方并标注各自来源与适用条件（对应"distinguish/contradiction"）。

**E2E-3 效果与成本（实验验收，≥3 seeds，Wilcoxon 门控）**：
- 检索注入 token 成本：分级路径 ≤ flat 基线的 40%（L0+L1 通常只占整卡的一小部分）；
- pass rate 不低于 flat bank 基线（非劣，p>0.05），或显著更优；
- 冲突消解：构造 ≥10 组"互斥经验"注入用例，分级路径的冲突误用率（注入不适用经验）显著低于 flat 基线。

**E2E-4 兼容与回归**：
- 现有 `Bank.load/save` 与 flat JSONL 格式保持可读（迁移脚本双向转换）；
- `reasoning_bank_eval.py` 的 soft/strikt gate 行为在 flat 模式下逐字节不变；
- hints 注入 gating（bug rate ≥15%、≤3 签名）逻辑不变，仅替换其数据源。

**E2E-5 审计**：编译产物带 `freshness` 元数据（未消化条目计数），且与 SP13 泄漏审计门衔接：进入 wiki 的 claim 必须通过"公共接口可复现"检查（复用既有 gate 挂载点）。

**E2E-6 桌面端可见性（零 UI 改动）**：SP30b 编译产物落盘遵循 Near 既有 wiki 约定（`wiki/` 目录 + `entities/concepts/synthesis` 子目录 + frontmatter `type/title` + `sources` 字段，见 `agenticx/brain/wiki_compiler.py` 的 `_wiki_root`/`_safe_wiki_path`），桌面端 WikiBrowseView（`desktop/src/components/wiki/WikiBrowseView.tsx`）无需任何改动即可树形/图谱双视图渲染 SP30 产物，`listWikiPages/listWikiGraph` API 返回 SP30 页面。新增页面类型（`method`/`analysis`）在 TYPE_COLOR 缺省色系内降级显示即可（不要求前端改色）。

## 三、子规划拆解

### SP30a：分级存储与检索（改 bank.py，无 LLM 依赖）

- MemoryItem 扩展：`level`（0/1/2）、`scope`（domain/env/model 适用条件 dict）、`status`（active/superseded/contradicted）；L0 从 L1 body 首段提取（对齐 OpenViking "L0 抽取自 L1"）。
- `Bank.retrieve` 升级为两阶段：先在 L0 embedding 上 top-k 粗筛 → scope 条件过滤 → 返回 L1（含导航摘要）；新增 `read_detail(id)` 按需取 L2。
- 迁移脚本：flat JSONL → 分级（L1=原 content，L0=首段摘要截断）。
- 验收：单元测试覆盖分级检索、scope 过滤、格式兼容（E2E-4 的一部分）；embedding 调用次数 ≤ 现有（L0 向量单独索引）。

### SP30b：经验编译层（episode → wiki，LLM 依赖）

- 页面类型学：以 Near 既有 wiki 约定为基（`entities/concepts/synthesis/sources` 目录 + frontmatter），扩展 `method`（调试 playbook/操作程序）与 `analysis`（跨任务结论）两个新类型（对齐 llm-wiki 模板）；`index.md` 导航页。
- 编译器管线（对齐 OpenViking Contract 思想）：extract（从轨迹/笔记抽事实，规则式起步沿用 SP16 决策）→ reduce（同主题合并）→ synthesize（成页）→ finalize（index 同步 + 链接校验 + freshness 更新）。
- 增量更新：以 trace_id + 输入指纹判定变更，未变页面不重写；同主题已有页面走 integrate-merge（保留仍有效的旧 claim，标记被推翻的），绝不整页覆盖。
- 矛盾与适用条件：`distinguish` 语义进 `scope` 字段；冲突双方保留 + 各自 provenance。
- **可回馈性约束**：增量更新引擎（freshness 判定 + integrate-merge）实现为独立模块（不 import reasoning_bank），接口设计兼容 `brain/wiki_compiler.py` 的 `WikiCompileResult`/`_safe_wiki_path` 约定，使后续回馈 brain 侧零重写。
- 验收：编译冒烟（固定小轨迹集），golden-file 对比页面结构；无来源 claim 写入被拒（负例测试）；E2E-6 桌面端渲染验证。

### SP30c：消费侧与实验验证（接 eval harness，出论文数据）

- `reasoning_bank_eval.py` 增加 `--retrieval {flat,tiered}` 与 `--bank-format {flat,wiki}` 参数（对照实验作为受控参数，对齐 assembly protocol 的做法）；
- 检索注入模板升级：注入的是"何时查/怎么核实/怎么答"的导航语义（对齐检索 Skill 四要素），L2 按需展开由 policy 决定；
- 跑 E2E-3 实验：flat vs tiered × ≥3 seeds，token 成本、pass rate、冲突误用率三指标，Wilcoxon 报告；
- 论文接口：结果作为 context engineering 消融组件进入 draft.md（§5 附表候选），叙事衔接 prompt compression 与 SETA 收益趋缓论点。
- 验收：E2E-1/E2E-3/E2E-5 全量通过。

### 依赖关系

SP30a ⟂ SP30b（可并行）；SP30c 依赖两者。SP30b 的泄漏审计挂载点依赖 SP13 已有 gate（已实现）。

## 四、风险与对策

| 风险 | 对策 |
| --- | --- |
| 编译引入 LLM 成本，违背"非论文必要工程延后"纪律 | 编译用便宜模型/规则式起步（SP16 同款决策）；实验消费点先跑通再谈编译频率 |
| 经验膨胀后 L1 也变贵 | L1 预算上限（对齐 OpenViking 4000 字符预算 + 完整句子截断）；freshness 10% 阈值延迟刷新 |
| 与 SP16 freeze 生命周期冲突 | freeze 语义映射为"编译窗口关闭"，wiki 的 integrate-merge 只发生在窗口内 |
| wiki 化后检索质量反而下降（摘要丢信息） | E2E-3 非劣门：不显著劣于 flat 才允许切换默认值 |
| 主线被干扰 | 全部改动在 rsi 分支；3-seeds 复跑优先级不变，SP30c 实验排在复跑之后调度 |

## 附录 A：外部机制代码级验证结论（已核实）

1. **L0/L1/L2**（`research/OpenViking/docs/en/concepts/03-context-layers.md`）：L0=`.abstract.md`（256 字符，向量检索用）、L1=`.overview.md`（4000 字符，rerank+导航）、L2=原始文件按需加载；目录级 sidecar 而非每文件；freshness 增量（`pending_child_changes`、稳定采样 32 上限、10% 阈值刷新）；生成自底向上 `file summaries → leaf L1 → leaf L0 → parent`。
2. **Compile**（`bot/vikingbot/compile/plan.py` L185-238、`entry.py` L21-68）：Skill 驱动的 Map/Shuffle/Reduce/Finalize 流水线；`Contract` 定义 extract/reduce/synthesize/routing/`distinguish`（适用条件字段名→提取指令，非分组键）/`output_format=wiki`；已有路径保存需走历史比较（增量而非覆盖）。
3. **llm-wiki 模板**（`examples/compile/ov-compile-skills/llm-wiki/SKILL.md`）：六种页面类型（entity/concept/method/comparison/analysis/summary）+ index 导航页；核心纪律：来源就近标注、禁止捏造、矛盾保留 provenance、integrate-rather-overwrite、更新前先读全文、质量门检查清单。
4. **OpenWiki**（`research/openwiki/src/`）：claim 级 evidence grounding（`okf/claim-sources.ts`：source 稳定 ID `openwiki-source-*`，版本化判定失效 claim）；生成计划 `ProposedPlanPage/ProposedPageClaim`（`generation/page-jobs.ts`）；MCP 工具面 `openwiki_search/read/begin/submit_plan/next_page/finish`（`integrations/mcp/server.ts`）。
5. **AGX 现状**（`envharness/envharness/reasoning_bank/bank.py` L44-151）：flat MemoryItem + cosine/MMR top-k + 整卡拼 prompt（`reasoning_bank_eval.py` L176-217 的 soft/strikt gate 为注入语义雏形）。
6. **Near 已有 wiki 产物链**（本次调研新发现，均代码核实）：`agenticx/brain/wiki_compiler.py`（two-step LLM ingest 编译器，产出 `wiki/{entities,concepts,sources,synthesis}` + compile 队列 `wiki_compile_queue.py`）；桌面端 `desktop/src/components/wiki/WikiBrowseView.tsx`（树+ReactFlow 图谱双视图、页面类型着色 summary/entity/concept/synthesis/comparison、来源引用）与 `settings/knowledge/KnowledgeWikiPanel.tsx`（编译状态面板，`listWikiCompiles` API）。这证明 Near 已具备 OpenViking 五层架构的产品级雏形，SP30 的产物与机制可直接挂载。

## 附录 B：推文未讲清、靠代码澄清的点

- "L0/L1/L2 分级"并非复杂索引技术，本质是目录级两个隐藏 Markdown sidecar + 预算约束（256/4000 字符）；价值在"检索输入与注入输出的预算纪律"而非算法。
- "Compile"不是魔法，是把 Skill 声明编译成数据流计划（Map/Shuffle/Reduce），增量性来自 record 级流转与已有产物历史比较，而非全文 diff。
- 推文未提的最有价值机制：① `distinguish` 把"适用条件"做成编译契约的一等公民；② freshness 元数据让"知识滞后"显式可读；③ OpenWiki 的 claim 级溯源让增量更新能定位到"哪条事实失效"，比页面级 diff 粒度细一档。
- 推文的商业部分（火山方舟导流、AITutor 广告）与工程机制无关，吸收时已剥离。
