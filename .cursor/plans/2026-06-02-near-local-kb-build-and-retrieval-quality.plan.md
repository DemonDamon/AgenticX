# Near 本地个人知识库：构建质量 + 检索质量 + UX 提升

**Plan-Id**: 2026-06-02-near-local-kb-build-and-retrieval-quality
**Plan-File**: .cursor/plans/2026-06-02-near-local-kb-build-and-retrieval-quality.plan.md
**Status**: Draft（待用户确认范围后进入实施）
**Author**: Damon Li
**调研依据**: `research/codedeepresearch/{gbrain,llm_wiki,near-knowledge-upgrade}/`

---

## 1. 背景与现状（已核实，非臆测）

Near 的本地文档脑（docs brain）当前完成度：

| 能力 | 现状 | 证据 |
|------|------|------|
| 检索 | **单路向量** embed→Chroma→score_floor，K=5 | `agenticx/studio/kb/runtime.py:890` `KBRuntime.search` |
| 分块 | 仅 `recursive`，800/overlap 80 | `ChunkingSpec`，`contracts.py` |
| 检索配置 | 只有 `top_k / score_floor / mode(auto\|always)` | `RetrievalSpec` |
| 多脑聚合 | 已实现 `by_brain + flat`（**不改**） | `agenticx/brain/search.py` |
| ingest 队列 | 已实现含进度/失败态（**不重写**） | `KBRuntime.ingest_document` + `kb_jobs` |
| 解析 | LiteParse 统一适配（**不重写**） | `LiteParseAdapter` |
| Desktop 面板 | Config/Materials/Debug/Settings 已存在 | `desktop/src/components/settings/knowledge/` |

**已存在但未接线**（重要：避免重复造轮子）：
- `agenticx/retrieval/hybrid_retriever.py` — 三路 graph/vector/bm25（framework 抽象，与 KB 的 `_ChromaBackend` 非同一套）
- `agenticx/memory/hybrid_search.py` — memory 层 BM25+vector（面向 `HierarchicalMemoryRecord`，非 KB chunk）

**已记录缺口**（AGENTS.md / conclusions）：
> 「`hybrid_search.py` 已支持 BM25/vector/hybrid，但 Desktop 调试面板默认只暴露单路检索，三模切换 UI 未开放。」

## 2. 目标

在**不破坏现有单脑/多脑/ingest 链路**前提下：
1. **检索质量**：从单路向量升级到「BM25 + 向量 RRF 融合 + 可选 rerank」，并暴露可调与可观测。
2. **构建质量**：分块策略增强 + ingest 增量缓存 + 失败可读性，降低「切片差/重复烧 token」。
3. **UX**：检索结果分数/来源/命中可读；调试面板三模切换；ingest 真实百分比（复用现有但补齐缺口）。

**路线图分层**：本 plan 覆盖「检索质量 + 构建质量 + UX」（Phase 0–4）为**第一批次**；「compiled wiki 编译层 + synthesis」作为**第二批次**（Phase 5–6）排进同一路线图，但在第一批次验收稳定后再实施。

**本 plan 明确不做**：
- 不引入 gbrain/llm_wiki 源码或 Bun/Postgres 栈（仅借鉴机制思想）。
- 不改 memory graph（Graphiti）与 `memory_search` 边界。
- 不动多脑聚合与分身挂载语义。

---

## 3. 需求块

