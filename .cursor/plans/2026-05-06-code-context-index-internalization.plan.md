# Plan: Code Context Index Internalization (claude-context → AgenticX)

- Plan-Id: 2026-05-06-code-context-index-internalization
- Plan-File: .cursor/plans/2026-05-06-code-context-index-internalization.plan.md
- Owner: Damon Li
- Status: Draft（待你确认后才进入实现阶段）
- 关联研究：
  - `research/codedeepresearch/claude-context/claude-context_proposal.md`
  - `research/codedeepresearch/claude-context/claude-context_agenticx_gap_analysis.md`
  - `research/codedeepresearch/claude-context/claude-context_eval_plan.md`
  - `research/codedeepresearch/claude-context/claude-context_source_notes.md`

## 0. 目标 (Why)

为 AgenticX 新增**面向源代码的语义索引子系统** `agenticx/code_index/`，把 claude-context 的「AST 切分 + Merkle 增量 + hybrid + RRF + 状态机 + abort 协议」内化为 AgenticX 自有能力，**与现有 `agenticx/studio/kb/` 通用文档知识库共存而非替代**。

非目标（防止 scope creep）：

- ❌ 不重构 `agenticx/studio/kb/`、`agenticx/memory/hybrid_search.py`、`agenticx/retrieval/`
- ❌ 不替换现有 `knowledge_search` 工具
- ❌ 不动 runtime 主循环、agent_runtime、meta_tools
- ❌ 本 plan 任何阶段都不做 Desktop UI 重构

## 1. 范围与硬约束

| 维度 | 边界 |
|---|---|
| 新增子包 | `agenticx/code_index/`（隔离命名，避免与 `kb` 混淆） |
| 复用基础设施 | KB 的 embedding provider、vector backend（Chroma/Milvus/Qdrant）、`agenticx/observability/` |
| 新增工具 | `code_index_create / code_index_status / code_index_clear / code_index_cancel / code_search`（在 `agenticx/cli/agent_tools.py STUDIO_TOOLS` 注册） |
| 配置开关 | `~/.agenticx/config.yaml` 的 `code_index.enabled`（默认 false，opt-in） |
| 元数据落盘 | `~/.agenticx/code_index/<codebase_path_md5>/snapshot.json|.lock` |
| 上游内化 | MIT 许可证，需在文件头与 `NOTICE` 标注来源 |

## 2. 需求块

### Functional Requirements

- **FR-1 索引创建**：`code_index_create(codebase_path)` 启动后台索引任务，返回 `task_id`；同 codebase 重复触发时复用现有任务。
- **FR-2 状态查询**：`code_index_status(task_id|codebase_path)` 返回 `{status, progress, files_total, files_done, error_message?, error_traceback_summary?, last_progress_at, stats}`，状态机为 `pending → indexing → indexed | indexfailed`。
- **FR-3 增量索引**：再次对已索引 codebase 触发 `code_index_create`，仅对 SHA-256 + Merkle 比较出的 added/modified/removed 文件做向量更新。
- **FR-4 代码检索**：`code_search(codebase_path, query, top_k, strategy?, filters?)` 返回 `[{file_path, start_line, end_line, language, score, snippet}]`；`strategy ∈ {dense, hybrid}`，默认 `dense`。
- **FR-5 Abort 协议**：`code_index_cancel(task_id)` 可在有限步数内退出后台任务且不留脏 snapshot。
- **FR-6 Clear**：`code_index_clear(codebase_path)` 删除该 codebase 的全部 chunks 与 snapshot。
- **FR-7 Splitter**：首版 AST 切分支持 `py / ts / js / go / java`，其他语言落字符切分回退；`chunkSize=2500 chars`、`overlap=300 chars`，单文件 chunk 上限 450,000（超限抛错）。
- **FR-8 检索可读性**：索引中（`status=indexing`）调用 `code_search` 须返回部分结果 + `partial=true` warning，而不是拒绝。

### Non-Functional Requirements