### FR — 功能需求
- **FR-1** 在 `KBRuntime` 内新增 BM25/关键词检索通道（基于已索引 chunk 文本，sqlite FTS5 或轻量倒排），与现向量通道并存。
- **FR-2** 新增 RRF 融合（`score = Σ 1/(k + rank)`，k 默认 60）合并 BM25 与向量结果；融合后按 `score_floor` 过滤。
- **FR-3** `RetrievalSpec` 扩展 `retrieval_mode: vector|bm25|hybrid`（默认 `vector`，保证向后兼容）与 `rrf_k`、`bm25_weight/vector_weight`（可选权重）。
- **FR-4** 可选 rerank 通道：若 embedding provider 支持 rerank（如 DashScope/SiliconFlow rerank API），hybrid 后对 top-N 重排；不支持则跳过（graceful）。
- **FR-5** Desktop 调试面板（`KnowledgeDebugPanel`）暴露 **vector/bm25/hybrid 三模切换**，展示每条命中的 `bm25_score / vector_score / fused_score / 来源 / chunk_index`。
- **FR-6** 分块策略增强：新增 `contextual`（chunk 前注入文档标题/章节路径做前缀，提升召回）或父子分块之一；`recursive` 仍为默认。
- **FR-7** ingest 增量缓存：按「源文件 content hash + chunking 指纹 + embedding 指纹」判定是否跳过重嵌入；命中则不重复 embed。
- **FR-8** 检索结果在聊天工具卡（`knowledge_search` references）中展示融合分数与来源路径（对齐现有 references UX）。

### NFR — 非功能需求
- **NFR-1** `retrieval_mode=vector` 时行为与现状 **bit-identical**（回归不破坏）。
- **NFR-2** BM25 通道不得引入重型依赖；优先 stdlib sqlite FTS5 或纯 Python 倒排，避免打包体积膨胀（DMG/Windows 内嵌约束）。
- **NFR-3** hybrid 检索 p95 延迟 ≤ 单路向量 ×1.5（本地小库规模）。
- **NFR-4** 所有耗时操作（重建索引/批量 ingest）保留真实百分比进度，不退化为纯 spinner。
- **NFR-5** 失败路径透传具体原因（文件名/类型/异常链摘要），不得仅 `'_type'`/`KeyError` 单 token。

### AC — 验收标准
- **AC-1** 在含「关键词强匹配」与「语义相近」两类 query 的 10 条样本上，hybrid 的 P@5 不低于 vector，且关键词类 query 至少有 1 条明显改善。
- **AC-2** 同一文件二次 ingest（内容未变）→ 0 次 embedding 调用（日志可证）。
- **AC-3** Debug 面板可切换三模并显示分项分数；切到 `hybrid` 与 chat 内 `knowledge_search` 行为一致（复用同一检索函数）。
- **AC-4** `retrieval_mode` 缺省读取旧 config 不报错，默认 `vector`。
- **AC-5** 新增冒烟测试 `tests/test_smoke_kb_hybrid_*.py` 全绿；既有 KB 冒烟测试不回归。

---

## 4. 分阶段实施

### Phase 0 — 设计对齐与契约（0.5 天）
- [ ] BM25 落地方式：**sqlite FTS5** over chunk registry（已定，跨重启持久）
- [ ] `RetrievalSpec` 字段扩展草案 + 默认值（向后兼容）
- [ ] rerank：**列 P1 可选**（Phase 1 仅留接口与 provider 能力探测，不进 MVP 必做）

### Phase 1 — 检索质量（核心，3–4 天）
- [ ] **T1.1** `RetrievalSpec` 增 `retrieval_mode/rrf_k/bm25_weight/vector_weight`；`from_dict` 兼容旧 config（FR-3, AC-4）
- [ ] **T1.2** `KBRuntime` 写入时同步维护 BM25 索引（FTS5 表 `kb_chunks_fts`，随 ingest/delete/clear 同步）（FR-1）
- [ ] **T1.3** `KBRuntime.search` 重构为 `_search_vector` / `_search_bm25` / `_fuse_rrf`，按 `retrieval_mode` 分派；`vector` 模式走原路径（FR-2, NFR-1）
- [ ] **T1.4** `DocsBrainRuntime.search` 透传 mode（默认读 brain config），返回 `RetrievalHit` 增加 `bm25_score/vector_score/fused_score` 元数据（FR-5, FR-8）
- [ ] **T1.5**（P1 可选）rerank 通道 + provider 能力探测，不支持则跳过（FR-4）
- [ ] **T1.6** 冒烟测试：vector/bm25/hybrid 三模 + RRF 正确性 + 回归 bit-identical（AC-1, AC-5, NFR-1）

### Phase 2 — 构建质量（2–3 天）
- [ ] **T2.1** ingest 增量缓存：`brains/<id>/.ingest_cache.json` 记录 `source_hash + chunking_fp + embedding_fp`；`ingest_document` 命中跳过 embed（FR-7, AC-2）
- [ ] **T2.2** 新增 `contextual` chunking 策略（标题/章节前缀注入）；`ChunkingSpec.strategy` 增枚举，默认仍 `recursive`（FR-6）
- [ ] **T2.3** 失败路径透传 traceback 摘要至 ingest report（补齐 NFR-5 缺口，仅补未覆盖处）
- [ ] **T2.4** 冒烟测试：缓存命中跳过 embed、contextual chunk 产出非空（AC-2）

### Phase 3 — UX（与 Phase 1/2 并行收尾，2 天）
- [ ] **T3.1** `KnowledgeDebugPanel` 三模切换 + 分项分数展示（FR-5, AC-3）
- [ ] **T3.2** `KnowledgeConfigPanel` 暴露 `retrieval_mode` 与权重（带说明 tooltip，避免长备注）
- [ ] **T3.3** chat `knowledge_search` references 卡展示融合分数与来源（FR-8）
- [ ] **T3.4** 校验重建/批量 ingest 真实百分比（NFR-4，仅在缺失处补）

### Phase 4 — 评测与文档（1 天）
- [ ] **T4.1** 评测脚本：10 文档 QA + 关键词/语义对照（复用 `near-knowledge-upgrade_eval_plan.md` 子集）
- [ ] **T4.2** 更新 `docs/guides/knowledge-base-mvp.md`：三模检索、增量缓存、contextual chunk
- [ ] **T4.3** `/update-conclusion --plan=...` 更新模块结论

> **里程碑闸门**：Phase 0–4 验收（AC-1～AC-5）通过且稳定后，再进入第二批次 Phase 5–6。

---

### 第二批次：Compiled Wiki + Synthesis（Phase 5–6，待第一批次稳定后实施）

> 借鉴 `llm_wiki`（两步 ingest + wiki 结构 + 图扩展）与 `gbrain`（think/合成 + gap analysis）。
> 详见 `research/codedeepresearch/near-knowledge-upgrade/combined_proposal.md`。

#### Phase 5 — Compiled Wiki 编译层（构建侧升级，约 1–2 周）
- [ ] **T5.1** `agenticx/brain/wiki_compiler.py`：两步 LLM ingest（analysis → generation），prompt 结构参考 `buildAnalysisPrompt/buildGenerationPrompt`，中文本地化
- [ ] **T5.2** 编译产物落盘 `~/.agenticx/brains/<id>/wiki/`（entities/concepts/sources/index.md/overview.md），并复用现有 chunk→Chroma 管线同步入向量库（单一 orchestrator，避免双写不一致）
- [ ] **T5.3** `purpose.md`（脑意图）+ `schema.md`（结构规则）模板：Desktop 知识库设置可编辑（FR-新增）
- [ ] **T5.4** `agenticx/brain/wiki_graph.py`：基于 wikilink + frontmatter `sources[]` 构建检索图，4-signal 相关性（directLink 3.0 / sourceOverlap 4.0 / Adamic-Adar 1.5 / typeAffinity 1.0）
- [ ] **T5.5** 检索增强：在 Phase 1 的 hybrid 基础上接入「图扩展」作为第三信号（`retrieval_mode=hybrid_graph`）
- [ ] **T5.6** Desktop「Wiki」浏览 Tab（只读树形 + preview），可复用 `MemoryGraphExplorer` 图谱可视化思路
- [ ] **T5.7** 冒烟测试：两步 ingest 产出实体页、图扩展命中、删除 material 级联清理编译页

#### Phase 6 — Synthesis 合成层（检索侧升级，约 1 周）
- [ ] **T6.1** `agenticx/brain/synthesis.py`：`synthesize_brain_query` — hybrid_graph 检索 → LLM 组装「带 `[N]` 引用 + gap/staleness 段」答案
- [ ] **T6.2** 新增可选工具 `knowledge_synthesize`（config `knowledge_base.synthesis_enabled` 门控；默认 off），与 `knowledge_search` 分工（前者给答案、后者给材料）
- [ ] **T6.3** meta_agent 引导：有合成需求时用 `knowledge_synthesize`，并复用现有 `[N]` 引用规范
- [ ] **T6.4** 可选维护任务（Automation）：`run_brain_maintenance`（embed_stale / orphan_report / broken_wikilink_lint），借鉴 gbrain dream 子集
- [ ] **T6.5** SSE/工具卡区分 `search` vs `synthesize`；冒烟测试合成输出含引用与 gap 段