- **NFR-1 隔离**：`code_index/` 不修改 `studio/kb/`、`retrieval/`、`memory/hybrid_search.py` 任何一行代码。
- **NFR-2 默认关**：`code_index.enabled=false` 时，工具不注册到 `STUDIO_TOOLS`；现有路径零影响。
- **NFR-3 可观测**：所有状态迁移、abort、retry、repair 必须 log；提供 metrics（index latency、changed files、retrieval hit@k、abort 次数）。
- **NFR-4 失败可读**：`indexfailed` 必须暴露完整异常链摘要，不得只透出 `'_type'` 等单 token（对齐 AGENTS.md 偏好）。
- **NFR-5 跨平台**：tree-sitter 各语言 parser 包须在 macOS / Windows / Linux 三平台可加载；macOS DMG 与 Windows NSIS 的 PyInstaller spec 须显式 hiddenimports。
- **NFR-6 性能基线**：在 AgenticX 自身 codebase（约 X 万行）上，全量索引 P95 ≤ 5 min；增量索引（≤50 文件改动）P95 ≤ 30 s；`code_search` P95 ≤ 1 s（dense-only，topK=10）。

### Acceptance Criteria

- **AC-1**：`code_index.enabled=false` 时跑全套现有 KB / retrieval / runtime 测试，零回归。
- **AC-2**：在 `tests/code_index/` 提供 ≥10 条 smoke test，覆盖：创建 → 索引完成 → 检索命中 → 增量改动 → 再检索命中 → cancel → clear。
- **AC-3**：状态一致性测试：随机 kill 索引进程后重启，snapshot 不进入未定义态；进入 `indexing` 但无活进程时能自动转 `indexfailed` 或自愈。
- **AC-4**：在评测脚本 (`research/codedeepresearch/claude-context/claude-context_eval_plan.md` 落地版) 上跑 B0/B1/B2/B3 四基线，B2 相比 B1 在 Recall@10 ≥ 10% 提升才算 PoC 成功；hybrid（B3）对比 dense（B2）至少 ≥5% 提升才默认开。
- **AC-5**：所有 commit 均带 `Plan-Id: 2026-05-06-code-context-index-internalization`、`Plan-File: ...`、`Made-with: Damon Li` 三类 trailer，无任何 AI 工具署名。

## 3. 阶段拆分

每个阶段独立 commit（按 `/commit --spec=` 注入 trailer），完成后 `pytest` 必须绿才进入下一阶段。

### Phase 0 — Research lock-in（产出物已就绪，本 plan 完成即视为 Phase 0 done）

- [x] 上游源码静态分析（`claude-context_source_notes.md`）
- [x] DeepWiki 交叉校验（`claude-context_deepwiki.md`）
- [x] 与 AgenticX gap 分析（`claude-context_agenticx_gap_analysis.md`）
- [x] 内化方案（`claude-context_proposal.md` 已校准）
- [x] 评测计划（`claude-context_eval_plan.md`）
- [x] 本 plan 落盘
- [ ] 用户确认是否进入 Phase 1（**等你拍板**）

### Phase 1 — ADR 草案（不动业务代码）

落 `docs/adr/`：

1. `ADR-XXXX-code-context-index-state-machine.md`
   - 状态枚举、迁移规则、snapshot schema、.lock 协议、stale lock 回收策略
2. `ADR-XXXX-code-context-hybrid-retrieval-strategy.md`
   - dense / hybrid 两态、RRF k=100 默认、cross-encoder rerank 插槽
3. `ADR-XXXX-code-context-sparse-backend-selection.md`
   - 选项 A/B/C 评估，默认推荐 A（rank_bm25 复用 `agenticx/retrieval/bm25_retriever.py`）

DoD：3 份 ADR 草案 + 1 个 commit（仅含 `docs/adr/*.md` 和 plan 文件）。

### Phase 2 — Skeleton（PoC，dense-only）

新增 `agenticx/code_index/`：

- `__init__.py`
- `engine.py`：`CodeIndexEngine`（同步索引接口、对接 vector backend）
- `state_store.py`：`CodeIndexStateStore`（snapshot 读写、.lock 文件、状态机校验）
- `splitter.py`：`AstCodeSplitter`（Python/TS/JS/Go/Java tree-sitter）+ `CharSplitter` 回退
- `change_detector.py`：`MerkleDAG`（移植自上游，文件头标注 `Adapted from zilliztech/claude-context (MIT)`）
- `retrieval.py`：dense-only `search()`
- `tools_adapter.py`：`code_index_create / code_search / code_index_status / code_index_clear / code_index_cancel`
- 注册到 `agenticx/cli/agent_tools.py STUDIO_TOOLS`（仅当 `config.code_index.enabled` 为 true）

测试：`tests/code_index/test_skeleton_smoke.py`（5+ 条），覆盖创建 → 检索 → status → clear。

`NOTICE` 文件追加 claude-context MIT 归属。

DoD：FR-1/2/4/6 + AC-1/2 通过；commit message 含完整 FR/AC 块。