---

## 5. 关键技术取舍

- **为何不直接复用 `agenticx/retrieval/HybridRetriever`**：它绑定 framework 的 `VectorRetriever/BM25Retriever/GraphRetriever` 抽象，与 KB 的 `_ChromaBackend` 是两套存储模型，强行桥接侵入性大且难维护。**决策**：在 `KBRuntime` 内自带轻量 BM25(FTS5)+RRF，独立可控，符合 NFR-2。可在注释标注「思想参考 gbrain `src/core/search/hybrid.ts` RRF_K=60」。
- **图扩展检索**：依赖 wikilink/compiled 页，本 plan 不做；留给后续 compiled wiki 立项（`combined_proposal.md` Phase A/B）。
- **rerank**：provider 能力不一，列 P1 可选，避免阻塞核心 hybrid。

## 6. 风险与回滚

| 风险 | 缓解 |
|------|------|
| hybrid 改动影响现有检索 | `retrieval_mode` 默认 `vector`，feature 增量；NFR-1 回归测试 |
| FTS5 与 Chroma 双索引不一致 | 同一 `ingest_document/delete/clear` 事务内同步写两边 |
| 增量缓存误跳过 | 指纹含 chunking+embedding fingerprint，任一变更即失效 |
| 打包体积 | 仅用 stdlib sqlite FTS5，无新重依赖 |

回滚：删除新增字段消费逻辑，`retrieval_mode` 强制 `vector` 即恢复现状。

## 7. 涉及文件（预估）

| 文件 | 改动 |
|------|------|
| `agenticx/studio/kb/contracts.py` | RetrievalSpec/ChunkingSpec 字段扩展 |
| `agenticx/studio/kb/runtime.py` | BM25 索引 + RRF 融合 + 增量缓存 + contextual chunk |
| `agenticx/brain/runtime_docs.py` | search 透传 mode + 分数元数据 |
| `agenticx/brain/search.py` | 透传（最小改动，保持聚合不变） |
| `desktop/src/components/settings/knowledge/KnowledgeDebugPanel.tsx` | 三模 UI + 分项分数 |
| `desktop/src/components/settings/knowledge/KnowledgeConfigPanel.tsx` | retrieval_mode 配置 |
| `tests/test_smoke_kb_hybrid_*.py` | 新增冒烟 |
| `docs/guides/knowledge-base-mvp.md` | 文档更新 |
| `agenticx/brain/wiki_compiler.py` | 第二批次 NEW（两步 ingest） |
| `agenticx/brain/wiki_graph.py` | 第二批次 NEW（4-signal 图检索） |
| `agenticx/brain/synthesis.py` | 第二批次 NEW（合成 + gap） |
| `agenticx/cli/agent_tools.py` | 第二批次 `knowledge_synthesize` 工具 |
| `agenticx/brain/routes.py` | 第二批次 wiki/synthesis API |
| `desktop/src/components/settings/knowledge/` | 第二批次 Wiki Tab + purpose.md 编辑 |

---

## 8. 已确认决策（OQ → Decision，2026-06-02）

- **D-1** BM25 通道：**sqlite FTS5**（跨重启持久，无新重依赖，符合 NFR-2）。
- **D-2** rerank：**列 P1 可选**。Phase 1 仅实现 provider 能力探测 + 接口预留，不进 MVP 必做；后续视效果再启用。
- **D-3** Phase 2 分块增强：**contextual**（标题/章节前缀注入），不做父子分块。
- **D-4** **compiled wiki + synthesis 正式排进路线图**：作为第二批次 Phase 5–6，在第一批次（Phase 0–4）验收稳定后实施。