### Phase 3 — Incremental + Abort（MVP）

- 在 `engine.py` 注入 `change_detector`，`code_index_create` 对已索引 codebase 走 changed-only 路径
- 引入 `IndexAbortError` + cooperative cancel（每处理 N 个文件检查一次 cancel flag）
- 引入异步后台任务跑法（参考 `agenticx/runtime/task_scheduler.py` 的现有约定）
- snapshot 周期性落盘（每 N 个文件或每 T 秒）
- 重启自愈：启动时扫描 `~/.agenticx/code_index/`，把孤儿 `indexing` 转 `indexfailed`

测试新增：增量索引、cancel、kill 后重启自愈、partial-results during indexing。

DoD：FR-3/5/8 + AC-3 通过。

### Phase 4 — Hybrid + 评测脚本

- `retrieval.py` 增加 `hybrid` 策略：dense top50 + sparse top50 → RRF(k=100)
- 选项 A 落地：sparse 走 `agenticx/retrieval/bm25_retriever.py`（**只读引用**，不修改其源码）
- 落 `tests/code_index/eval/`：评测脚本 + 标注样例 + 跑 B0/B1/B2/B3 的 runner
- 在 AgenticX 自身 codebase 上跑一轮，输出 `eval_report.md`

DoD：AC-4 通过；评测报告进 commit。

### Phase 5 — Observability + 文档

- 接 `agenticx/observability/` traces/metrics
- 文档：`docs/guides/code-context-index.md`（用户视角的入门 + 配置 + 工具用法）
- 更新 `conclusions/` 相应模块结论文件（按 `/update-conclusion --plan=...` 流程）

DoD：NFR-3 通过；`/update-conclusion` 跑通。

### Phase 6 — Desktop 设置 GUI 与默认开关（可选，按需）

- Desktop 设置面板增加「代码语义索引」开关（沿用知识库 Tab 的视觉规范，不新增 Tab）
- 是否默认开启留待评测后由你定夺；当前 plan 中默认 false

DoD：UI 与后端开关一致；与现有 KB Tab 视觉/交互完全对齐。

## 4. Commit 划分（每段独立、可回滚）

按 plan-management.mdc 与你的 commit 偏好（按功能点分组、附 FR/NFR/AC、必须含 `Made-with: Damon Li` 与 `Plan-Id` trailer）：

1. `docs(code-index): add ADR drafts for state machine, hybrid, sparse backend`
2. `feat(code-index): scaffold dense-only PoC engine + tools (opt-in)`
3. `feat(code-index): add merkle-based incremental indexing + abort protocol`
4. `feat(code-index): add hybrid retrieval (dense+BM25 RRF) + eval runner`
5. `feat(code-index): wire observability traces/metrics + user docs`
6. `(optional) feat(desktop): expose code-index toggle in settings`

每条 commit 用 `/commit --spec=.cursor/plans/2026-05-06-code-context-index-internalization.plan.md` 自动注入 trailer。

## 5. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 与现有 KB 路径职责模糊 | §4.2 表格 + ADR + 工具命名前缀（`code_*` vs `knowledge_*`） |
| tree-sitter 包体积影响 PyInstaller | Phase 2 末 PyInstaller 体积回归测试，超阈值则按需下载语言 parser |
| sparse backend 选型偏离上游基线 | Phase 4 评测脚本严格落地、ADR 决策有据可查 |
| 长跑/自愈逻辑回归现有 runtime | NFR-1 严格隔离 + AC-1 全量回归 |
| 顺手优化越界 | 每个 commit 必须能逐项追溯 FR/AC，否则不合并 |

回滚：`code_index.enabled=false` 即回到当前状态；元数据目录单独 `rm -rf ~/.agenticx/code_index/` 即可清理。

## 6. 进入实现阶段前的确认事项

需要你拍板：

1. ✅ / ❌ 是否同意按本 plan 进入 Phase 1（ADR 草案）
2. ✅ / ❌ sparse backend 默认选项 A（rank_bm25），还是希望先做 A/B/C 三选一基准评测
3. ✅ / ❌ Phase 6（Desktop GUI）是否纳入本轮
4. ✅ / ❌ 评测使用的 codebase 仅限 AgenticX 自身，还是再加一个外部样本（如 `claude-context` 自身）
5. ✅ / ❌ 是否需要在每阶段 commit 后跑 `code-reviewer` 子 agent 自审

未确认前不动 `agenticx/` 下任何代码。
